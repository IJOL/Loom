// src/samples/warp-stretch.dsp.test.ts
import { describe, it, expect } from 'vitest';
import { warpStretch, warpKey } from './warp-stretch';
import type { WarpMarker } from '../session/session';

const SR = 44100;

/** A buffer with a short click at each given time (seconds). */
function clickBuffer(ctx: BaseAudioContext, durationSec: number, clickSecs: number[]): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.round(durationSec * SR), SR);
  const d = buf.getChannelData(0);
  for (const t of clickSecs) {
    const s = Math.round(t * SR);
    for (let i = 0; i < 64 && s + i < d.length; i++) d[s + i] = 1;
  }
  return buf;
}
function onsetSecs(buf: AudioBuffer): number[] {
  // NOTE: the underlying OLA (stretchBuffer) Hann-windows each segment, which
  // legitimately crushes an isolated 64-sample test click to ~1e-2 amplitude
  // (a sustained signal would overlap-add back to unity). So we detect the
  // warped transient with a small threshold; the load-bearing assertions are
  // the *positions* (relative time windows), not the magnitude.
  const d = buf.getChannelData(0); const out: number[] = []; let last = -1;
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i]) > 0.003 && i - last > SR * 0.05) { out.push(i / SR); last = i; }
  }
  return out;
}

describe('warpStretch', () => {
  it('warps drifting beats onto an even grid', async () => {
    const ctx = new OfflineAudioContext(1, Math.round(2 * SR), SR);
    // Source: beats DRIFT (0, 0.5, 1.06, 1.5) over ~2 s; we want them at the even
    // grid 0,0.5,1.0,1.5 (gate 2 s, 4 beats → 0.5 s/beat). warpStretch maps each
    // marker to beat/lastBeat * gate, so the grid is "4 beats" only when there is
    // a closing beat-4 marker — add it (the buffer end) to make lastBeat=4.
    const src = clickBuffer(ctx, 1.9, [0, 0.5, 1.06, 1.5]);
    const markers: WarpMarker[] = [
      { srcSec: 0, beat: 0 }, { srcSec: 0.5, beat: 1 },
      { srcSec: 1.06, beat: 2 }, { srcSec: 1.5, beat: 3 }, { srcSec: 1.9, beat: 4 },
    ];
    const out = warpStretch(ctx, src, markers, 2.0);
    const beats = onsetSecs(out);
    // beat 2 was late (1.06) in the source; after warp it lands near 1.0.
    const near = beats.find((t) => Math.abs(t - 1.0) < 0.06);
    expect(near).toBeDefined();
    // and it is NOT still at ~1.06 (drift removed)
    expect(beats.some((t) => Math.abs(t - 1.06) < 0.02)).toBe(false);
  });

  it('warpKey is stable for the same markers+gate and differs otherwise', () => {
    const m: WarpMarker[] = [{ srcSec: 0, beat: 0 }, { srcSec: 0.5, beat: 1 }];
    expect(warpKey('s', m, 2)).toBe(warpKey('s', m, 2));
    expect(warpKey('s', m, 2)).not.toBe(warpKey('s', m, 3));
  });
});
