// Rimshot + crash render real audio, and each sounds like what it claims to be.
// The renderers are pure, so this drives them sample-by-sample — no worklet.
// Assertions are relative (ratios against a sibling voice or against the voice's
// own tail), never absolute magnitudes.

import { describe, it, expect } from 'vitest';
import { DRUM_RENDERERS } from './voices';
import { seedSynthState, BY_ID } from '../../core/drums';
import type { DrumVoiceId } from './types';

const SR = 44100;

/** Render `seconds` of a voice from t=0 and report what came out. */
function render(voice: DrumVoiceId, seconds: number, kitId = '909') {
  const params = seedSynthState(BY_ID[kitId])[voice];
  const r = DRUM_RENDERERS[voice]({ voice, beginSec: 0, velocity: 1 }, params, SR);
  const n = Math.floor(seconds * SR);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = r.renderSample(i / SR);
  const rms = (from: number, to: number) => {
    let sum = 0;
    const a = Math.floor(from * SR), b = Math.min(n, Math.floor(to * SR));
    for (let i = a; i < b; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / Math.max(1, b - a));
  };
  // Loop, don't spread — a 3 s buffer is 132k samples and blows the call stack.
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
  return { buf, rms, peak };
}

describe('rimshot', () => {
  it('makes a sound at all', () => {
    const { peak } = render('rimshot', 0.2);
    expect(peak).toBeGreaterThan(0);
  });

  it('is a dry click: its energy is gone long before a snare would be', () => {
    const rim = render('rimshot', 0.3);
    const snare = render('snare', 0.3);
    // Both fire at t=0. 100 ms later the rimshot must have decayed far more.
    expect(rim.rms(0.1, 0.3)).toBeLessThan(snare.rms(0.1, 0.3));
    // And it must have had real energy up front, or "quiet later" proves nothing.
    expect(rim.rms(0, 0.02)).toBeGreaterThan(rim.rms(0.1, 0.3) * 10);
  });
});

describe('crash', () => {
  it('makes a sound at all', () => {
    const { peak } = render('crash', 1);
    expect(peak).toBeGreaterThan(0);
  });

  it('rings far longer than the ride it is derived from', () => {
    const crash = render('crash', 3);
    const ride = render('ride', 3);
    // At 1.5 s the 909 ride (decay 1.2) is done; the crash (decay 2.2) still rings.
    expect(crash.rms(1.5, 2.0)).toBeGreaterThan(ride.rms(1.5, 2.0));
  });

  it('sustains rather than clicking: it still has energy halfway through its decay', () => {
    const crash = render('crash', 3);
    expect(crash.rms(1.0, 1.2)).toBeGreaterThan(0);
    expect(crash.rms(0, 0.05)).toBeGreaterThan(crash.rms(1.0, 1.2));
  });
});

describe('every kit', () => {
  it('renders both new voices audibly, in all five kits', () => {
    for (const kit of ['808', '909', '606', '78', 'linn']) {
      for (const voice of ['rimshot', 'crash'] as DrumVoiceId[]) {
        const { peak } = render(voice, 0.5, kit);
        expect(peak, `${kit}/${voice} is silent`).toBeGreaterThan(0);
      }
    }
  });
});
