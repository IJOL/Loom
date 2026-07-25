// The "LFO" button on an automation lane paints a periodic curve instead of
// making the user draw one by hand. These tests pin the maths: shape identity,
// how many cycles a rate really produces, depth/center/phase semantics, the
// musical rate ceiling, and — most important for the live audio path — that the
// fill writes in place inside its window and never resizes the envelope.
import { describe, it, expect } from 'vitest';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import {
  fillLfo, lfoValueAt, clampCyclesPerBar,
  LFO_RATES, LFO_SHAPES, LFO_MIN_CYCLES_PER_BAR, LFO_MAX_CYCLES_PER_BAR,
  type LfoFill,
} from './automation-lfo';

/** 16 steps per bar × sub-steps per step — the lane's own resolution. */
const SUB_PER_BAR = 16 * AUTOMATION_SUB_RES;
const SENTINEL = 0.25;

const DEFAULTS: LfoFill = { shape: 'sine', cyclesPerBar: 1, depth: 1, center: 0.5, phase: 0 };

function makeBars(bars: number): number[] {
  return new Array(bars * SUB_PER_BAR).fill(SENTINEL);
}

/** Paint a whole N-bar envelope and hand it back. */
function paint(bars: number, cfg: Partial<LfoFill> = {}): number[] {
  const values = makeBars(bars);
  fillLfo(values, 0, values.length, SUB_PER_BAR, { ...DEFAULTS, ...cfg });
  return values;
}

const span = (v: number[]) => Math.max(...v) - Math.min(...v);
const deltas = (v: number[]) => v.slice(1).map((x, i) => x - v[i]);
const maxAbs = (v: number[]) => Math.max(...v.map(Math.abs));

/** Cycle count is measured as center crossings on the way up. */
function upwardCrossings(v: number[], center: number): number {
  let n = 0;
  for (let i = 0; i + 1 < v.length; i++) if (v[i] <= center && v[i + 1] > center) n++;
  return n;
}

describe('shapes', () => {
  it('sine is smooth and symmetric around center', () => {
    const v = paint(2, { shape: 'sine' });
    const s = span(v);
    const halfCycle = SUB_PER_BAR / 2; // 1 cycle per bar → half a cycle
    for (let i = 0; i + halfCycle < v.length; i += 7) {
      // samples half a cycle apart straddle center by the same amount
      expect(Math.abs(v[i] + v[i + halfCycle] - 2 * DEFAULTS.center)).toBeLessThan(s * 1e-9);
    }
    // smooth: no single sub-step moves an appreciable slice of the span, unlike
    // a square, which jumps the whole span between two neighbouring samples
    const square = paint(2, { shape: 'square' });
    expect(maxAbs(deltas(v)) * 10).toBeLessThan(maxAbs(deltas(square)));
  });

  it('triangle holds a constant slope and reverses it twice per cycle', () => {
    const cyclesPerBar = 2, bars = 2;
    const v = paint(bars, { shape: 'triangle', cyclesPerBar });
    const mags = deltas(v).map(Math.abs);
    const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
    expect(Math.max(...mags) - Math.min(...mags)).toBeLessThan(mean * 1e-9);

    const d = deltas(v);
    let reversals = 0;
    for (let i = 1; i < d.length; i++) if (Math.sign(d[i]) !== Math.sign(d[i - 1])) reversals++;
    expect(reversals).toBe(2 * cyclesPerBar * bars); // one peak + one trough per cycle
  });

  it('sawUp ramps up and drops back once per cycle', () => {
    const cyclesPerBar = 2, bars = 2;
    const v = paint(bars, { shape: 'sawUp', cyclesPerBar });
    const d = deltas(v);
    const drops = d.filter((x) => x < 0);
    const rises = d.filter((x) => x > 0);
    expect(drops.length).toBe(cyclesPerBar * bars - 1); // wraps strictly inside the window
    expect(rises.length).toBe(d.length - drops.length); // everything else climbs
    // the wrap is a discontinuity, an order of magnitude beyond a ramp step
    expect(maxAbs(drops)).toBeGreaterThan(10 * Math.max(...rises));
  });

  it('sawDown is sawUp mirrored around center', () => {
    const shared = { cyclesPerBar: 3, depth: 0.8, center: 0.5, phase: 0.1 };
    const up = paint(2, { ...shared, shape: 'sawUp' });
    const down = paint(2, { ...shared, shape: 'sawDown' });
    const s = span(up);
    up.forEach((x, i) => {
      expect(Math.abs(x + down[i] - 2 * shared.center)).toBeLessThan(s * 1e-9);
    });
  });

  it('square only takes two values, placed symmetrically around center', () => {
    const center = 0.4, depth = 0.6;
    const v = paint(2, { shape: 'square', cyclesPerBar: 4, center, depth });
    const uniq = [...new Set(v)].sort((a, b) => a - b);
    expect(uniq.length).toBe(2);
    expect(Math.abs((uniq[0] + uniq[1]) / 2 - center)).toBeLessThan(span(v) * 1e-9);
    expect(span(v) / depth).toBeCloseTo(1, 9); // peak-to-peak IS the depth
  });

  it('random holds one value per cycle and repeats for the same seed', () => {
    const cyclesPerBar = 4, seed = 7;
    const v = paint(1, { shape: 'random', cyclesPerBar, seed });
    const perCycle = SUB_PER_BAR / cyclesPerBar;
    const holds: number[] = [];
    for (let c = 0; c < cyclesPerBar; c++) {
      const slice = v.slice(c * perCycle, (c + 1) * perCycle);
      expect(new Set(slice).size).toBe(1); // step-hold, constant inside the cycle
      holds.push(slice[0]);
    }
    expect(new Set(holds).size).toBeGreaterThan(1); // not a flat line
    expect(paint(1, { shape: 'random', cyclesPerBar, seed })).toEqual(v);
    expect(paint(1, { shape: 'random', cyclesPerBar, seed: seed + 1 })).not.toEqual(v);
  });
});

describe('rate → cycle count', () => {
  for (const rate of LFO_RATES) {
    it(`${rate.label} paints ${rate.cyclesPerBar} cycle(s) per bar`, () => {
      const bars = 4;
      const v = paint(bars, { cyclesPerBar: rate.cyclesPerBar });
      expect(upwardCrossings(v, DEFAULTS.center)).toBe(Math.round(rate.cyclesPerBar * bars));
    });
  }

  it('counts extrema too, so the count is not a crossing artefact', () => {
    const cyclesPerBar = 4, bars = 2;
    const v = paint(bars, { shape: 'triangle', cyclesPerBar });
    const d = deltas(v);
    let peaks = 0;
    for (let i = 1; i < d.length; i++) if (d[i - 1] > 0 && d[i] < 0) peaks++;
    expect(peaks).toBe(cyclesPerBar * bars);
  });
});

describe('rate limits', () => {
  it('offers 4 bars … 1/16 and stops at one cycle per 1/16 step', () => {
    expect(LFO_RATES.map((r) => r.cyclesPerBar)).toEqual([0.25, 0.5, 1, 2, 4, 8, 16]);
    const fastest = LFO_RATES[LFO_RATES.length - 1];
    expect(fastest.cyclesPerBar).toBe(LFO_MAX_CYCLES_PER_BAR);
    expect(fastest.cyclesPerBar / 16).toBe(1); // a bar is 16 steps → one cycle per step
    expect(LFO_RATES[0].cyclesPerBar).toBe(LFO_MIN_CYCLES_PER_BAR);
    for (const r of LFO_RATES) {
      expect(r.cyclesPerBar).toBeLessThanOrEqual(LFO_MAX_CYCLES_PER_BAR);
      expect(r.cyclesPerBar).toBeGreaterThanOrEqual(LFO_MIN_CYCLES_PER_BAR);
    }
  });

  it('at the ceiling one cycle still occupies a full step worth of sub-samples', () => {
    expect(SUB_PER_BAR / LFO_MAX_CYCLES_PER_BAR).toBe(AUTOMATION_SUB_RES);
  });

  it('clamps a faster-than-1/16 request instead of aliasing', () => {
    expect(clampCyclesPerBar(LFO_MAX_CYCLES_PER_BAR * 4)).toBe(LFO_MAX_CYCLES_PER_BAR);
    expect(paint(1, { cyclesPerBar: LFO_MAX_CYCLES_PER_BAR * 4 }))
      .toEqual(paint(1, { cyclesPerBar: LFO_MAX_CYCLES_PER_BAR }));
  });

  it('clamps a slower-than-4-bars request up to the floor', () => {
    expect(clampCyclesPerBar(LFO_MIN_CYCLES_PER_BAR / 8)).toBe(LFO_MIN_CYCLES_PER_BAR);
    expect(paint(4, { cyclesPerBar: 0 })).toEqual(paint(4, { cyclesPerBar: LFO_MIN_CYCLES_PER_BAR }));
  });
});

describe('depth and center', () => {
  it('a bigger depth strictly widens the painted span', () => {
    const spans = [0.1, 0.3, 0.6, 1].map((depth) => span(paint(2, { depth })));
    for (let i = 1; i < spans.length; i++) expect(spans[i]).toBeGreaterThan(spans[i - 1]);
    expect(spans[3] / spans[0]).toBeCloseTo(1 / 0.1, 6); // proportional, not just monotonic
  });

  it('depth 1 around center 0.5 spans the whole lane', () => {
    const v = paint(2, { depth: 1, center: 0.5 });
    expect(span(v)).toBeCloseTo(1, 9);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
  });

  it('a zero depth paints a flat line at center', () => {
    const v = paint(1, { depth: 0, center: 0.7 });
    expect(new Set(v).size).toBe(1);
    expect(v[0]).toBeCloseTo(0.7, 9);
  });

  it('clamps to 0..1 when center + depth overshoots', () => {
    const high = paint(2, { center: 0.9, depth: 1 });
    expect(Math.min(...high)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...high)).toBeLessThanOrEqual(1);
    expect(high.filter((x) => x === 1).length).toBeGreaterThan(1); // flattened at the ceiling

    const wild = paint(2, { center: 0.5, depth: 8 });
    expect(wild.every((x) => x >= 0 && x <= 1)).toBe(true);
    expect(Math.min(...wild)).toBe(0);
    expect(Math.max(...wild)).toBe(1);
  });
});

describe('phase', () => {
  it('a whole-cycle shift reproduces the unshifted curve for every shape', () => {
    for (const { id } of LFO_SHAPES) {
      const base = paint(2, { shape: id, cyclesPerBar: 2, seed: 3 });
      expect(paint(2, { shape: id, cyclesPerBar: 2, seed: 3, phase: 1 })).toEqual(base);
      expect(paint(2, { shape: id, cyclesPerBar: 2, seed: 3, phase: -2 })).toEqual(base);
    }
  });

  it('rotates the wave by a fraction of a cycle', () => {
    const quarterCycle = SUB_PER_BAR / 4; // 1 cycle per bar → 0.25 cycle
    const base = paint(3);
    const shifted = paint(3, { phase: 0.25 });
    const s = span(base);
    for (let i = 0; i + quarterCycle < base.length; i += 5) {
      expect(Math.abs(shifted[i] - base[i + quarterCycle])).toBeLessThan(s * 1e-9);
    }
  });
});

describe('writing into a live envelope', () => {
  it('only touches [from, to) and never resizes the array', () => {
    const values = makeBars(2);
    const lengthBefore = values.length;
    const from = 128, to = 384;
    fillLfo(values, from, to, SUB_PER_BAR, DEFAULTS);

    expect(values.length).toBe(lengthBefore);
    for (let i = 0; i < from; i++) expect(values[i]).toBe(SENTINEL);
    for (let i = to; i < values.length; i++) expect(values[i]).toBe(SENTINEL);
    expect(values.slice(from, to).some((x) => x !== SENTINEL)).toBe(true);
  });

  it('is bar-aligned: a windowed fill matches the same slice of a full fill', () => {
    const cfg = { ...DEFAULTS, cyclesPerBar: 2 };
    const full = paint(2, cfg);
    const windowed = makeBars(2);
    fillLfo(windowed, 100, 300, SUB_PER_BAR, cfg);
    for (let i = 100; i < 300; i++) expect(windowed[i]).toBe(full[i]);
  });

  it('survives an out-of-range window without growing or leaving holes', () => {
    const values = makeBars(1);
    fillLfo(values, -50, values.length + 999, SUB_PER_BAR, DEFAULTS);
    expect(values.length).toBe(SUB_PER_BAR);
    expect(values.every((x) => Number.isFinite(x))).toBe(true);
  });

  it('does nothing when the window is empty or inverted', () => {
    const flat = makeBars(1);
    fillLfo(flat, 200, 100, SUB_PER_BAR, DEFAULTS);
    fillLfo(flat, 50, 50, SUB_PER_BAR, DEFAULTS);
    expect(flat.every((x) => x === SENTINEL)).toBe(true);
    expect(flat.length).toBe(SUB_PER_BAR);
  });

  it('keeps the same array reference (the audio path reads this array)', () => {
    const values = makeBars(1);
    const ref = values;
    fillLfo(values, 0, values.length, SUB_PER_BAR, DEFAULTS);
    expect(values).toBe(ref);
    expect(values.length).toBe(SUB_PER_BAR);
  });

  it('never produces a NaN, even from a nonsense config', () => {
    const values = makeBars(1);
    fillLfo(values, 0, values.length, SUB_PER_BAR, {
      shape: 'sine', cyclesPerBar: NaN, depth: NaN, center: NaN, phase: NaN,
    });
    expect(values.every((x) => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(true);
  });
});

describe('lfoValueAt', () => {
  it('agrees with fillLfo sample by sample (so a preview matches the paint)', () => {
    const cfg: LfoFill = { shape: 'triangle', cyclesPerBar: 4, depth: 0.7, center: 0.45, phase: 0.3 };
    const v = paint(1, cfg);
    for (let i = 0; i < v.length; i += 3) {
      expect(lfoValueAt(cfg, i, SUB_PER_BAR)).toBe(v[i]);
    }
  });
});

describe('catalogues', () => {
  it('lists every shape exactly once, with a label for the UI', () => {
    const ids = LFO_SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['sine', 'triangle', 'sawUp', 'sawDown', 'square', 'random']);
    expect(LFO_SHAPES.every((s) => s.label.length > 0)).toBe(true);
  });

  it('has unique rate ids ordered slow → fast', () => {
    const ids = LFO_RATES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < LFO_RATES.length; i++) {
      expect(LFO_RATES[i].cyclesPerBar).toBeGreaterThan(LFO_RATES[i - 1].cyclesPerBar);
    }
  });
});
