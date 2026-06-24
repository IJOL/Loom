// src/audio-dsp/sample/sampler-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { SamplerRenderer } from './sampler-renderer';
import { SampleBank } from './sample-bank';
import type { SampleSpawn } from './types';

const SR = 48000;
const tone = (n: number) => {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.sin(2 * Math.PI * 440 * i / SR);
  return { channels: [c], sampleRate: SR };
};
const spawn = (o: Partial<SampleSpawn> = {}): SampleSpawn => ({
  sampleId: 's', beginSec: 0, gateSec: 0.2, rate: 1, offsetSec: 0,
  loop: false, loopStartSec: 0, loopEndSec: 0,
  cutoff: 1, res: 0, attack: 0.005, decay: 0.05,
  level: 1, pan: 0, rev: 0, dly: 0, gain: 1, ...o,
});
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('SamplerRenderer', () => {
  it('plays the sample audibly then is done', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const r = new SamplerRenderer(spawn(), bank, SR);
    const b: number[] = [];
    for (let i = 0; i < SR * 0.1; i++) b.push(r.renderSample(i / SR));
    expect(rms(b)).toBeGreaterThan(0.05);
    for (let i = SR * 0.1; i < SR * 0.5; i++) r.renderSample(i / SR);
    expect(r.done).toBe(true);
  });

  it('a lower cutoff removes high-frequency energy', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const e = (cut: number) => {
      const r = new SamplerRenderer(spawn({ cutoff: cut }), bank, SR);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.05; i++) b.push(r.renderSample(i / SR));
      return rms(b);
    };
    expect(e(1)).toBeGreaterThan(e(0.1) * 1.1);
  });

  it('missing sample id renders silence + done', () => {
    const r = new SamplerRenderer(spawn({ sampleId: 'missing' }), new SampleBank(), SR);
    expect(r.renderSample(0)).toBe(0);
    expect(r.done).toBe(true);
  });

  it('per-pad send levels scale the dry signal', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const r = new SamplerRenderer(spawn({ rev: 0.5, dly: 0.25 }), bank, SR);
    // Render a few samples past the attack so the dry signal is non-trivial.
    let maxRev = 0, maxDly = 0, maxDry = 0;
    for (let i = 0; i < SR * 0.02; i++) {
      const dry = Math.abs(r.renderSample(i / SR));
      maxDry = Math.max(maxDry, dry);
      maxRev = Math.max(maxRev, Math.abs(r.sendRev()));
      maxDly = Math.max(maxDly, Math.abs(r.sendDly()));
    }
    // sendRev is the dry × 0.5, sendDly is dry × 0.25 → rev twice dly, both < dry.
    expect(maxRev).toBeGreaterThan(maxDly);
    expect(maxRev).toBeLessThan(maxDry);
  });

  it('higher gain produces a louder dry signal', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const e = (gain: number) => {
      const r = new SamplerRenderer(spawn({ gain }), bank, SR);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.02; i++) b.push(r.renderSample(i / SR));
      return rms(b);
    };
    expect(e(1)).toBeGreaterThan(e(0.5) * 1.5);
  });

  it('reports the spawn pan', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const r = new SamplerRenderer(spawn({ pan: -0.5 }), bank, SR);
    expect(r.pan()).toBe(-0.5);
  });
});
