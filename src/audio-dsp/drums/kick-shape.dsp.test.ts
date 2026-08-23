// The kick's SNAP / TONE / DRIVE layers, added after measuring Karst's factory
// kick. Each one is proved to do its job AND proved to be inert at its default,
// because the whole point of the defaults is that no shipped kit moved.
// Assertions are relative — ratios against the same kick rendered another way.

import { describe, it, expect } from 'vitest';
import { DRUM_RENDERERS, KICK_TONE_OPEN } from './voices';
import { seedSynthState, BY_ID } from '../../core/drums';
import type { ParamBag } from '../types';

const SR = 44100;

function kickParams(over: Record<string, number> = {}, kitId = '909'): ParamBag {
  return { ...seedSynthState(BY_ID[kitId]).kick, ...over } as ParamBag;
}

function render(params: ParamBag, seconds = 0.5, choke?: number) {
  const r = DRUM_RENDERERS.kick({ voice: 'kick', beginSec: 0, velocity: 1 }, params, SR);
  const n = Math.floor(seconds * SR);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (choke != null && t >= choke) { r.choke(choke); choke = undefined; }
    buf[i] = r.renderSample(t);
  }
  const rms = (from: number, to: number) => {
    let sum = 0;
    const a = Math.floor(from * SR), b = Math.min(n, Math.floor(to * SR));
    for (let i = a; i < b; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / Math.max(1, b - a));
  };
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
  // Brightness over a WINDOW: a first difference is a +6 dB/oct highpass, so its
  // RMS over the window divided by the window RMS is a level-independent measure
  // of how much high end is in there. It must be windowed — over a whole kick the
  // body dominates and a 15 ms click cannot move the average.
  const hf = (from: number, to: number) => {
    const a = Math.max(1, Math.floor(from * SR)), b = Math.min(n, Math.floor(to * SR));
    let d = 0;
    for (let i = a; i < b; i++) { const x = buf[i] - buf[i - 1]; d += x * x; }
    return Math.sqrt(d / Math.max(1, b - a));
  };
  // hf normalised by level, for the case where a layer ADDS high end without
  // moving the level. Do not use it to judge a filter: a lowpass drops the
  // denominator too, and the ratio then understates what the filter did.
  const bright = (from: number, to: number) => hf(from, to) / Math.max(1e-9, rms(from, to));
  return { buf, rms, peak, hf, bright, done: r.done };
}

describe('kick defaults', () => {
  it('render exactly the kick that shipped before the new layers existed', () => {
    // The old param bag had none of these keys at all. If the defaults are the
    // OFF values, the two renders must agree sample for sample — no filter
    // colouring, no saturation, no noise.
    const now = kickParams();
    const before = { ...now };
    delete (before as Record<string, number>).snap;
    delete (before as Record<string, number>).snapDecay;
    delete (before as Record<string, number>).tone;
    delete (before as Record<string, number>).drive;

    const a = render(now), b = render(before as ParamBag);
    let worst = 0;
    for (let i = 0; i < a.buf.length; i++) worst = Math.max(worst, Math.abs(a.buf[i] - b.buf[i]));
    expect(worst).toBe(0);
  });

  it('are the OFF values in every shipped kit', () => {
    for (const kit of ['808', '909', '606', '78', 'linn']) {
      const p = seedSynthState(BY_ID[kit]).kick;
      expect(p.snap, `${kit} seeds snap on`).toBe(0);
      expect(p.drive, `${kit} seeds drive on`).toBe(0);
      expect(p.tone, `${kit} seeds the filter closed`).toBe(KICK_TONE_OPEN);
    }
  });
});

describe('TONE — the 4-pole lowpass', () => {
  it('darkens the kick when closed, and leaves it alone when open', () => {
    const open = render(kickParams());
    const shut = render(kickParams({ tone: 400 }));
    // 24 dB/oct at 400 Hz over the attack, where the 1500 Hz square click lives:
    // high-frequency energy has to collapse (measured 0.38 of open).
    expect(shut.hf(0, 0.02)).toBeLessThan(open.hf(0, 0.02) * 0.5);
    // And it must be a filter, not a fader — the body, well under the corner,
    // keeps most of its level (measured 0.66 of open).
    expect(shut.rms(0.05, 0.2)).toBeGreaterThan(open.rms(0.05, 0.2) * 0.5);
  });
});

describe('DRIVE — the saturator', () => {
  it('squares the waveform up without simply making it louder', () => {
    const clean = render(kickParams());
    const dirty = render(kickParams({ drive: 1 }));
    // Crest factor (peak/rms) falls as the tanh flattens the tops.
    const crest = (r: { peak: number; rms: (a: number, b: number) => number }) =>
      r.peak / Math.max(1e-9, r.rms(0, 0.2));
    expect(crest(dirty)).toBeLessThan(crest(clean));
    // Normalised, so the peak must not run away — that is what makes an A/B fair.
    expect(dirty.peak).toBeLessThan(clean.peak * 1.2);
  });
});

describe('SNAP — the noise transient on its own envelope', () => {
  it('adds attack without touching the body', () => {
    const dry = render(kickParams());
    const snap = render(kickParams({ snap: 0.8, snapDecay: 0.01 }));
    expect(snap.bright(0, 0.01)).toBeGreaterThan(dry.bright(0, 0.01) * 2);
    // Its envelope is its own and short, so 200 ms in the two must agree.
    expect(snap.rms(0.2, 0.4)).toBeCloseTo(dry.rms(0.2, 0.4), 6);
  });

  it('is not cut short when it outlives the body envelope', () => {
    // Body decay 0.05, snap 0.15: without extraDecay the voice would report done
    // and go silent while the snap was still ringing.
    const r = render(kickParams({ decay: 0.05, snap: 1, snapDecay: 0.15 }), 0.2);
    expect(r.rms(0.08, 0.12)).toBeGreaterThan(0);
    expect(r.done).toBe(false);
  });

  it('is silenced by a choke like everything else', () => {
    const r = render(kickParams({ snap: 1, snapDecay: 0.15 }), 0.2, 0.02);
    // 6 ms fade from the choke at 20 ms → dead by 30 ms.
    expect(r.rms(0.03, 0.2)).toBe(0);
  });
});
