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
import { envelopeValueLengthFromBarTicks } from './clip-envelope-length';
import { scaleClipLength, type LengthMode } from '../weave/clip-length';

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
      // The bar the caller handed us, never a 4/4 one: the notes above are tiled
      // across `barTicks` and the envelope has to cover the same span.
      const targetLen = envelopeValueLengthFromBarTicks(clip.lengthBars, barTicks);
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
    const targetLen = envelopeValueLengthFromBarTicks(newLengthBars, barTicks);
    for (const env of clip.envelopes) env.values = resampleEnvelope(env.values, targetLen);
  }
  clip.lengthBars = newLengthBars;
}

/** Change a clip's LENGTH by `factor`, saying how.
 *
 *  `scaleClipTempo` above conflates two musical operations: *2 compresses AND
 *  tiles, /2 stretches AND grows. That is why the same press feels right on
 *  drums and wrong on a pad. This separates them — `mode` decides whether the
 *  groove is repeated, lengthened, or repeated with variation — and takes any
 *  factor rather than only two.
 *
 *  The NOTE arithmetic is `weave/clip-length.ts`, pure and tested on its own.
 *  What lives here is everything that has to stay in step with it: the clip's
 *  bar count, its loop region and its automation curves. Building the new
 *  controls on the pure function ALONE would have been a second clip-time
 *  system, and the one that forgot the envelopes — a clip whose automation
 *  silently stopped lining up with its notes.
 *
 *  Mutates `clip` in place. The caller snapshots for undo BEFORE calling. */
export function applyClipLength(
  clip: SessionClip, factor: number, mode: LengthMode, barTicks: number,
): void {
  if (!Number.isFinite(factor) || factor <= 0) return;

  const srcTicks = clip.lengthBars * barTicks;
  clip.notes = scaleClipLength(clip.notes, factor, mode, srcTicks);

  // Every mode makes the clip factor× as long — that is what "length" means
  // here. What differs is what fills the new room.
  const newLengthBars = Math.max(1, Math.round(clip.lengthBars * factor));

  // A loop region is a window on the OLD span; scaled with it, it keeps meaning
  // the same fraction of the clip. Left alone, growing a clip would silently
  // shrink the loop to its first part.
  if (clip.loopStartTick !== undefined) clip.loopStartTick = Math.round(clip.loopStartTick * factor);
  if (clip.loopEndTick !== undefined) clip.loopEndTick = Math.round(clip.loopEndTick * factor);

  if (clip.envelopes) {
    const targetLen = envelopeValueLengthFromBarTicks(newLengthBars, barTicks);
    const copies = Math.max(1, Math.round(factor));
    for (const env of clip.envelopes) {
      // Repeating the notes repeats the curve; stretching them stretches it.
      // The automation has to describe the same music the notes do.
      env.values = mode === 'stretch'
        ? resampleEnvelope(env.values, targetLen)
        : tileEnvelope(env.values, copies, targetLen);
    }
  }

  clip.lengthBars = newLengthBars;
}
