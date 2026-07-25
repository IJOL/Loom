// A 'stepped' automation lane keeps ONE value per 1/16 step: snapLaneToSteps()
// holds sub-sample 0 of each step across the step and throws the rest away.
// These tests pin the fillLfo → snapLaneToSteps seam, which used to break the
// feature outright: sampling sub-sample 0 means the two fastest rates land on
// the same cycle phase on every step, so 1/16 sine painted a constant 0.5, 1/16
// square a constant 1, 1/16 sawUp a constant 0, and 1/8 sine/triangle a constant
// 0.5 — a dead flat line, indistinguishable from a broken button.
import { describe, it, expect } from 'vitest';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { snapLaneToSteps } from './automation-painter';
import {
  fillLfo, lfoValueAt, lfoRatesFor, maxCyclesPerBar,
  LFO_RATES, LFO_SHAPES, LFO_MAX_CYCLES_PER_BAR,
  type LfoFill,
} from './automation-lfo';

const STEPS_PER_BAR = 16;
const SUB_PER_BAR = STEPS_PER_BAR * AUTOMATION_SUB_RES;
const SENTINEL = 0.25;

const BASE: LfoFill = { shape: 'sine', cyclesPerBar: 1, depth: 1, center: 0.5, phase: 0, seed: 5 };

const span = (v: number[]) => Math.max(...v) - Math.min(...v);
const distinct = (v: number[]) => new Set(v).size;

function makeBars(bars: number): number[] {
  return new Array(bars * SUB_PER_BAR).fill(SENTINEL);
}

/** The real user path: a stepped-lane fill, then the lane's own snap. */
function paintStepped(bars: number, cfg: Partial<LfoFill> = {}): number[] {
  const values = makeBars(bars);
  fillLfo(values, 0, values.length, SUB_PER_BAR, { ...BASE, stepSubRes: AUTOMATION_SUB_RES, ...cfg });
  snapLaneToSteps({ values, lengthBars: bars });
  return values;
}

/** The same config on a continuous lane, for relative comparisons. */
function paintContinuous(bars: number, cfg: Partial<LfoFill> = {}): number[] {
  const values = makeBars(bars);
  fillLfo(values, 0, values.length, SUB_PER_BAR, { ...BASE, ...cfg });
  return values;
}

/** One value per step — what the lane actually plays once snapped. */
function perStep(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += AUTOMATION_SUB_RES) out.push(values[i]);
  return out;
}

/** A lane loops, so the wrap from the last step back to the first counts too. */
function upwardCrossings(v: number[], center: number): number {
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    const next = v[(i + 1) % v.length];
    if (v[i] <= center && next > center) n++;
  }
  return n;
}

/** Bars needed for at least two full cycles — below that, flatness is honest
 *  (half a square cycle IS constant, and 'random' holds one value per cycle). */
function barsForTwoCycles(cyclesPerBar: number): number {
  return Math.max(1, Math.ceil(2 / cyclesPerBar));
}

describe('stepped lanes never flatten the curve', () => {
  for (const { id } of LFO_SHAPES) {
    for (const rate of LFO_RATES) {
      it(`${id} @ ${rate.label} still moves after the lane is snapped to steps`, () => {
        const bars = barsForTwoCycles(rate.cyclesPerBar);
        const v = paintStepped(bars, { shape: id, cyclesPerBar: rate.cyclesPerBar });
        expect(distinct(v)).toBeGreaterThan(1);
        // and it moves by a comparable amount to the un-stepped curve, not by a
        // rounding crumb (random is excluded: its span is a roll of the dice)
        if (id !== 'random') {
          const cont = paintContinuous(bars, { shape: id, cyclesPerBar: rate.cyclesPerBar });
          expect(span(v) * 4).toBeGreaterThan(span(cont));
        }
      });
    }
  }

  it('the fastest rates alternate step by step instead of sitting on one phase', () => {
    for (const cyclesPerBar of [8, 16]) {
      for (const shape of ['sine', 'triangle', 'square'] as const) {
        const steps = perStep(paintStepped(1, { shape, cyclesPerBar }));
        expect(distinct(steps)).toBe(2); // two steps per cycle: high, low, high…
        const [lo, hi] = [...new Set(steps)].sort((a, b) => a - b);
        expect(Math.abs((lo + hi) / 2 - BASE.center)).toBeLessThan((hi - lo) * 1e-9);
        // full swing, i.e. the shape's extremes and not a fraction of them
        expect((hi - lo) / BASE.depth).toBeCloseTo(1, 9);
        for (let i = 1; i < steps.length; i++) expect(steps[i]).not.toBe(steps[i - 1]);
      }
    }
  });
});

describe('stepped fills are already quantised', () => {
  it('snapLaneToSteps has nothing left to do (the paint IS the staircase)', () => {
    for (const { id } of LFO_SHAPES) {
      for (const cyclesPerBar of [0.25, 1, 4, 8]) {
        const values = makeBars(2);
        fillLfo(values, 0, values.length, SUB_PER_BAR, {
          ...BASE, shape: id, cyclesPerBar, stepSubRes: AUTOMATION_SUB_RES,
        });
        const painted = values.slice();
        snapLaneToSteps({ values, lengthBars: 2 });
        expect(values).toEqual(painted);
      }
    }
  });

  it('a stepped fill is far coarser than the continuous one, by construction', () => {
    const stepped = paintStepped(1, { cyclesPerBar: 2 });
    const cont = paintContinuous(1, { cyclesPerBar: 2 });
    expect(distinct(cont)).toBeGreaterThan(distinct(stepped) * 4);
    expect(distinct(stepped)).toBeLessThanOrEqual(STEPS_PER_BAR);
  });

  it('leaves the continuous path untouched when stepSubRes is absent', () => {
    const cfg = { shape: 'triangle' as const, cyclesPerBar: 3, depth: 0.7, center: 0.45, phase: 0.2 };
    const a = paintContinuous(2, cfg);
    const b = paintContinuous(2, { ...cfg, stepSubRes: undefined });
    expect(b).toEqual(a);
  });
});

describe('the stepped rate ceiling', () => {
  it('is two steps per cycle — half the continuous ceiling', () => {
    const max = maxCyclesPerBar(SUB_PER_BAR, AUTOMATION_SUB_RES);
    expect(max * 2).toBe(STEPS_PER_BAR); // 2 steps per cycle = the step Nyquist
    expect(max).toBeLessThan(LFO_MAX_CYCLES_PER_BAR);
    expect(maxCyclesPerBar(SUB_PER_BAR)).toBe(LFO_MAX_CYCLES_PER_BAR);
  });

  it('clamps a faster request down to it instead of aliasing to a flat line', () => {
    const max = maxCyclesPerBar(SUB_PER_BAR, AUTOMATION_SUB_RES);
    for (const { id } of LFO_SHAPES) {
      expect(paintStepped(1, { shape: id, cyclesPerBar: max * 2 }))
        .toEqual(paintStepped(1, { shape: id, cyclesPerBar: max }));
    }
  });

  it('lfoRatesFor hands the UI only the rates a stepped lane can express', () => {
    expect(lfoRatesFor(SUB_PER_BAR)).toEqual(LFO_RATES);
    const stepped = lfoRatesFor(SUB_PER_BAR, AUTOMATION_SUB_RES);
    const max = maxCyclesPerBar(SUB_PER_BAR, AUTOMATION_SUB_RES);
    expect(stepped.length).toBeLessThan(LFO_RATES.length);
    expect(stepped.length).toBeGreaterThan(1);
    expect(stepped.every((r) => r.cyclesPerBar <= max)).toBe(true);
    // a prefix of the full list: only the fast end is dropped
    expect(stepped.map((r) => r.id)).toEqual(LFO_RATES.slice(0, stepped.length).map((r) => r.id));
  });
});

describe('stepped fills keep every other guarantee', () => {
  it('paints the requested number of cycles across the staircase', () => {
    const cyclesPerBar = 4, bars = 2;
    const steps = perStep(paintStepped(bars, { cyclesPerBar }));
    expect(upwardCrossings(steps, BASE.center)).toBe(cyclesPerBar * bars);
  });

  it('scales with depth and stays inside 0..1', () => {
    const spans = [0.2, 0.5, 1].map((depth) => span(paintStepped(2, { depth })));
    for (let i = 1; i < spans.length; i++) expect(spans[i]).toBeGreaterThan(spans[i - 1]);
    const wild = paintStepped(2, { center: 0.9, depth: 4 });
    expect(wild.every((x) => x >= 0 && x <= 1)).toBe(true);
  });

  it('writes only inside [from, to) and never resizes', () => {
    const values = makeBars(2);
    const before = values.length;
    const from = 4 * AUTOMATION_SUB_RES, to = 12 * AUTOMATION_SUB_RES;
    fillLfo(values, from, to, SUB_PER_BAR, { ...BASE, cyclesPerBar: 4, stepSubRes: AUTOMATION_SUB_RES });
    expect(values.length).toBe(before);
    for (let i = 0; i < from; i++) expect(values[i]).toBe(SENTINEL);
    for (let i = to; i < values.length; i++) expect(values[i]).toBe(SENTINEL);
    expect(values.slice(from, to).some((x) => x !== SENTINEL)).toBe(true);
  });

  it('keeps random deterministic, step-held and one value per cycle', () => {
    const cfg = { shape: 'random' as const, cyclesPerBar: 4, seed: 11 };
    const v = paintStepped(1, cfg);
    expect(paintStepped(1, cfg)).toEqual(v);
    expect(paintStepped(1, { ...cfg, seed: 12 })).not.toEqual(v);
    const perCycle = STEPS_PER_BAR / cfg.cyclesPerBar;
    const steps = perStep(v);
    for (let c = 0; c < cfg.cyclesPerBar; c++) {
      expect(distinct(steps.slice(c * perCycle, (c + 1) * perCycle))).toBe(1);
    }
    expect(distinct(steps)).toBeGreaterThan(1);
  });

  it('previews what it paints: lfoValueAt matches a stepped fill', () => {
    const cfg: LfoFill = {
      shape: 'sawUp', cyclesPerBar: 4, depth: 0.8, center: 0.5, phase: 0.3,
      stepSubRes: AUTOMATION_SUB_RES,
    };
    const values = makeBars(1);
    fillLfo(values, 0, values.length, SUB_PER_BAR, cfg);
    for (let i = 0; i < values.length; i += 3) {
      expect(lfoValueAt(cfg, i, SUB_PER_BAR)).toBe(values[i]);
    }
  });
});
