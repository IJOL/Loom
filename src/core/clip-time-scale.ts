// Pure, DOM-free time-scaling for a clip's content. `scaleClipTempo` doubles or
// halves a clip's perceived tempo (BPM convention) so the change is always
// VISIBLE on the clip:
//   *2 (tempoMult 2)  = double-time / faster: compress every note x0.5 and TILE
//                       the pattern to fill the clip — length stays the same, you
//                       see twice as many notes at double speed ("recortadas").
//   /2 (tempoMult 0.5)= half-time / slower: stretch every note x2 and GROW the
//                       clip length to fit — nothing is clipped, notes are longer
//                       and spread over twice the bars ("dobladas").
// Automation envelopes follow the notes (tiled on *2, stretched on /2). The caller
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

/** Cycle an envelope curve `copies` times across `targetLen` samples (same total
 *  span, the shape repeats) — the automation analogue of tiling the notes on *2. */
export function tileEnvelope(values: number[], copies: number, targetLen: number): number[] {
  const oldLen = values.length;
  if (targetLen <= 0 || oldLen === 0) return [];
  const out = new Array<number>(targetLen);
  for (let i = 0; i < targetLen; i++) out[i] = values[(i * copies) % oldLen] ?? 0.5;
  return out;
}

/** Scale a clip's perceived tempo by `tempoMult` (>1 = faster/compress+tile,
 *  <1 = slower/stretch+grow). `barTicks` = ticks per bar (meter-dependent), needed
 *  to tile copies across the clip. Mutates `clip` in place. */
export function scaleClipTempo(clip: SessionClip, tempoMult: number, barTicks: number): void {
  const timeFactor = 1 / tempoMult;

  if (tempoMult > 1) {
    // ── Faster / double-time: compress + tile, clip length UNCHANGED ──────────
    const copies = Math.round(tempoMult);                 // 2 for *2
    const clipTicks = clip.lengthBars * barTicks;
    const span = clipTicks / copies;                      // each copy's slot
    const base = clip.notes.map((n) => ({
      ...n,
      start: Math.round(n.start * timeFactor),
      duration: Math.max(1, Math.round(n.duration * timeFactor)),
    }));
    const tiled: typeof clip.notes = [];
    for (let k = 0; k < copies; k++) {
      const offset = Math.round(k * span);
      for (const n of base) tiled.push({ ...n, start: n.start + offset });
    }
    clip.notes = tiled;
    // Loop region + lengthBars stay as-is (a full-clip loop still spans every copy).
    if (clip.envelopes) {
      const targetLen = clip.lengthBars * STEPS_PER_BAR * AUTOMATION_SUB_RES;
      for (const env of clip.envelopes) env.values = tileEnvelope(env.values, copies, targetLen);
    }
    return;
  }

  // ── Slower / half-time: stretch + grow the clip to preserve the pattern ─────
  for (const n of clip.notes) {
    n.start = Math.round(n.start * timeFactor);
    n.duration = Math.max(1, Math.round(n.duration * timeFactor));
  }
  if (clip.loopStartTick !== undefined) clip.loopStartTick = Math.round(clip.loopStartTick * timeFactor);
  if (clip.loopEndTick !== undefined) clip.loopEndTick = Math.round(clip.loopEndTick * timeFactor);
  const newLengthBars = Math.max(1, Math.round(clip.lengthBars * timeFactor));
  if (clip.envelopes) {
    const targetLen = newLengthBars * STEPS_PER_BAR * AUTOMATION_SUB_RES;
    for (const env of clip.envelopes) env.values = resampleEnvelope(env.values, targetLen);
  }
  clip.lengthBars = newLengthBars;
}
