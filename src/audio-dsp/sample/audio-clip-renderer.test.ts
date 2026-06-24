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
});
