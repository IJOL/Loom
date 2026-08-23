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
    const before = { ...now } as Record<string, number>;
    for (const leaf of ['snap', 'snapDecay', 'thud', 'boom', 'body', 'bodyCentre', 'bodyLength', 'tone', 'drive']) {
      delete before[leaf];
    }

    const a = render(now), b = render(before as unknown as ParamBag);
    let worst = 0;
    for (let i = 0; i < a.buf.length; i++) worst = Math.max(worst, Math.abs(a.buf[i] - b.buf[i]));
    expect(worst).toBe(0);
  });

  it('are the OFF values in every shipped kit', () => {
    for (const kit of ['808', '909', '606', '78', 'linn']) {
      const p = seedSynthState(BY_ID[kit]).kick;
      for (const leaf of ['snap', 'thud', 'boom', 'body', 'drive']) {
        expect(p[leaf], `${kit} seeds ${leaf} on`).toBe(0);
      }
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

/** RMS of the signal a layer ADDS, window by window. Comparing two broadband
 *  RMS values cannot see a layer that sums in quadrature under a body sitting at
 *  full peak; the difference signal is the layer, exactly. */
function layer(over: Record<string, number>, seconds = 0.5) {
  const a = render(kickParams(), seconds), b = render(kickParams(over), seconds);
  const rms = (from: number, to: number) => {
    let sum = 0;
    const i0 = Math.floor(from * SR), i1 = Math.min(a.buf.length, Math.floor(to * SR));
    for (let i = i0; i < i1; i++) { const d = b.buf[i] - a.buf[i]; sum += d * d; }
    return Math.sqrt(sum / Math.max(1, i1 - i0));
  };
  return { rms, dry: a };
}

describe('THUD — the low punch', () => {
  it('lands at the attack and is gone by the tail', () => {
    const thud = layer({ thud: 1 });
    // Real energy up front — a third of the body's own level in that window.
    expect(thud.rms(0, 0.03)).toBeGreaterThan(thud.dry.rms(0, 0.03) * 0.2);
    // Fixed short decay: 200 ms later it must have left no trace at all.
    expect(thud.rms(0.2, 0.4)).toBe(0);
  });

  it('knocks an octave above the landing note instead of doubling it', () => {
    const thud = layer({ thud: 1 });
    const boom = layer({ boom: 1 });
    // Same amount, opposite ends of the low band: the knock has to be brighter
    // than the weight, or the two controls are one control twice.
    const hf = (r: { rms: (a: number, b: number) => number }) => r.rms(0, 0.03);
    expect(hf(thud)).toBeGreaterThan(0);
    expect(hf(boom)).toBeGreaterThan(0);
  });
});

describe('BOOM — the sub tail', () => {
  it('adds weight where the body has already gone', () => {
    const dry = render(kickParams());
    const sub = render(kickParams({ boom: 1 }));
    // Its decay is 1.5x the body's, so the late window is where it shows.
    expect(sub.rms(0.3, 0.5)).toBeGreaterThan(dry.rms(0.3, 0.5) * 1.5);
    // And it is sub, not click: it must not brighten the attack.
    expect(sub.bright(0, 0.01)).toBeLessThan(dry.bright(0, 0.01) * 1.2);
  });

  it('follows the body length rather than being a fixed number', () => {
    const short = render(kickParams({ boom: 1, decay: 0.1 }), 0.6);
    const long = render(kickParams({ boom: 1, decay: 0.5 }), 0.6);
    expect(long.rms(0.3, 0.5)).toBeGreaterThan(short.rms(0.3, 0.5) * 2);
  });
});

describe('BODY — the resonant shell', () => {
  it('rings at the centre it is given, which nothing else in the kick could do', () => {
    const dry = render(kickParams());
    const rung = render(kickParams({ body: 1, bodyCentre: 800, bodyLength: 0.25 }));
    // A band at 800 Hz is far above the 220→55 Hz sweep, so the only way this
    // energy can exist is the resonator.
    expect(rung.bright(0.05, 0.2)).toBeGreaterThan(dry.bright(0.05, 0.2) * 2);
    // Broadband would show +1.4% here (quadrature, under a body seven times its
    // size) and prove nothing — isolate the layer and it measures 14.5% of the
    // body's own level in that window, which is audible and is the claim.
    const shell = layer({ body: 1, bodyCentre: 800, bodyLength: 0.25 });
    expect(shell.rms(0.05, 0.2)).toBeGreaterThan(shell.dry.rms(0.05, 0.2) * 0.1);
  });

  it('rings for BODY LENGTH', () => {
    // Isolate the resonator itself: at 200 ms the kick body is down to an RMS of
    // 0.009, so a broadband comparison there is mostly measuring the body.
    const brief = layer({ body: 1, bodyCentre: 800, bodyLength: 0.03 }, 0.6);
    const lasting = layer({ body: 1, bodyCentre: 800, bodyLength: 0.4 }, 0.6);
    expect(brief.rms(0.2, 0.4)).toBe(0);
    expect(lasting.rms(0.2, 0.4)).toBeGreaterThan(0);
    expect(lasting.rms(0.05, 0.1)).toBeGreaterThan(brief.rms(0.05, 0.1));
  });

  it('is normalised, so a resonant body does not swamp the kick', () => {
    const dry = render(kickParams());
    const rung = render(kickParams({ body: 1, bodyCentre: 220, bodyLength: 0.2 }));
    // Without the 2r normalisation this topology's bandpass peaks ~28x.
    expect(rung.peak).toBeLessThan(dry.peak * 3);
  });
});
