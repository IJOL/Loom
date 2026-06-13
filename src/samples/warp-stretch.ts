// src/samples/warp-stretch.ts
// Piecewise OLA time-stretch driven by warp markers. Each segment between two
// markers is stretched (pitch-preserved, via stretchBuffer) so its END lands on
// the marker's grid time, then written into the output with a short equal-power
// crossfade at the seam to mask the join. Output length == gateSec (the clip's
// grid length in seconds), so the result drops straight into playback at rate 1.
import type { WarpMarker } from '../session/session';
import { stretchBuffer } from './timestretch';

const XFADE_SEC = 0.004;

/** Cache key: a warp result depends on the sample, the marker set, and the gate
 *  (which encodes lengthBars × tempo). */
export function warpKey(sampleId: string, markers: WarpMarker[], gateSec: number): string {
  const m = markers.map((x) => `${x.srcSec.toFixed(3)}:${x.beat}`).join(',');
  return `${sampleId}|${m}|${gateSec.toFixed(3)}`;
}

/** Copy buffer[startSec, endSec) into a fresh mono-or-multi buffer. */
function sliceSegment(ctx: BaseAudioContext, buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const s = Math.max(0, Math.round(startSec * sr));
  const e = Math.min(buffer.length, Math.round(endSec * sr));
  const len = Math.max(1, e - s);
  const out = ctx.createBuffer(buffer.numberOfChannels, len, sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(s, e));
  }
  return out;
}

export function warpStretch(
  ctx: BaseAudioContext, buffer: AudioBuffer, markers: WarpMarker[], gateSec: number,
): AudioBuffer {
  const sr = buffer.sampleRate;
  const lastBeat = markers.length ? markers[markers.length - 1].beat : 0;
  const outLen = Math.max(1, Math.round(gateSec * sr));
  const out = ctx.createBuffer(buffer.numberOfChannels, outLen, sr);
  if (markers.length < 2 || lastBeat <= 0) return out;

  const targetSec = (beat: number) => (beat / lastBeat) * gateSec;
  const xf = Math.max(1, Math.round(XFADE_SEC * sr));

  for (let i = 0; i < markers.length - 1; i++) {
    const a = markers[i], b = markers[i + 1];
    const srcDur = Math.max(1 / sr, b.srcSec - a.srcSec);
    const outDur = Math.max(1 / sr, targetSec(b.beat) - targetSec(a.beat));
    const ratio = outDur / srcDur;
    const seg = stretchBuffer(ctx, sliceSegment(ctx, buffer, a.srcSec, b.srcSec), ratio);
    const off = Math.round(targetSec(a.beat) * sr);
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const o = out.getChannelData(ch);
      const sBuf = seg.getChannelData(Math.min(ch, seg.numberOfChannels - 1));
      for (let j = 0; j < sBuf.length; j++) {
        const di = off + j;
        if (di < 0 || di >= outLen) continue;
        // equal-power fade in/out over xf samples at the segment ends so adjacent
        // segments sum smoothly at the seam.
        let g = 1;
        if (i > 0 && j < xf) g = Math.sin((j / xf) * (Math.PI / 2));
        if (i < markers.length - 2 && j > sBuf.length - xf) g = Math.sin(((sBuf.length - j) / xf) * (Math.PI / 2));
        o[di] += sBuf[j] * g;
      }
    }
  }
  return out;
}
