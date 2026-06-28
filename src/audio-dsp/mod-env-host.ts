// src/audio-dsp/mod-env-host.ts
// Shared per-voice ADSR-modulator host for the worklet renderers. A renderer that
// wants generic LFO + per-voice ADSR modulation keeps one of these, hands it the
// note's ADSR mods at spawn (setModEnvelopes), and each sample folds their gated
// envelopes into the shared-LFO offsets (combine), reading the result by param
// dot-id. getAdsrOffsets() exposes the ADSR-only part for the UI knob rings.
//
// This is the engine-agnostic core of the Subtractive renderer's combineMods,
// minus the subtractive-specific 'amp'/'filterEnv' targets (those engines apply
// the envelope multiplicatively; here every target is an additive param offset).
import { Adsr } from './adsr';
import type { ModLite } from './modulation-runtime';
import type { VoiceModOffsets } from './types';

interface ModEnv { adsr: Adsr; m: ModLite; }

export class ModEnvHost {
  private modEnvs: ModEnv[] = [];
  private readonly effMo: Record<string, number> = {};
  private readonly adsrOnly: Record<string, number> = {};

  /** Hand this voice its per-voice ADSR modulators (one Adsr each), at spawn. */
  setModEnvelopes(mods: ModLite[]): void {
    this.modEnvs = mods.map((m) => ({ adsr: new Adsr(), m }));
  }

  /** True when this voice carries ADSR mods (lets the renderer skip combine()). */
  get active(): boolean { return this.modEnvs.length > 0; }

  /** This voice's ADSR-only offsets per param dot-id (the UI knob-ring source). */
  getAdsrOffsets(): VoiceModOffsets { return this.adsrOnly; }

  /** Fold the gated ADSR envelopes into the shared-LFO offsets (moIn), returning a
   *  pooled effective-offset struct keyed by param dot-id. moIn carries the LFO
   *  base for this engine; copying it resets every field before the ADSR adds on
   *  top. Allocates nothing per sample. */
  combine(t: number, gate: number, moIn?: VoiceModOffsets): VoiceModOffsets {
    const e = this.effMo;
    const a = this.adsrOnly;
    for (const k in a) a[k] = 0;
    for (const me of this.modEnvs) {
      const env = me.adsr.update(
        t, gate, me.m.attackSec ?? 0.01, me.m.decaySec ?? 0.3, me.m.sustain ?? 0.7, me.m.releaseSec ?? 0.3,
      );
      const depths = me.m.depthByParam;
      for (const field in depths) {
        const depth = depths[field];
        if (!depth) continue;
        a[field] = (a[field] ?? 0) + env * depth;
      }
    }
    if (moIn) Object.assign(e, moIn); else for (const k in e) e[k] = 0;
    for (const k in a) e[k] = (e[k] ?? 0) + a[k];
    return e;
  }
}
