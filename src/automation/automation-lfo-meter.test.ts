// What an LFO RATE means once the lane's bar stopped being 16 steps.
//
// A clip automation lane is sized by the session meter: clip-automation-lanes
// hands fillLfo `stepsPerBar(meter) * AUTOMATION_SUB_RES` as the bar. The rate
// table did not follow — "1/16" is still 16 cycles per bar whatever the bar is —
// so the fast end of the menu means one thing in 4/4 and another in 3/4. That is
// deliberate (changing it changes what every rate label means musically), but it
// is the reason the lane's own strings may not promise "one cycle per step".
import { describe, it, expect } from 'vitest';
import { fillLfo, rateById, LFO_MAX_CYCLES_PER_BAR, type LfoFill } from './automation-lfo';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { stepsPerBar, DEFAULT_METER, type TimeSignature } from '../core/meter';

const THREE_FOUR: TimeSignature = { num: 3, den: 4 };
const BASE: LfoFill = { shape: 'sine', cyclesPerBar: 1, depth: 1, center: 0.5, phase: 0 };

/** Exactly what clip-automation-lanes passes as one bar of sub-samples. */
function subResPerBar(m: TimeSignature): number {
  return stepsPerBar(m) * AUTOMATION_SUB_RES;
}

/** Cycles actually painted, counted as upward crossings of the centre. */
function cyclesInABar(m: TimeSignature, cyclesPerBar: number): number {
  const perBar = subResPerBar(m);
  const values = new Array(perBar).fill(0.25);
  fillLfo(values, 0, values.length, perBar, { ...BASE, cyclesPerBar });
  let n = 0;
  for (let i = 0; i + 1 < values.length; i++) if (values[i] <= 0.5 && values[i + 1] > 0.5) n++;
  return n;
}

/** The claim the rate menu makes about its fastest entry, measured. */
function cyclesPerStepAtFastest(m: TimeSignature): number {
  const fastest = rateById('1/16')!.cyclesPerBar;
  expect(fastest).toBe(LFO_MAX_CYCLES_PER_BAR); // the menu's fast end IS the ceiling
  return cyclesInABar(m, fastest) / stepsPerBar(m);
}

describe('LFO rates against a meter-sized bar', () => {
  it('paints one cycle per step at the fastest rate in 4/4', () => {
    expect(cyclesPerStepAtFastest(DEFAULT_METER)).toBeCloseTo(1, 9);
  });

  it('paints MORE than one cycle per step at the same rate in 3/4', () => {
    // 16 cycles spread over a 12-step bar. The wave is still musically "1/16 of
    // a bar", but a step no longer holds exactly one of them, so the strings in
    // clip-automation-lanes must not tell the user otherwise.
    const three = cyclesPerStepAtFastest(THREE_FOUR);
    expect(three).toBeGreaterThan(1);
    // Precisely the ratio of the two bars: 16 steps against 12.
    expect(three / cyclesPerStepAtFastest(DEFAULT_METER))
      .toBeCloseTo(stepsPerBar(DEFAULT_METER) / stepsPerBar(THREE_FOUR), 9);
  });

  it('still paints the rate it promises per BAR, in either meter', () => {
    // The label is a division of the bar, and that part is honest everywhere —
    // it is only the "per step" reading that depends on the meter.
    for (const m of [DEFAULT_METER, THREE_FOUR]) {
      for (const id of ['1bar', '1/4', '1/16']) {
        const cyclesPerBar = rateById(id)!.cyclesPerBar;
        expect(cyclesInABar(m, cyclesPerBar)).toBe(cyclesPerBar);
      }
    }
  });
});
