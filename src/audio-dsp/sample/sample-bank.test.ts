// src/audio-dsp/sample/sample-bank.test.ts
import { describe, it, expect } from 'vitest';
import { SampleBank, BufferPlayer } from './sample-bank';
import type { SampleData } from './types';

const SR = 48000;
function ramp(n: number): SampleData {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = i / n;
  return { channels: [c], sampleRate: SR };
}
// A buffer whose samples are all strictly positive, so a returned 0 unambiguously
// means "past the end" (a plain ramp starts at 0, which would falsely look like
// the end on the very first read).
function plateau(n: number): SampleData {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = 1 - i / (n * 2); // 1 → ~0.5, never 0
  return { channels: [c], sampleRate: SR };
}

describe('SampleBank', () => {
  it('stores and retrieves by id', () => {
    const b = new SampleBank();
    const d = ramp(10);
    b.set('x', d);
    expect(b.get('x')).toBe(d);
    expect(b.has('x')).toBe(true);
    expect(b.has('y')).toBe(false);
    expect(b.get('y')).toBeUndefined();
  });
});

describe('BufferPlayer', () => {
  it('plays through the buffer then returns 0 (no loop)', () => {
    const p = new BufferPlayer(ramp(100), SR);
    let last = 1;
    for (let i = 0; i < 200; i++) last = p.update(1);
    expect(last).toBe(0);
  });

  it('rate 2 advances twice as fast (reaches end in half the samples)', () => {
    const p1 = new BufferPlayer(plateau(100), SR);
    let n1 = 0;
    while (p1.update(1) !== 0 && n1 < 1000) n1++;
    const p2 = new BufferPlayer(plateau(100), SR);
    let n2 = 0;
    while (p2.update(2) !== 0 && n2 < 1000) n2++;
    expect(n2).toBeLessThan(n1 * 0.6);
  });

  it('loops between loopStart and loopEnd indefinitely', () => {
    const p = new BufferPlayer(ramp(100), SR);
    p.setLoop(true, 0, 100 / SR);
    let nonzero = false;
    for (let i = 0; i < 500; i++) if (p.update(1) !== 0) nonzero = true;
    expect(nonzero).toBe(true); // still producing after the buffer length
  });

  it('setEnd trims a one-shot: stops producing past the end position', () => {
    // 100-sample plateau, end at 40 samples → past index 40 it returns 0.
    const p = new BufferPlayer(plateau(100), SR);
    p.setEnd(40 / SR);
    let firstZeroAt = -1;
    for (let i = 0; i < 100; i++) {
      const v = p.update(1);
      if (v === 0 && firstZeroAt < 0) firstZeroAt = i;
    }
    expect(firstZeroAt).toBeGreaterThan(0);
    expect(firstZeroAt).toBeLessThan(60);   // trimmed well before the 100-sample end
  });

  it('preserves distinct L/R for a stereo source (no mono collapse)', () => {
    // L ramps up, R ramps down → opposite channels. After a read, lastL != lastR.
    const n = 100;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) { l[i] = (i + 1) / n; r[i] = 1 - i / n; }
    const p = new BufferPlayer({ channels: [l, r], sampleRate: SR }, SR);
    p.update(1);   // read sample ~0: L≈0.01, R≈1.0
    p.update(1);
    expect(p.lastL).not.toBeCloseTo(p.lastR, 2);
    // mono mix is the average of the two channels
    expect(p.update(1)).toBeCloseTo((p.lastL + p.lastR) / 2, 6);
  });

  it('a mono source reports equal L/R', () => {
    const p = new BufferPlayer(plateau(100), SR);
    p.update(1);
    expect(p.lastL).toBe(p.lastR);
  });
});
