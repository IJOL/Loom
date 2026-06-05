// src/engines/audio.dsp.test.ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine } from './audio';
import { createEngineInstance, getEngine } from './registry';
import { sampleCache } from '../samples/sample-cache';

function tone(ctx: OfflineAudioContext, durationSec: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf as unknown as AudioBuffer;
}

describe('audio engine', () => {
  it('is registered under id "audio" via factory', () => {
    expect(getEngine('audio')?.id).toBe('audio');
    expect(createEngineInstance('audio')?.id).toBe('audio');
  });

  it('plays a clip sample buffer (non-silent)', async () => {
    const sr = 44100;
    const render = new OfflineAudioContext(1, Math.ceil(1.0 * sr), sr);
    sampleCache.put('smp-au', tone(render, 1.0, 220));
    const engine = new AudioEngine();
    const voice = engine.createVoice(render as unknown as AudioContext, render.destination as unknown as AudioNode);
    voice.trigger(60, 0, {
      gateDuration: 1.0,
      sample: { sampleId: 'smp-au', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
    });
    const out = await render.startRendering();
    const d = out.getChannelData(0);
    let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeGreaterThan(0.1);
  });
});
