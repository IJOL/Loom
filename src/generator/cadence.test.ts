import { describe, it, expect } from 'vitest';
import { cadenceFires, clampCadence, DEFAULT_CADENCE, type CadenceSpec } from './cadence';
import { metricWeight } from '../weave/metric-weight';

// One bar of 4/4 in ticks, cut into `div` steps.
const BAR = 384;
const at = (head: number, div: number) =>
  ({ head, stepsPerBar: div, ticksPerStep: BAR / div, barTicks: BAR });

/** Which steps of a `bars`-long pattern fire, at this division. */
function firing(spec: Partial<CadenceSpec>, div: number, bars = 1): number[] {
  const c = clampCadence({ ...DEFAULT_CADENCE, ...spec });
  const out: number[] = [];
  for (let h = 0; h < div * bars; h++) if (cadenceFires(c, at(h, div), bars)) out.push(h);
  return out;
}

describe('CADENCE', () => {
  it('is silence at 0 and the whole division at 1', () => {
    // Both ends are musical claims the spec makes, and they fall out of the
    // comparison being strict rather than out of a special case.
    expect(firing({ amount: 0 }, 8)).toEqual([]);
    expect(firing({ amount: 1 }, 8)).toHaveLength(8);
  });

  it('drops the weak positions first and the downbeat last', () => {
    // The whole reason it is a floor on metric weight rather than a pattern:
    // the bar keeps its shape while it thins.
    let previous: number[] = [];
    for (const amount of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const kept = firing({ amount }, 16);
      // Never loses one it already had — the set only ever grows.
      for (const h of previous) expect(kept).toContain(h);
      previous = kept;
    }
    // And the last thing standing before silence is the downbeat.
    const sparse = firing({ amount: 0.05 }, 16);
    expect(sparse).toEqual([0]);
  });

  it('keeps a hit only if it beats every floor, never on average', () => {
    const kept = firing({ amount: 0.35 }, 16);
    const threshold = 1 - 0.35;
    for (const h of kept) expect(metricWeight(h * (BAR / 16), BAR)).toBeGreaterThan(threshold);
  });

  it('plays the same rhythm in every bar with MOD at zero', () => {
    const kept = firing({ amount: 0.5, mod: 0 }, 8, 4);
    const bar = (n: number) => kept.filter((h) => Math.floor(h / 8) === n).map((h) => h % 8);
    expect(bar(1)).toEqual(bar(0));
    expect(bar(3)).toEqual(bar(0));
  });

  it('varies the rhythm bar by bar once MOD is open', () => {
    const kept = firing({ amount: 0.5, mod: 1 }, 8, 4);
    const bar = (n: number) => kept.filter((h) => Math.floor(h / 8) === n).map((h) => h % 8);
    expect([bar(1), bar(2), bar(3)].some((b) => JSON.stringify(b) !== JSON.stringify(bar(0))))
      .toBe(true);
  });

  it('answers the same step the same way however often it is asked', () => {
    // The offline export depends on it, and a modulated cadence is where a
    // remembered counter would most easily creep in.
    const spec = clampCadence({ amount: 0.5, mod: 0.8 });
    expect(cadenceFires(spec, at(37, 16), 4)).toBe(cadenceFires(spec, at(37, 16), 4));
  });
});

describe('PHRASE, as a floor on the same weight', () => {
  it('thins the middle bars and leaves the opening whole', () => {
    // What `harmony/phrase` argues for: the first bar states, the middle ones
    // get out of the way. Four bars, so there IS a middle.
    const kept = firing({ amount: 1, phrase: 1 }, 8, 4);
    const bar = (n: number) => kept.filter((h) => Math.floor(h / 8) === n).length;
    expect(bar(0)).toBe(8);
    expect(bar(1)).toBeLessThan(bar(0));
    expect(bar(2)).toBeLessThan(bar(0));
  });

  it('brings the turnaround back to full', () => {
    // The last bar hands over to the next lap, so it keeps what it plays.
    const kept = firing({ amount: 1, phrase: 1 }, 8, 4);
    const bar = (n: number) => kept.filter((h) => Math.floor(h / 8) === n).length;
    expect(bar(3)).toBe(bar(0));
  });

  it('does nothing at all when the knob is down', () => {
    expect(firing({ amount: 1, phrase: 0 }, 8, 4)).toHaveLength(32);
  });

  it('shapes nothing in a pattern too short to have a middle', () => {
    // Two bars have an opening and a turn and no middle; shaping one would
    // leave it with a single bar of music.
    expect(firing({ amount: 1, phrase: 1 }, 8, 2)).toHaveLength(16);
  });

  it('has NOTHING to say at the meter beat — the tripwire for DIV', () => {
    // Every position on a beat division weighs at least 0.72, and the middle
    // floor is 0.6. This is why DIV came forward from stage 5: without it the
    // PHRASE knob is a control that cannot move anything. Pinned so that a
    // future change to either number is noticed here rather than by ear.
    expect(firing({ amount: 1, phrase: 1 }, 4, 4)).toHaveLength(16);
  });

  it('never empties a bar it was not asked to empty', () => {
    // `harmony/phrase` shipped this failure once: an absolute floor just above
    // an ordinary offbeat took every hit of a shape made entirely of offbeats,
    // and two bars of a phrase fell silent. It cannot happen here while step 0
    // of every bar weighs 1 — pinned, because DIV and OFFSET are exactly what
    // could stop that being true.
    for (const div of [2, 3, 4, 6, 8, 12, 16]) {
      const kept = firing({ amount: 1, phrase: 1 }, div, 4);
      for (let b = 0; b < 4; b++) {
        expect(kept.filter((h) => Math.floor(h / div) === b).length).toBeGreaterThan(0);
      }
    }
  });
});
