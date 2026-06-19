import { describe, it, expect, beforeAll } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { registerPlugin } from '../plugins/registry';
import { reverbPlugin } from '../plugins/fx/reverb';
import { delayPlugin } from '../plugins/fx/delay';
import { sampleCache } from '../samples/sample-cache';
import { padKeyForNote } from './sampler-pad-params';
import { rms } from '../../test/dsp-asserts';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;
function putTone(id: string, ctx: OfflineAudioContext): void {
  const buf = ctx.createBuffer(1, Math.round(SR * 0.2), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 0.8;
  sampleCache.put(id, buf as unknown as AudioBuffer);
}
const KIT: KeymapEntry[] = [{ sampleId: 'k', rootNote: 36, loNote: 36, hiNote: 36 }];

// Render STEREO so PAN is observable.
async function render(mut: (e: SamplerEngine) => void): Promise<{ L: Float32Array; R: Float32Array; revTail: number }> {
  const ctx = new OfflineAudioContext(2, Math.round(SR * 0.6), SR);
  putTone('k', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  // Set reverb (bus B) fully wet by addressing the seeded reverb insert directly.
  fx.getSendBus('B').inserts.list()[0]?.fx.setBaseValue('wet', 1);
  const e = new SamplerEngine(); e.setSharedFx(fx); e.setKeymap(KIT);
  mut(e);
  const v = e.createVoice(ctx as unknown as AudioContext, dest);
  v.trigger(36, 0, { gateDuration: 0.1, accent: false, slide: false });
  const ab = await ctx.startRendering();
  const L = new Float32Array(ab.getChannelData(0));
  const R = new Float32Array(ab.getChannelData(1));
  const revTail = rms(L.subarray(Math.round(0.3 * SR))); // long after the 0.1s gate = reverb only
  return { L, R, revTail };
}

describe('sampler per-pad mixer', () => {
  // FxBus seeds its reverb (bus B) / delay (bus A) sends via the plugin
  // registry; register them so the seeds exist — matches the app, which
  // bootstraps plugins before building the audio graph.
  beforeAll(() => { registerPlugin(reverbPlugin); registerPlugin(delayPlugin); });

  it('PAN left pushes more energy to L than R', async () => {
    const { L, R } = await render((e) => e.setBaseValue(`${padKeyForNote(36)}.pan`, -1));
    expect(rms(L)).toBeGreaterThan(rms(R) * 1.5);
  });
  it('REV send up adds reverb tail energy', async () => {
    const dry = await render((e) => e.setBaseValue(`${padKeyForNote(36)}.rev`, 0));
    const wet = await render((e) => e.setBaseValue(`${padKeyForNote(36)}.rev`, 1));
    expect(wet.revTail).toBeGreaterThan(dry.revTail * 2);
  });
});
