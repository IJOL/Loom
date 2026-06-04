import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import { rms } from '../../test/dsp-asserts';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;
function putTone(id: string, ctx: OfflineAudioContext): void {
  const buf = ctx.createBuffer(1, Math.round(SR * 0.2), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 0.7;
  sampleCache.put(id, buf as unknown as AudioBuffer);
}
const KIT: KeymapEntry[] = [
  { sampleId: 'k', rootNote: 36, loNote: 36, hiNote: 36 },
  { sampleId: 's', rootNote: 38, loNote: 38, hiNote: 38 },
];
async function renderNote(note: number, mut: (e: SamplerEngine) => void): Promise<number> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.3), SR);
  putTone('k', ctx); putTone('s', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const e = new SamplerEngine(); e.setSharedFx(fx); e.setKeymap(KIT);
  mut(e);
  const v = e.createVoice(ctx as unknown as AudioContext, dest);
  v.trigger(note, 0, { gateDuration: 0.15, accent: false, slide: false });
  return rms(new Float32Array((await ctx.startRendering()).getChannelData(0)));
}

describe('sampler per-pad mute/solo', () => {
  it('muting kick silences the kick pad, snare unaffected', async () => {
    expect(await renderNote(36, (e) => e.setDrumVoiceMute('kick', true))).toBeLessThan(1e-4);
    expect(await renderNote(38, (e) => e.setDrumVoiceMute('kick', true))).toBeGreaterThan(1e-3);
  });
  it('soloing snare silences the kick', async () => {
    expect(await renderNote(36, (e) => e.toggleDrumVoiceSolo('snare'))).toBeLessThan(1e-4);
    expect(await renderNote(38, (e) => e.toggleDrumVoiceSolo('snare'))).toBeGreaterThan(1e-3);
  });
});
