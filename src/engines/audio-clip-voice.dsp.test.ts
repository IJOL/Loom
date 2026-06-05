import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { playAudioClip, OUTPUT_TRIM } from './audio-clip-voice';
import { sampleCache } from '../samples/sample-cache';

function tone(ctx: OfflineAudioContext, durationSec: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf as unknown as AudioBuffer;
}

describe('playAudioClip', () => {
  it('plays a cached loop buffer (non-silent) and returns a started source', async () => {
    expect(OUTPUT_TRIM).toBeGreaterThan(0);
    const sr = 44100;
    const render = new OfflineAudioContext(1, Math.ceil(1.0 * sr), sr);
    sampleCache.put('smp-a1', tone(render, 1.0, 220));
    const amp = render.createGain();
    amp.connect(render.destination as unknown as AudioNode);
    const r = playAudioClip({
      ctx: render as unknown as AudioContext,
      sample: { sampleId: 'smp-a1', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
      time: 0, gateDuration: 1.0, dest: amp, ampGain: amp, masterGain: 1,
    });
    expect(r).not.toBeNull();
    const out = await render.startRendering();
    const d = out.getChannelData(0);
    let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeGreaterThan(0.1);
  });

  it('returns null when the buffer is not cached', () => {
    const render = new OfflineAudioContext(1, 1, 44100);
    const amp = render.createGain();
    const r = playAudioClip({
      ctx: render as unknown as AudioContext,
      sample: { sampleId: 'missing', mode: 'loop', trimStart: 0, trimEnd: 1 },
      time: 0, gateDuration: 1, dest: amp, ampGain: amp, masterGain: 1,
    });
    expect(r).toBeNull();
  });
});
