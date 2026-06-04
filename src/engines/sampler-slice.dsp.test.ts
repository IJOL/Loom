// Construction mirrors src/engines/sampler-loop.dsp.test.ts: new SamplerEngine()
// + node-web-audio-api OfflineAudioContext.
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { sampleCache } from '../samples/sample-cache';

function makeBuffer(ctx: OfflineAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr, sr);
  const d = buf.getChannelData(0);
  // loud in [0.5s, 0.75s], silent elsewhere → a slice there should produce audio
  for (let i = 0; i < d.length; i++) d[i] = (i > sr * 0.5 && i < sr * 0.75) ? 0.8 : 0;
  return buf as unknown as AudioBuffer;
}

describe('sampler slice playback', () => {
  it('plays the slice region (produces audio for a loud sub-region)', async () => {
    const sr = 44100;
    const render = new OfflineAudioContext(1, sr, sr);
    sampleCache.put('smp-slice', makeBuffer(render));
    const engine = new SamplerEngine();
    const voice = engine.createVoice(render as unknown as AudioContext, render.destination as unknown as AudioNode);
    voice.trigger(36, 0, { gateDuration: 0.25, slice: { sampleId: 'smp-slice', start: 0.5, end: 0.75 } });
    const out = await render.startRendering();
    const d = out.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeGreaterThan(0.05);
  });
});
