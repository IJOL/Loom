// src/audio-dsp/modulators/lfo-kernel.ts
// The LFO's per-sample maths, moved out of ModulationRuntime so the runtime
// stops knowing what an LFO is.
import { registerModulatorKernel } from '../modulator-kernels';
import type { ModLite } from '../modulation-runtime';

function wave(w: ModLite['waveform'], phase: number): number {
  switch (w) {
    case 'square':   return phase < 0.5 ? 1 : -1;
    case 'saw':      return phase * 2 - 1;
    case 'triangle': return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
    default:         return Math.sin(phase * 2 * Math.PI);
  }
}

registerModulatorKernel({
  id: 'lfo',
  valueAt(m, t, origin) {
    const dt = t - origin;
    const phase = dt <= 0 ? 0 : (dt * m.rateHz) % 1;
    const w = wave(m.waveform, phase);
    // Polarity: bipolar (default) swings -1..+1; unipolar maps to 0..1 so the
    // offset only pushes the target one way.
    return m.bipolar === false ? (w + 1) / 2 : w;
  },
});
