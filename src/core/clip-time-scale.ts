// Pure, DOM-free time-scaling for a clip's content. `scaleClipTempo` doubles or
// halves a clip's perceived tempo (BPM convention): tempoMult 2 = double tempo
// (compress notes), tempoMult 0.5 = half tempo (stretch notes). It scales notes,
// the loop sub-region, lengthBars, and resamples automation envelopes so the
// stored value arrays still match the length the scheduler expects. The caller
// snapshots state for undo BEFORE calling.

import type { SessionClip } from '../session/session';
import { AUTOMATION_SUB_RES } from './pattern';

// Mirror collect-scene-automation.ts: clip automation is 4/4-only, indexed at
// 16 steps/bar. Envelope values length the consumer expects = bars * 16 * SUB_RES.
const STEPS_PER_BAR = 16;

/** Resample an envelope value array to `newLen` by phase (nearest-neighbor).
 *  Stretching repeats samples; compressing decimates. Robust to any old length
 *  (also normalises legacy/odd-length arrays to the expected length). */
export function resampleEnvelope(values: number[], newLen: number): number[] {
  const oldLen = values.length;
  if (newLen <= 0 || oldLen === 0) return [];
  const out = new Array<number>(newLen);
  for (let j = 0; j < newLen; j++) {
    const src = Math.min(oldLen - 1, Math.floor((j * oldLen) / newLen));
    out[j] = values[src] ?? 0.5;
  }
  return out;
}

/** Scale a clip's perceived tempo by `tempoMult` (2 = faster/compress,
 *  0.5 = slower/stretch). Mutates `clip` in place. */
export function scaleClipTempo(clip: SessionClip, tempoMult: number): void {
  const timeFactor = 1 / tempoMult;

  for (const n of clip.notes) {
    n.start = Math.round(n.start * timeFactor);
    n.duration = Math.max(1, Math.round(n.duration * timeFactor));
  }

  if (clip.loopStartTick !== undefined) clip.loopStartTick = Math.round(clip.loopStartTick * timeFactor);
  if (clip.loopEndTick !== undefined) clip.loopEndTick = Math.round(clip.loopEndTick * timeFactor);

  // Half-up rounding + the integer-bar floor guarantee the new length never
  // clips the scaled notes (the only fractional result is x.5, which rounds up).
  const newLengthBars = Math.max(1, Math.round(clip.lengthBars * timeFactor));

  if (clip.envelopes) {
    const targetLen = newLengthBars * STEPS_PER_BAR * AUTOMATION_SUB_RES;
    for (const env of clip.envelopes) {
      env.values = resampleEnvelope(env.values, targetLen);
    }
  }

  clip.lengthBars = newLengthBars;
}
