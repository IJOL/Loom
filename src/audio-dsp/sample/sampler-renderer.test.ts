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

  it('per-pad send levels scale the dry signal (rev and dly stay separate)', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const r = new SamplerRenderer(spawn({ rev: 0.5, dly: 0.25 }), bank, SR);
    // Render a few samples past the attack so the dry signal is non-trivial.
    let maxRev = 0, maxDly = 0, maxDry = 0;
    for (let i = 0; i < SR * 0.02; i++) {
      const dry = Math.abs(r.renderSample(i / SR));
      maxDry = Math.max(maxDry, dry);
      maxRev = Math.max(maxRev, Math.abs(r.sendRevL()) + Math.abs(r.sendRevR()));
      maxDly = Math.max(maxDly, Math.abs(r.sendDlyL()) + Math.abs(r.sendDlyR()));
    }
    // sendRev is the dry × 0.5, sendDly is dry × 0.25 → rev twice dly, both < dry.
    expect(maxRev).toBeGreaterThan(maxDly);
    expect(maxRev).toBeLessThan(maxDry);
  });

  it('a reverb-only pad feeds the reverb send but NOT the delay send', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const r = new SamplerRenderer(spawn({ rev: 0.8, dly: 0 }), bank, SR);
    let maxRev = 0, maxDly = 0;
    for (let i = 0; i < SR * 0.02; i++) {
      r.renderSample(i / SR);
      maxRev = Math.max(maxRev, Math.abs(r.sendRevL()) + Math.abs(r.sendRevR()));
      maxDly = Math.max(maxDly, Math.abs(r.sendDlyL()) + Math.abs(r.sendDlyR()));
    }
    expect(maxRev).toBeGreaterThan(0);
    expect(maxDly).toBe(0);   // delay send must stay silent for a rev-only pad
  });

  it('honours the one-shot trim-out (endSec): little/no source audio past sampleEnd', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    // Low cutoff so the per-pad filter passes the source cleanly (its own
    // high-cutoff ring is a separate concern); measure the source, not the filter.
    const tailRms = (over: Partial<SampleSpawn>) => {
      const r = new SamplerRenderer(spawn({ gateSec: 0.1, attack: 0.001, decay: 0.001, cutoff: 0.4, ...over }), bank, SR);
      const tail: number[] = [];
      for (let i = 0; i < SR * 0.05; i++) { const v = r.renderSample(i / SR); if (i >= SR * 0.012) tail.push(v); }
      return rms(tail);
    };
    // Trimmed at 10 ms: the 12-50 ms window is (near-)silent vs the un-trimmed
    // clip, which keeps playing the tone through the whole gate.
    const trimmed = tailRms({ endSec: 0.01 });
    const full = tailRms({});
    expect(full).toBeGreaterThan(0.05);
    expect(trimmed).toBeLessThan(full * 0.05);
  });

  it('a centred mono sample pans equal-power (L ≈ R, both ≈ 0.707 of the mono level)', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const r = new SamplerRenderer(spawn({ pan: 0 }), bank, SR);
    let maxL = 0, maxR = 0;
    for (let i = 0; i < SR * 0.02; i++) { const { l, r: rr } = r.renderStereoInto(i / SR); maxL = Math.max(maxL, Math.abs(l)); maxR = Math.max(maxR, Math.abs(rr)); }
    expect(maxL).toBeCloseTo(maxR, 3);
    expect(maxL).toBeGreaterThan(0);
  });

  it('preserves a stereo sample image (opposite channels stay distinct, no mono-sum)', () => {
    const n = SR;
    const l = new Float32Array(n);
    const rch = new Float32Array(n);
    for (let i = 0; i < n; i++) { l[i] = Math.sin(2 * Math.PI * 440 * i / SR); rch[i] = 0; }
    const bank = new SampleBank();
    bank.set('st', { channels: [l, rch], sampleRate: SR });
    // pan=0 (identity for a stereo source): left channel has the tone, right is silent.
    const r = new SamplerRenderer(spawn({ sampleId: 'st', pan: 0 }), bank, SR);
    let maxL = 0, maxR = 0;
    for (let i = 0; i < SR * 0.02; i++) { const { l: ll, r: rr } = r.renderStereoInto(i / SR); maxL = Math.max(maxL, Math.abs(ll)); maxR = Math.max(maxR, Math.abs(rr)); }
    expect(maxL).toBeGreaterThan(0.05);
    expect(maxR).toBeLessThan(maxL * 0.05);   // right stays near-silent → image preserved
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
