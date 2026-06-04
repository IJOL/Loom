import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import { spectralCentroid, rms } from '../../test/dsp-asserts';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;

// A short bright noise burst as the kick sample, a second for the snare.
function putNoise(id: string, ctx: OfflineAudioContext, dur = 0.3): void {
  const buf = ctx.createBuffer(1, Math.round(SR * dur), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (SR * 0.1));
  sampleCache.put(id, buf as unknown as AudioBuffer);
}

const KIT: KeymapEntry[] = [
  { sampleId: 'kick', rootNote: 36, loNote: 36, hiNote: 36 },
  { sampleId: 'snare', rootNote: 38, loNote: 38, hiNote: 38 },
];

async function renderNote(note: number, mut: (e: SamplerEngine) => void): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.5), SR);
  putNoise('kick', ctx); putNoise('snare', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const e = new SamplerEngine();
  e.setSharedFx(fx);
  e.setKeymap(KIT);
  mut(e);
  const v = e.createVoice(ctx as unknown as AudioContext, dest);
  v.trigger(note, 0, { gateDuration: 0.2, accent: false, slide: false });
  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

describe('sampler per-pad sound params are independent per pad', () => {
  it('kick CUTOFF down darkens the kick (lower centroid)', async () => {
    const open = await renderNote(36, (e) => e.setBaseValue('kick.cutoff', 1));
    const dark = await renderNote(36, (e) => e.setBaseValue('kick.cutoff', 0.15));
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR));
  });

  it('kick TUNE only affects the kick, not the snare', async () => {
    // Tuning the kick up raises its centroid; the snare (untouched) is unchanged.
    const kickLo = await renderNote(36, () => {});
    const kickHi = await renderNote(36, (e) => e.setBaseValue('kick.tune', 12));
    expect(spectralCentroid(kickHi, SR)).toBeGreaterThan(spectralCentroid(kickLo, SR));
    const snareA = await renderNote(38, (e) => e.setBaseValue('kick.tune', 12));
    const snareB = await renderNote(38, () => {});
    expect(rms(snareA)).toBeCloseTo(rms(snareB), 5); // kick tune left snare alone
  });

  it('kick DECAY shorter shortens its tail', async () => {
    const tail = (b: Float32Array) => rms(b.subarray(Math.round(0.25 * SR)));
    const long  = await renderNote(36, (e) => e.setBaseValue('kick.decay', 0.4));
    const short = await renderNote(36, (e) => e.setBaseValue('kick.decay', 0.02));
    expect(tail(short)).toBeLessThan(tail(long));
  });
});
