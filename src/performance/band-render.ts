// src/performance/band-render.ts
// What a band SHOWS: cached waveform peaks for audio clips, a mini note
// preview for MIDI clips. Peaks are computed ONCE per (sampleId, buckets) and
// cached — painting happens on render commits (control-rate), never per frame.
import { sampleCache } from '../samples/sample-cache';

export interface BandClipInfo {
  kind: 'audio' | 'notes';
  /** Audio clips: the decoded buffer's id in the sample cache. */
  sampleId?: string;
  /** Seconds of ONE iteration of the clip at the song tempo — the loop-tick
   *  spacing when a band is longer than its clip. */
  loopSec: number;
  /** MIDI clips: the notes to preview + the clip length in ticks. */
  notes?: readonly { start: number; duration: number; midi: number }[];
  lengthTicks?: number;
}

const peaksCache = new Map<string, Float32Array>();

/** Max-abs peaks of channel 0 in `buckets` buckets, cached per (sampleId,
 *  buckets). Null while the buffer is not decoded yet (the render simply shows
 *  a flat band and the next repaint after decode fills it in). The channel
 *  data is read inline and never kept — the borrowed-buffer rule. */
export function peaksFor(sampleId: string, buckets: number): Float32Array | null {
  const key = `${sampleId}/${buckets}`;
  const hit = peaksCache.get(key);
  if (hit) return hit;
  const buf = sampleCache.get(sampleId);
  if (!buf || buckets <= 0) return null;
  const ch = buf.getChannelData(0);
  const out = new Float32Array(buckets);
  const per = Math.max(1, Math.floor(ch.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    const end = Math.min(ch.length, (b + 1) * per);
    for (let i = b * per; i < end; i++) {
      const a = Math.abs(ch[i]);
      if (a > m) m = a;
    }
    out[b] = m;
  }
  peaksCache.set(key, out);
  return out;
}

/** Test seam: drop every cached peak array (a re-imported sample id could
 *  otherwise show the previous audio). */
export function clearPeaksCache(): void { peaksCache.clear(); }

/** Paint one waveform band. `offsetFrac`/`spanFrac` window the peaks so a
 *  trimmed band shows the material it actually plays. No-op where 2D canvas is
 *  unavailable (jsdom). */
export function paintWaveband(
  canvas: HTMLCanvasElement, peaks: Float32Array, offsetFrac: number, spanFrac: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height, mid = h / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#10241f';
  for (let x = 0; x < w; x++) {
    const frac = offsetFrac + (x / w) * spanFrac;
    const idx = Math.floor((frac % 1) * peaks.length);
    const a = (peaks[idx] ?? 0) * (mid - 1) + 1;
    ctx.fillRect(x, mid - a, 1, a * 2);
  }
}

/** Paint one MIDI band: a block per note, pitch mapped top-to-bottom over the
 *  clip's own range. No-op where 2D canvas is unavailable (jsdom). */
export function paintNoteband(
  canvas: HTMLCanvasElement,
  notes: readonly { start: number; duration: number; midi: number }[],
  lengthTicks: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || lengthTicks <= 0 || notes.length === 0) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  let lo = 127, hi = 0;
  for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
  const range = Math.max(1, hi - lo);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (const n of notes) {
    const x = (n.start / lengthTicks) * w;
    const nw = Math.max(2, (n.duration / lengthTicks) * w);
    const y = h - 3 - ((n.midi - lo) / range) * (h - 6);
    ctx.fillRect(x, y, nw, 3);
  }
}
