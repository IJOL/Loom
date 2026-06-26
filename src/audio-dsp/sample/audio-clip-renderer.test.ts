// src/audio-dsp/sample/audio-clip-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { AudioClipRenderer } from './audio-clip-renderer';
import { SampleBank } from './sample-bank';
import type { SampleSpawn } from './types';

const SR = 48000;
const tone = (n: number) => {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.sin(2 * Math.PI * 220 * i / SR);
  return { channels: [c], sampleRate: SR };
};
const spawn = (o: Partial<SampleSpawn> = {}): SampleSpawn => ({
  sampleId: 's', beginSec: 0, gateSec: 0.2, rate: 1, offsetSec: 0,
  loop: false, loopStartSec: 0, loopEndSec: 0,
  cutoff: 1, res: 0, attack: 0.005, decay: 0.05,
  level: 1, pan: 0, rev: 0, dly: 0, gain: 1, ...o,
});
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('AudioClipRenderer', () => {
  it('plays the buffer audibly for the gate then is done', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const r = new AudioClipRenderer(spawn({ gateSec: 0.1 }), bank, SR);
    const b: number[] = [];
    // Sample within the gate (skip the very start fade-in).
    for (let i = SR * 0.02; i < SR * 0.08; i++) b.push(r.renderSample(i / SR));
    expect(rms(b)).toBeGreaterThan(0.05);
    // Past the gate → silent + done.
    r.renderSample(0.2);
    expect(r.done).toBe(true);
  });

  it('fades in from silence (no click at the start)', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const r = new AudioClipRenderer(spawn({ gateSec: 0.1 }), bank, SR);
    const first = Math.abs(r.renderSample(0));
    // A few ms in (past the ~5ms fade) the signal is much louder than the first sample.
    let mid = 0;
    for (let i = 1; i < SR * 0.02; i++) mid = Math.max(mid, Math.abs(r.renderSample(i / SR)));
    expect(first).toBeLessThan(mid * 0.5);
  });

  it('higher gain produces a louder signal', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR));
    const e = (gain: number) => {
      const r = new AudioClipRenderer(spawn({ gain, gateSec: 0.1 }), bank, SR);
      const b: number[] = [];
      for (let i = SR * 0.02; i < SR * 0.06; i++) b.push(r.renderSample(i / SR));
      return rms(b);
    };
    expect(e(1)).toBeGreaterThan(e(0.5) * 1.5);
  });

  it('missing sample id renders silence + done', () => {
    const r = new AudioClipRenderer(spawn({ sampleId: 'missing' }), new SampleBank(), SR);
    expect(r.renderSample(0)).toBe(0);
    expect(r.done).toBe(true);
  });

  it('preserves stereo: a hard-left stereo clip plays left, near-silent right', () => {
    const n = SR;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) { l[i] = Math.sin(2 * Math.PI * 220 * i / SR); r[i] = 0; }
    const bank = new SampleBank();
    bank.set('st', { channels: [l, r], sampleRate: SR });
    const v = new AudioClipRenderer(spawn({ sampleId: 'st', gateSec: 0.1 }), bank, SR);
    let maxL = 0, maxR = 0;
    for (let i = SR * 0.02; i < SR * 0.08; i++) { const { l: ll, r: rr } = v.renderStereoInto(i / SR); maxL = Math.max(maxL, Math.abs(ll)); maxR = Math.max(maxR, Math.abs(rr)); }
    expect(maxL).toBeGreaterThan(0.05);
    expect(maxR).toBeLessThan(maxL * 0.05);   // right channel stays silent → not mono-summed
  });

  it('noteOff cuts a long clip early (the transport-Stop path for the audio channel)', () => {
    const bank = new SampleBank();
    bank.set('s', tone(SR * 4));
    // A 4 s clip — without a cut it would keep sounding well past 1 s.
    const r = new AudioClipRenderer(spawn({ gateSec: 4 }), bank, SR);
    for (let i = 0; i < SR * 0.5; i++) r.renderSample(i / SR);   // play 0.5 s
    r.noteOff(0.5);                                              // Stop pressed
    // A short way past the cut (beyond the ~5 ms fade) it is silent + done.
    r.renderSample(0.6);
    expect(r.done).toBe(true);
    expect(r.renderSample(0.7)).toBe(0);
  });

  it('offsetSec seeks the buffer: samples rendered from the midpoint differ from samples rendered from the start', () => {
    // Ramp buffer: channel[i] = i / n, so values encode position.
    // At offset 0 the initial samples are near 0; at offset 0.5 s they are near 0.5.
    // We compare the mean of the first rendered block (past the 5 ms fade-in) for
    // both cases and assert the mid-offset block is much larger — a relative check
    // that does not depend on absolute magnitudes.
    const n = SR; // 1 s ramp
    const ramp = new Float32Array(n);
    for (let i = 0; i < n; i++) ramp[i] = i / n;
    const bank = new SampleBank();
    bank.set('ramp', { channels: [ramp], sampleRate: SR });

    const measure = (offsetSec: number) => {
      // gate = 0.4 s, gain = 1, rate = 1; beginSec = 0 (default).
      const r = new AudioClipRenderer(
        spawn({ sampleId: 'ramp', gateSec: 0.4, gain: 1, offsetSec }),
        bank, SR,
      );
      let sum = 0, count = 0;
      // Sample a window past the 5 ms fade-in (t in [0.01, 0.05] s).
      for (let i = Math.floor(SR * 0.01); i < Math.floor(SR * 0.05); i++) {
        sum += r.renderSample(i / SR);
        count++;
      }
      return sum / count;
    };

    const fromStart = measure(0);
    const fromMid = measure(0.5);
    // The mid-offset start position is ~0.5 in the ramp; the zero-offset position
    // is ~0.01–0.05, so the mid block should be at least 5× larger on average.
    expect(fromMid).toBeGreaterThan(fromStart * 5);
  });
});
