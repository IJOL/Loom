import { describe, it, expect } from 'vitest';
import { audioRetrigger } from './audio-retrigger';
import { DEFAULT_METER } from './meter';
import type { SessionClip } from '../session/session';

const audioClip = (lengthBars: number, trimStart: number, trimEnd: number): SessionClip =>
  ({ id: 'a', lengthBars, notes: [], sample: { sampleId: 's', trimStart, trimEnd } } as any);

describe('audioRetrigger', () => {
  it('returns null for a note clip (no sample)', () => {
    expect(audioRetrigger({ id: 'n', lengthBars: 1, notes: [] } as any, DEFAULT_METER, 1, 2, 10)).toBeNull();
  });
  it('returns null at phase 0 (head trigger needs no offset)', () => {
    expect(audioRetrigger(audioClip(2, 0, 8), DEFAULT_METER, 0, 4, 8)).toBeNull();
  });
  it('maps half-way phase to the mid source second', () => {
    // 2-bar clip @120 = 4s iteration; trim [0,8] → whole buffer; phase 2s = frac 0.5 → offset 4s
    const r = audioRetrigger(audioClip(2, 0, 8), DEFAULT_METER, 2, 4, 8)!;
    expect(r.offsetSec).toBeCloseTo(4, 6);
    expect(r.gateSec).toBeCloseTo(2, 6);
  });
  it('respects trimStart/trimEnd span', () => {
    // trim [2,6] span 4; phase frac 0.25 → offset 2 + 0.25*4 = 3
    const r = audioRetrigger(audioClip(4, 2, 6), DEFAULT_METER, 2, 8, 10)!;
    expect(r.offsetSec).toBeCloseTo(3, 6);
  });
});
