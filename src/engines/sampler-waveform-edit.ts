// src/engines/sampler-waveform-edit.ts
// Pure interaction helpers for the Selected-sample waveform: convert pointer x to
// a buffer fraction, pick the handle under the cursor, and apply a clamped drag.

export type WaveHandle = 'start' | 'end' | 'loopStart' | 'loopEnd';
export interface TrimState {
  sampleStart: number; sampleEnd: number; loopStart: number; loopEnd: number; loop: boolean;
}

const MIN_GAP = 0.005; // minimum width between paired handles (fraction)

/** clientX → fraction (0..1), honouring the canvas left edge, horizontal scroll
 *  and the zoom-scaled canvas width (all in CSS px). */
export function xToFrac(clientX: number, left: number, scrollLeft: number, canvasWidth: number): number {
  if (canvasWidth <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - left + scrollLeft) / canvasWidth));
}

/** Nearest editable handle within `tol`, or null. Loop handles only when loop on. */
export function pickHandle(frac: number, s: TrimState, tol: number): WaveHandle | null {
  const cands: Array<[WaveHandle, number]> = [['start', s.sampleStart], ['end', s.sampleEnd]];
  if (s.loop) cands.push(['loopStart', s.loopStart], ['loopEnd', s.loopEnd]);
  let best: WaveHandle | null = null;
  let bestD = tol;
  for (const [h, pos] of cands) {
    const d = Math.abs(frac - pos);
    if (d <= bestD) { bestD = d; best = h; }
  }
  return best;
}

/** Apply a drag of `handle` to `frac`, returning a new clamped state. */
export function applyHandle(handle: WaveHandle, frac: number, s: TrimState): TrimState {
  const f = Math.min(1, Math.max(0, frac));
  const n: TrimState = { ...s };
  switch (handle) {
    case 'start': n.sampleStart = Math.max(0, Math.min(f, s.sampleEnd - MIN_GAP)); break;
    case 'end':   n.sampleEnd = Math.min(1, Math.max(f, s.sampleStart + MIN_GAP)); break;
    case 'loopStart': n.loopStart = Math.min(Math.max(f, s.sampleStart), s.loopEnd - MIN_GAP); break;
    case 'loopEnd':   n.loopEnd = Math.max(Math.min(f, s.sampleEnd), s.loopStart + MIN_GAP); break;
  }
  n.loopStart = Math.min(Math.max(n.loopStart, n.sampleStart), n.sampleEnd);
  n.loopEnd = Math.min(Math.max(n.loopEnd, n.sampleStart), n.sampleEnd);
  return n;
}
