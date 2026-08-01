// What an LFO count means once the lane's bar stopped being 16 steps.
//
// A clip automation lane is sized by the session meter: clip-automation-lanes
// hands fillLfo `stepsPerBar(meter) * AUTOMATION_SUB_RES` as the bar. The old
// fixed rate table did not follow — "1/16" was 16 cycles per bar whatever the
// bar was — so its fast end meant one cycle per step in 4/4 and more than one in
// 3/4, and the lane's strings could not honestly promise a per-step rate.
//
// Counting cycles over the painted REGION removes that skew: "4 cycles here"
// is 4 cycles in any meter. These tests pin that, and pin that the per-BAR
// ceiling still behaves as the meter-sized quantity it always was.
import { describe, it, expect } from 'vitest';
import {
  fillLfo, cyclesToCyclesPerBar, maxCyclesInRegion, LFO_MAX_CYCLES_PER_BAR, type LfoFill,
} from './automation-lfo';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { stepsPerBar, DEFAULT_METER, type TimeSignature } from '../core/meter';

const THREE_FOUR: TimeSignature = { num: 3, den: 4 };
const BASE: LfoFill = { shape: 'sine', cyclesPerBar: 1, depth: 1, center: 0.5, phase: 0 };

/** Exactly what clip-automation-lanes passes as one bar of sub-samples. */
function subResPerBar(m: TimeSignature): number {
  return stepsPerBar(m) * AUTOMATION_SUB_RES;
}

function upwardCrossings(v: number[]): number {
  let n = 0;
  for (let i = 0; i + 1 < v.length; i++) if (v[i] <= 0.5 && v[i + 1] > 0.5) n++;
  return n;
}

/** Cycles actually painted into a region `bars` long, counted as crossings. */
function cyclesInRegion(m: TimeSignature, bars: number, cycles: number): number {
  const perBar = subResPerBar(m);
  const regionSubs = bars * perBar;
  const values = new Array(regionSubs).fill(0.25);
  fillLfo(values, 0, values.length, perBar, {
    ...BASE,
    cyclesPerBar: cyclesToCyclesPerBar(cycles, regionSubs, perBar),
    originSub: 0,
  });
  return upwardCrossings(values);
}

describe('a cycle count is meter-proof', () => {
  it('paints the number of cycles asked for, in 4/4 and in 3/4 alike', () => {
    for (const m of [DEFAULT_METER, THREE_FOUR]) {
      for (const bars of [1, 2]) {
        for (const cycles of [1, 3, 8]) {
          expect(cyclesInRegion(m, bars, cycles)).toBe(cycles);
        }
      }
    }
  });

  it('the same count over the same bars is the same curve in either meter', () => {
    // The two lanes have different sub-sample counts, so compare the SHAPE:
    // sampled at the same fraction of the region, the values must agree.
    const cycles = 3, bars = 2;
    const render = (m: TimeSignature) => {
      const perBar = subResPerBar(m);
      const values = new Array(bars * perBar).fill(0.25);
      fillLfo(values, 0, values.length, perBar, {
        ...BASE, cyclesPerBar: cyclesToCyclesPerBar(cycles, values.length, perBar), originSub: 0,
      });
      return values;
    };
    const four = render(DEFAULT_METER), three = render(THREE_FOUR);
    const span = Math.max(...four) - Math.min(...four);
    // The two lanes hold a different number of sub-samples (256 vs 192 per bar),
    // so the same fraction rounds to slightly different points on the wave. The
    // tolerance is therefore one sub-sample's worth of travel, not a fixed
    // number of decimals: at 3 cycles over 2 bars the steepest sample-to-sample
    // move is about 2.5% of the span, so 5% is one sample of slack.
    for (let k = 0; k < 40; k++) {
      const f = k / 40;
      const d = three[Math.floor(f * three.length)] - four[Math.floor(f * four.length)];
      expect(Math.abs(d)).toBeLessThan(span * 0.05);
    }
  });
});

describe('the ceiling is still counted per BAR, not per step', () => {
  it('offers the same 16 cycles a bar in either meter', () => {
    // Remaining debt, unchanged by the move to region counts: the cap is the
    // constant LFO_MAX_CYCLES_PER_BAR, which was chosen as "one cycle per 1/16
    // step" ASSUMING a 16-step bar. A 12-step 3/4 bar gets the same 16, i.e.
    // more than one cycle per step. Lowering it to stepsPerBar would change the
    // ceiling in 3/4, which is an owner's call — pinned here so the next reader
    // finds the limitation instead of rediscovering it.
    const four = maxCyclesInRegion(subResPerBar(DEFAULT_METER), subResPerBar(DEFAULT_METER));
    const three = maxCyclesInRegion(subResPerBar(THREE_FOUR), subResPerBar(THREE_FOUR));
    expect(four).toBe(LFO_MAX_CYCLES_PER_BAR);
    expect(three).toBe(LFO_MAX_CYCLES_PER_BAR);
    expect(four / stepsPerBar(DEFAULT_METER)).toBeCloseTo(1, 9);   // exactly one per step
    expect(three / stepsPerBar(THREE_FOUR)).toBeGreaterThan(1);    // more than one per step
  });

  it('but it does scale with how many bars the region covers', () => {
    const perBar = subResPerBar(THREE_FOUR);
    expect(maxCyclesInRegion(3 * perBar, perBar)).toBe(3 * LFO_MAX_CYCLES_PER_BAR);
  });
});
