// Extract slice regions of a loop buffer into standalone AudioBuffers, so each
// slice can be stored in the sample bank as a first-class one-shot (played via
// the normal keymap path, not a clip-local region). Pure given a context for
// createBuffer. The slices partition [0, duration): slice i spans
// [points[i], points[i+1]) (last one runs to the end), so concatenating them
// reproduces the original sample-for-sample.

export interface SliceCut { startSec: number; endSec: number; buffer: AudioBuffer; }

/** Normalise raw onset seconds into sorted, in-range, 0-anchored cut points. */
export function sliceBoundaries(slicePointsSec: number[], durationSec: number): number[] {
  const pts = Array.from(new Set([0, ...slicePointsSec]))
    .filter((t) => t >= 0 && t < durationSec)
    .sort((a, b) => a - b);
  if (pts.length === 0) pts.push(0);
  return pts;
}

/** Cut `buffer` at the given onset seconds into one AudioBuffer per slice. */
export function sliceBuffer(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  slicePointsSec: number[],
): SliceCut[] {
  const sr = buffer.sampleRate;
  const ch = buffer.numberOfChannels;
  const pts = sliceBoundaries(slicePointsSec, buffer.duration);
  const out: SliceCut[] = [];
  for (let i = 0; i < pts.length; i++) {
    const startSec = pts[i];
    const endSec = i + 1 < pts.length ? pts[i + 1] : buffer.duration;
    const startS = Math.min(buffer.length, Math.round(startSec * sr));
    const endS = Math.min(buffer.length, Math.round(endSec * sr));
    const len = Math.max(1, endS - startS);
    const slice = ctx.createBuffer(ch, len, sr);
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(c);
      const dst = slice.getChannelData(c);
      for (let j = 0; j < len && startS + j < buffer.length; j++) dst[j] = src[startS + j];
    }
    out.push({ startSec, endSec, buffer: slice });
  }
  return out;
}
