// The existing varispeed path (region/gate) ALSO fills the gate, so duration
// can't distinguish stretch from varispeed — PITCH does. Stretched buffer plays
// at 220Hz (rate 1.0); varispeed would shift it to 220*region/gate ≈ 147Hz.
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { sampleCache } from '../samples/sample-cache';
import { stretchCache } from '../samples/stretch-cache';

function tone(ctx: OfflineAudioContext, durationSec: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf as unknown as AudioBuffer;
}

describe('sampler stretch playback', () => {
  it('uses the cached stretched buffer at rate 1.0 (pitch preserved)', async () => {
    const sr = 44100;
    const render = new OfflineAudioContext(1, Math.ceil(1.6 * sr), sr);
    sampleCache.put('smp-st', tone(render, 1.0, 220));
    // gate 1.5s, region 1.0s → ratio 1.5. Cache a 1.5s 220Hz tone as the "stretched" buffer.
    stretchCache.clear();
    await stretchCache.ensure('smp-st', 1.5, () => tone(render, 1.5, 220));
    const engine = new SamplerEngine();
    const voice = engine.createVoice(render as unknown as AudioContext, render.destination as unknown as AudioNode);
    voice.trigger(60, 0, {
      gateDuration: 1.5,
      sample: { sampleId: 'smp-st', mode: 'loop', warp: true, warpMode: 'stretch', trimStart: 0, trimEnd: 1.0 },
    });
    const out = await render.startRendering();
    const d = out.getChannelData(0);
    // measured pitch via zero-crossings ≈ 220 (stretched), NOT ~147 (varispeed).
    const a = Math.floor(0.2 * sr), b = Math.floor(1.2 * sr);
    let cross = 0; for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) cross++;
    const freq = (cross / 2) * (sr / (b - a));
    expect(freq).toBeGreaterThan(200);
    expect(freq).toBeLessThan(240);
  });
});
