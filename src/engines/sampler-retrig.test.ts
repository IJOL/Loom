import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;
function putTone(id: string, ctx: OfflineAudioContext): void {
  const buf = ctx.createBuffer(1, Math.round(SR * 0.5), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.5;
  sampleCache.put(id, buf as unknown as AudioBuffer);
}
const KIT: KeymapEntry[] = [{ sampleId: 't', rootNote: 36, loNote: 36, hiNote: 36 }];

function setup() {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.5), SR);
  putTone('t', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const e = new SamplerEngine(); e.setSharedFx(fx); e.setKeymap(KIT);
  return { ctx: ctx as unknown as AudioContext, dest, e };
}

describe('sampler per-pad retrigger (mono)', () => {
  it('mono: a second hit cuts the first voice of the same pad', () => {
    const { ctx, dest, e } = setup();
    e.setBaseValue('zone36.retrig', 1); // mono
    const v1 = e.createVoice(ctx, dest);
    v1.trigger(36, 0, { gateDuration: 0.4, accent: false, slide: false });
    const cut = vi_spyRelease(v1);
    const v2 = e.createVoice(ctx, dest);
    v2.trigger(36, 0.05, { gateDuration: 0.4, accent: false, slide: false });
    expect(cut.calledWith).toBeGreaterThanOrEqual(0); // v1 was released by the engine when v2 hit
  });

  it('poly (default): a second hit does NOT cut the first', () => {
    const { ctx, dest, e } = setup(); // retrig default = poly
    const v1 = e.createVoice(ctx, dest);
    let released = false;
    (v1 as unknown as { release: (t: number) => void }).release = () => { released = true; };
    v1.trigger(36, 0, { gateDuration: 0.4, accent: false, slide: false });
    const v2 = e.createVoice(ctx, dest);
    v2.trigger(36, 0.05, { gateDuration: 0.4, accent: false, slide: false });
    expect(released).toBe(false);
  });
});

// tiny local spy helper (avoid importing vi just for this)
function vi_spyRelease(v: unknown): { calledWith: number } {
  const rec = { calledWith: -1 };
  const orig = (v as { release: (t: number) => void }).release.bind(v);
  (v as { release: (t: number) => void }).release = (t: number) => { rec.calledWith = t; orig(t); };
  return rec;
}
