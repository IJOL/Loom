// The "LFO" button on an automation lane paints a periodic curve instead of
// making the user draw one by hand. These tests pin the maths: shape identity,
// how many cycles the user asked for, depth/center/phase semantics, where the
// wave starts, the musical rate ceiling, and — most important for the live audio
// path — that the fill writes in place inside its window and never resizes the
// envelope.
import { describe, it, expect } from 'vitest';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import {
  fillLfo, lfoValueAt, clampCyclesPerBar,
  cyclesToCyclesPerBar, maxCyclesInRegion, clampCyclesInRegion,
  LFO_SHAPES, LFO_MIN_CYCLES, LFO_MAX_CYCLES_PER_BAR,
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
  for (const cyclesPerBar of [0.25, 0.5, 1, 2, 4, 8, 16]) {
    it(`${cyclesPerBar} cycle(s) per bar paints that many per bar`, () => {
      const bars = 4;
      const v = paint(bars, { cyclesPerBar });
      expect(upwardCrossings(v, DEFAULTS.center)).toBe(Math.round(cyclesPerBar * bars));
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
  it('at the ceiling one cycle still occupies a full step worth of sub-samples', () => {
    expect(SUB_PER_BAR / LFO_MAX_CYCLES_PER_BAR).toBe(AUTOMATION_SUB_RES);
  });

  it('clamps a faster-than-1/16 request instead of aliasing', () => {
    expect(clampCyclesPerBar(LFO_MAX_CYCLES_PER_BAR * 4)).toBe(LFO_MAX_CYCLES_PER_BAR);
    expect(paint(1, { cyclesPerBar: LFO_MAX_CYCLES_PER_BAR * 4 }))
      .toEqual(paint(1, { cyclesPerBar: LFO_MAX_CYCLES_PER_BAR }));
  });

  it('has no slow floor of its own: how slow is useful is the region\'s call', () => {
    // the old floor existed because the rate MENU stopped at "4 bars"; with the
    // count expressed per region there is nothing left for it to protect
    const slow = 1 / 64;
    expect(clampCyclesPerBar(slow)).toBe(slow);
    expect(span(paint(1, { cyclesPerBar: slow }))).toBeGreaterThan(0);
  });

  it('falls back to one cycle per bar for a nonsense rate', () => {
    for (const bad of [0, -3, NaN, Infinity]) {
      expect(paint(2, { cyclesPerBar: bad })).toEqual(paint(2, { cyclesPerBar: 1 }));
    }
  });
});

describe('originSub — where the wave starts', () => {
  it('defaults to the clip start, exactly as before', () => {
    expect(paint(2, { cyclesPerBar: 2, originSub: 0 })).toEqual(paint(2, { cyclesPerBar: 2 }));
  });

  it('puts phase 0 at the window start, even off the bar grid', () => {
    const from = 100, to = 100 + SUB_PER_BAR; // a bar-long window that starts mid-bar
    const values = makeBars(3);
    fillLfo(values, from, to, SUB_PER_BAR, { ...DEFAULTS, cyclesPerBar: 2, originSub: from });
    // the window reproduces the wave as if the clip had started there
    const full = paint(3, { cyclesPerBar: 2 });
    for (let i = 0; i < to - from; i++) expect(values[from + i]).toBe(full[i]);
  });

  it('shifting the origin by whole cycles changes nothing', () => {
    const cyclesPerBar = 2;
    const cycleSubs = SUB_PER_BAR / cyclesPerBar;
    const base = paint(2, { cyclesPerBar, originSub: 0 });
    expect(paint(2, { cyclesPerBar, originSub: 3 * cycleSubs })).toEqual(base);
  });

  it('an origin is worth the same as the matching phase', () => {
    const cyclesPerBar = 2;
    const quarterCycle = SUB_PER_BAR / cyclesPerBar / 4;
    const byOrigin = paint(2, { cyclesPerBar, originSub: quarterCycle });
    const byPhase = paint(2, { cyclesPerBar, phase: -0.25 });
    const s = span(byOrigin);
    byOrigin.forEach((x, i) => expect(Math.abs(x - byPhase[i])).toBeLessThan(s * 1e-9));
  });
});

describe('cycles counted over the painted region', () => {
  const asCyclesPerBar = (cycles: number, bars: number) =>
    cyclesToCyclesPerBar(cycles, bars * SUB_PER_BAR, SUB_PER_BAR);

  it('N cycles fill the region exactly, whatever the region is worth', () => {
    for (const [bars, cycles] of [[1, 3], [2, 3], [4, 5], [2, 7]] as const) {
      const v = paint(bars, { cyclesPerBar: asCyclesPerBar(cycles, bars) });
      expect(upwardCrossings(v, DEFAULTS.center)).toBe(cycles);
    }
  });

  it('counts the same when the region does not start on a bar', () => {
    const bars = 3, cycles = 4;
    const from = 137, regionSubs = 2 * SUB_PER_BAR;
    const values = makeBars(bars);
    fillLfo(values, from, from + regionSubs, SUB_PER_BAR, {
      ...DEFAULTS,
      cyclesPerBar: cyclesToCyclesPerBar(cycles, regionSubs, SUB_PER_BAR),
      originSub: from,
    });
    expect(upwardCrossings(values.slice(from, from + regionSubs), DEFAULTS.center)).toBe(cycles);
  });

  it('accepts a fraction of a cycle — half a wave is one hump, no trough', () => {
    const d = deltas(paint(1, { cyclesPerBar: asCyclesPerBar(0.5, 1) }));
    let peaks = 0, troughs = 0;
    for (let i = 1; i < d.length; i++) {
      if (d[i - 1] > 0 && d[i] < 0) peaks++;
      if (d[i - 1] < 0 && d[i] > 0) troughs++;
    }
    expect(peaks).toBe(1);
    expect(troughs).toBe(0);
  });

  it('a fractional count wraps the right number of times', () => {
    for (const cycles of [2, 2.5, 3]) {
      const v = paint(2, { shape: 'sawUp', cyclesPerBar: asCyclesPerBar(cycles, 2) });
      const drops = deltas(v).filter((x) => x < 0).length;
      expect(drops).toBe(Math.ceil(cycles) - 1); // the last wrap falls outside the window
    }
  });
});

describe('the ceiling, in cycles the user can type', () => {
  it('scales with the region: four times the bars, four times the cycles', () => {
    const one = maxCyclesInRegion(SUB_PER_BAR, SUB_PER_BAR);
    expect(one).toBe(LFO_MAX_CYCLES_PER_BAR);
    expect(maxCyclesInRegion(4 * SUB_PER_BAR, SUB_PER_BAR)).toBe(one * 4);
  });

  it('a stepped lane may ask for half as many', () => {
    const regionSubs = 2 * SUB_PER_BAR;
    const stepped = maxCyclesInRegion(regionSubs, SUB_PER_BAR, AUTOMATION_SUB_RES);
    expect(stepped * 2).toBe(maxCyclesInRegion(regionSubs, SUB_PER_BAR));
  });

  it('clamping keeps the count inside [floor, region ceiling]', () => {
    const regionSubs = 2 * SUB_PER_BAR;
    const max = maxCyclesInRegion(regionSubs, SUB_PER_BAR);
    expect(clampCyclesInRegion(max * 10, regionSubs, SUB_PER_BAR)).toBe(max);
    expect(clampCyclesInRegion(0, regionSubs, SUB_PER_BAR)).toBe(LFO_MIN_CYCLES);
    expect(clampCyclesInRegion(-4, regionSubs, SUB_PER_BAR)).toBe(LFO_MIN_CYCLES);
    expect(clampCyclesInRegion(NaN, regionSubs, SUB_PER_BAR)).toBe(1);
    expect(clampCyclesInRegion(3.5, regionSubs, SUB_PER_BAR)).toBe(3.5);
  });

  it('a stepped lane clamps a count a continuous one would have allowed', () => {
    const regionSubs = 2 * SUB_PER_BAR;
    const asked = maxCyclesInRegion(regionSubs, SUB_PER_BAR); // fine on a smooth lane
    const stepped = clampCyclesInRegion(asked, regionSubs, SUB_PER_BAR, AUTOMATION_SUB_RES);
    expect(stepped).toBe(maxCyclesInRegion(regionSubs, SUB_PER_BAR, AUTOMATION_SUB_RES));
    expect(stepped).toBeLessThan(asked);
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
});
