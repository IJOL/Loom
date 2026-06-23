// src/audio-dsp/modulation-runtime.ts
// In-worklet modulation. Phase 1 scope: SHARED LFOs only, modulating a fixed
// set of SubParams fields (filterCutoff, filterResonance, osc1Level, osc2Level,
// noiseLevel). Per-voice modular ADSR beyond the amp/filter envelopes already
// inside SubtractiveVoiceRenderer is deferred — `kind: 'adsr'` mods contribute
// zero here. BPM-synced LFO rate is also deferred: `rateHz` (free Hz) is used
// directly (the host resolves any sync→Hz before sending, future work).
import type { SubParams } from './types';

export interface ModLite {
  id: string;
  kind: 'lfo' | 'adsr';
  enabled: boolean;
  rateHz: number;
  waveform: 'sine' | 'triangle' | 'square' | 'saw';
  /** SubParams field name → modulation depth (-1..1), additive in the field's
   *  native 0..1 units. */
  depthByParam: Record<string, number>;
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
  /** Additive offset (native 0..1 units of the field) at absolute time t. */
  offsetFor(field: keyof SubParams, t: number): number {
    let sum = 0;
    for (const m of this.mods) {
      if (!m.enabled || m.kind !== 'lfo') continue;
      const depth = m.depthByParam[field as string];
      if (!depth) continue;
      const phase = (t * m.rateHz) % 1;
      sum += wave(m.waveform, phase) * depth;
    }
    return sum;
  }
}
