import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { resolveAudioClipPlayback } from './audio-clip-voice';
import { sampleCache } from '../samples/sample-cache';

function tone(ctx: OfflineAudioContext, durationSec: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf as unknown as AudioBuffer;
}

describe('resolveAudioClipPlayback', () => {
  it('returns null when the buffer is not cached', () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const r = resolveAudioClipPlayback({
      ctx: ctx as unknown as AudioContext,
      sample: { sampleId: 'res-missing', mode: 'loop', trimStart: 0, trimEnd: 1 },
      gateDuration: 1, masterGain: 1,
    });
    expect(r).toBeNull();
  });

  it('a plain loop with gate == region plays at rate 1 from the trim offset', () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    sampleCache.put('res-loop', tone(ctx, 1.0, 220));
    const r = resolveAudioClipPlayback({
      ctx: ctx as unknown as AudioContext,
      sample: { sampleId: 'res-loop', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
      gateDuration: 1.0, masterGain: 1,
    });
    expect(r).not.toBeNull();
    expect(r!.bufferId).toBe('res-loop');
    expect(r!.rate).toBeCloseTo(1, 3);
    expect(r!.offset).toBeCloseTo(0, 3);
  });

  it('a half-length gate on a varispeed loop doubles the playback rate (region/gate)', () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    sampleCache.put('res-vari', tone(ctx, 1.0, 220));
    const r = resolveAudioClipPlayback({
      ctx: ctx as unknown as AudioContext,
      // mode 'loop', no warp → varispeed fill: rate = region/gate
      sample: { sampleId: 'res-vari', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
      gateDuration: 0.5, masterGain: 1,
    });
    expect(r!.rate).toBeCloseTo(2, 3);
  });

  it('folds masterGain × sample.gain × OUTPUT_TRIM into gain', () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    sampleCache.put('res-gain', tone(ctx, 1.0, 220));
    const full = resolveAudioClipPlayback({
      ctx: ctx as unknown as AudioContext,
      sample: { sampleId: 'res-gain', mode: 'loop', trimStart: 0, trimEnd: 1.0, gain: 1 },
      gateDuration: 1.0, masterGain: 1,
    });
    const half = resolveAudioClipPlayback({
      ctx: ctx as unknown as AudioContext,
      sample: { sampleId: 'res-gain', mode: 'loop', trimStart: 0, trimEnd: 1.0, gain: 0.5 },
      gateDuration: 1.0, masterGain: 1,
    });
    expect(half!.gain).toBeCloseTo(full!.gain * 0.5, 4);
  });
});
