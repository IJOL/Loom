// @loom/plugin-sdk — dsp/mod-env-host.ts
// Shared per-voice ADSR-modulator host for the worklet renderers. A renderer that
// wants generic LFO + per-voice ADSR modulation keeps one of these, hands it the
// note's ADSR mods at spawn (setModEnvelopes), and each sample folds their gated
// envelopes into the shared-LFO offsets (combine), reading the result BY SLOT.
// getAdsrOffsets() exposes the ADSR-only part for the UI knob rings.
//
// This is the engine-agnostic core of the Subtractive renderer's combineMods,
// minus the 'amp'/'filter.env' targets it treats specially (those become the
// voice's envelopes multiplicatively; here every target is an additive offset).
//
// A spec's depths arrive keyed by target NAME. They are resolved to slots ONCE,
// at spawn, because doing it per sample would cost exactly what reading params
// by name used to.
import { Adsr } from './adsr';
import type { ModEnvSpec, ParamIndex, VoiceModOffsets } from '../types';

interface ModEnv {
  adsr: Adsr;
  m: ModEnvSpec;
  slots: Int32Array;
  depths: Float64Array;
}

const EMPTY = new Float64Array(0);

export class ModEnvHost {
  private modEnvs: ModEnv[] = [];
  private eff: Float64Array = EMPTY;
  private adsrOnly: Float64Array = EMPTY;
  /** Every slot any of this voice's envelopes writes. The combine loop walks
   *  THIS rather than the whole array: an ADSR usually drives one or two params,
   *  and a lane declares dozens. */
  private touched: Int32Array = new Int32Array(0);

  /** Hand this voice its per-voice ADSR modulators (one Adsr each), at spawn,
   *  together with the lane's numbering so their targets resolve to slots. */
  setModEnvelopes(mods: ModEnvSpec[], index: ParamIndex): void {
    this.eff = new Float64Array(index.length);
    this.adsrOnly = new Float64Array(index.length);
    const touched = new Set<number>();
    this.modEnvs = mods.map((m) => {
      const slots: number[] = [];
      const depths: number[] = [];
      for (const id in m.depthByParam) {
        const depth = m.depthByParam[id];
        if (!depth) continue;
        const slot = index.slot[id];
        if (slot === undefined) continue;   // a target this lane does not declare
        slots.push(slot);
        depths.push(depth);
        touched.add(slot);
      }
      return { adsr: new Adsr(), m, slots: Int32Array.from(slots), depths: Float64Array.from(depths) };
    });
    this.touched = Int32Array.from(touched);
  }

  /** True when this voice carries ADSR mods (lets the renderer skip combine()). */
  get active(): boolean { return this.modEnvs.length > 0; }

  /** This voice's ADSR-only offsets by slot (the UI knob-ring source). */
  getAdsrOffsets(): VoiceModOffsets { return this.adsrOnly; }

  /** Fold the gated ADSR envelopes into the shared-LFO offsets (moIn), returning
   *  a pooled array addressed by the same slots. moIn carries the LFO base for
   *  this lane; copying it resets every slot before the ADSR adds on top.
   *  Allocates nothing per sample. */
  combine(t: number, gate: number, moIn?: VoiceModOffsets): VoiceModOffsets {
    const e = this.eff;
    const a = this.adsrOnly;
    for (const s of this.touched) a[s] = 0;
    for (const me of this.modEnvs) {
      const env = me.adsr.update(
        t, gate, me.m.attackSec ?? 0.01, me.m.decaySec ?? 0.3, me.m.sustain ?? 0.7, me.m.releaseSec ?? 0.3,
      );
      const { slots, depths } = me;
      for (let i = 0; i < slots.length; i++) a[slots[i]] += env * depths[i];
    }
    // set() is a memcpy; fill(0) a memset. Only the ADSR-touched slots then need
    // adding, which is why `touched` exists.
    if (moIn) e.set(moIn); else e.fill(0);
    for (const s of this.touched) e[s] += a[s];
    return e;
  }
}
