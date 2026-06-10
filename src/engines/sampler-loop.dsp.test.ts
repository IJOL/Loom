import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import { padKeyForNote } from './sampler-pad-params';
import { rms } from '../../test/dsp-asserts';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;
// A SHORT 50 ms tone; without loop it is silent after 50 ms, with loop it sustains.
function putShort(id: string, ctx: OfflineAudioContext): void {
  const buf = ctx.createBuffer(1, Math.round(SR * 0.05), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.7;
  sampleCache.put(id, buf as unknown as AudioBuffer);
}
const KIT: KeymapEntry[] = [{ sampleId: 's', rootNote: 36, loNote: 36, hiNote: 36 }];

async function render(loop: number): Promise<number> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.5), SR);
  putShort('s', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const e = new SamplerEngine(); e.setSharedFx(fx); e.setKeymap(KIT);
  e.setBaseValue(`${padKeyForNote(36)}.loop`, loop);
  e.setBaseValue(`${padKeyForNote(36)}.decay`, 0.01);
  const v = e.createVoice(ctx as unknown as AudioContext, dest);
  v.trigger(36, 0, { gateDuration: 0.3, accent: false, slide: false }); // gate 300ms >> 50ms sample
  const ab = await ctx.startRendering();
  // energy in the 100..250 ms window — silent (one-shot) vs sustained (loop).
  return rms(new Float32Array(ab.getChannelData(0)).subarray(Math.round(0.1 * SR), Math.round(0.25 * SR)));
}

describe('sampler per-pad loop', () => {
  it('loop on sustains a short sample through the gate', async () => {
    const oneShot = await render(0);
    const looped  = await render(1);
    expect(looped).toBeGreaterThan(oneShot * 4);
  });
});
