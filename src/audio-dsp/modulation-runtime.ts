// src/audio-dsp/modulation-runtime.ts
// In-worklet modulation: SHARED LFOs over the full subtractive modulation target
// set (every SubParams field a connection can reach, plus the synthetic
// `ampGain` tremolo). The runtime returns NORMALISED offsets (sum of
// wave×depth); the renderer scales each to native units (cents/semitones for
// pitch, ×gain for ampGain, 0..1 add for the rest). `kind: 'adsr'` mods
// contribute zero here (per-voice modular ADSR beyond the built-in amp/filter
// envelopes is deferred — see the SCOPE note below). BPM-synced LFOs ARE
// honoured: the host (WorkletLaneEngine.toModLite) resolves any sync→free Hz
// via effectiveRateHz before sending, so `rateHz` here is already tempo-correct
// and re-posted on every BPM change.
//
// SCOPE (deferred): user-assigned ADSR→param connections beyond the engine's
// built-in amp/filter envelopes do nothing on the worklet path. The shared
// (not per-voice) runtime has no per-note gate to drive an envelope from; wiring
// that needs a per-voice modulation pass, which is out of scope for this branch.
// The descriptor engines still advertise default ADSR modulators and the mod
// panel still lets users add ADSR connections, so those controls are currently
// inert for non-built-in targets.
import type { ModTarget } from './types';

export interface ModLite {
  id: string;
  kind: 'lfo' | 'adsr';
  enabled: boolean;
  rateHz: number;
  waveform: 'sine' | 'triangle' | 'square' | 'saw';
  /** Polarity: bipolar (default) swings -1..+1; unipolar maps the wave to 0..1
   *  so the offset only pushes the target one way. Optional — absent ⇒ bipolar. */
  bipolar?: boolean;
  /** SubParams field name → modulation depth (-1..1), additive in the field's
   *  native 0..1 units. */
  depthByParam: Record<string, number>;
}

/** The modulator's signal at phase, honouring polarity: bipolar -1..+1 (raw
 *  wave), unipolar 0..1 (wave shifted/scaled so it only pushes one way). */
function signal(m: ModLite, phase: number): number {
  const w = wave(m.waveform, phase);
  return m.bipolar === false ? (w + 1) / 2 : w;
}

function wave(w: ModLite['waveform'], phase: number): number {
  switch (w) {
    case 'square':   return phase < 0.5 ? 1 : -1;
    case 'saw':      return phase * 2 - 1;
    case 'triangle': return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
    default:         return Math.sin(phase * 2 * Math.PI);
  }
}

export class ModulationRuntime {
  private mods: ModLite[] = [];
  // sr is reserved for future per-sample phase accumulation (BPM sync); the
  // current free-rate implementation derives phase from absolute time directly.
  constructor(_sr: number) {}
  setMods(mods: ModLite[]): void { this.mods = mods; }
  /** Normalised additive offset (Σ wave×depth over enabled LFOs) for a
   *  modulation target at absolute time t. The renderer scales it to the
   *  target's native units. */
  offsetFor(field: ModTarget, t: number): number {
    let sum = 0;
    for (const m of this.mods) {
      if (!m.enabled || m.kind !== 'lfo') continue;
      const depth = m.depthByParam[field as string];
      if (!depth) continue;
      const phase = (t * m.rateHz) % 1;
      sum += signal(m, phase) * depth;
    }
    return sum;
  }

  /** Snapshot of the normalised offset for EVERY param any enabled modulator
   *  drives at time t (the sum over all sources, the same value offsetFor
   *  returns). The worklet posts this to the main thread so the knob rings show
   *  the REAL modulation; params with no active modulation are omitted. When
   *  per-voice ADSR lands it adds its contribution here and the rings follow. */
  activeOffsets(t: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of this.mods) {
      if (!m.enabled || m.kind !== 'lfo') continue;
      const phase = (t * m.rateHz) % 1;
      const w = signal(m, phase);
      for (const field in m.depthByParam) {
        const depth = m.depthByParam[field];
        if (!depth) continue;
        out[field] = (out[field] ?? 0) + w * depth;
      }
    }
    return out;
  }
}
