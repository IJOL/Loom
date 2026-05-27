// src/modulation/waveform.ts
// Pure phase → value math. JS-side mirror of the Web Audio LFO output
// so the rAF UI loop can animate knob rings without sampling AudioParam values.

import type { Waveform } from './types';

/**
 * @param kind     waveform shape
 * @param phase    0..1 (wraps); 0 = start of cycle
 * @param bipolar  true → output in -1..+1; false → output in 0..1
 */
export function computeWaveform(kind: Waveform, phase: number, bipolar: boolean): number {
  const p = ((phase % 1) + 1) % 1;
  let v: number;
  switch (kind) {
    case 'sine':     v = Math.sin(2 * Math.PI * p); break;
    case 'triangle': v = p < 0.5 ? (-1 + 4 * p) : (3 - 4 * p); break;
    case 'square':   v = p < 0.5 ? 1 : -1; break;
    case 'saw':      v = -1 + 2 * p; break;
  }
  return bipolar ? v : (v + 1) / 2;
}
