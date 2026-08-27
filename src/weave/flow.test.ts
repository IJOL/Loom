import { describe, it, expect } from 'vitest';
import {
  flowPositions, alignPositions, flowAt, applyFlow, asDrift, journeyLaps,
} from './flow';

describe('flowPositions', () => {
  it('moves each lane BY the flow, keeping where the user put it', () => {
    // The master control still means something on a hand-placed scene. The
    // third lane wraps past the end, which is the one value that cannot come
    // back bit-exact.
    const out = flowPositions(0.1, [0, 0.5, 0.9]);
    expect(out[0]).toBe(0.1);
    expect(out[1]).toBeCloseTo(0.6, 10);
    expect(out[2]).toBeCloseTo(0, 10);
  });

  it('never changes the DISTANCE between two lanes', () => {
    // The whole complaint in one assertion: whatever the user has arranged, the
    // dial carries it rather than replacing it. Two of the three old modes
    // wrote positions derived from the flow alone and flattened the scene on
    // the next tick.
    const placed = [0.1, 0.35, 0.9];
    for (const f of [0, 0.2, 0.7, 1.4]) {
      const out = flowPositions(f, placed);
      const gap = (a: number, b: number) => ((b - a) % 1 + 1) % 1;
      expect(gap(out[0], out[1])).toBeCloseTo(gap(placed[0], placed[1]), 10);
      expect(gap(out[1], out[2])).toBeCloseTo(gap(placed[1], placed[2]), 10);
    }
  });

  it('leaves a scene alone at flow 0', () => {
    expect(flowPositions(0, [0.2, 0.8])).toEqual([0.2, 0.8]);
  });

  it('wraps rather than clamping, so the journey goes round', () => {
    expect(flowPositions(1.25, [0, 0])).toEqual([0.25, 0.25]);
  });

  it('has nothing to say about a scene with no lanes', () => {
    expect(flowPositions(0.5, [])).toEqual([]);
  });
});

describe('alignPositions — the drift modes, applied once', () => {
  it('puts every lane at the same place, which is what a section change is', () => {
    expect(alignPositions('together', 3, 0.3)).toEqual([0.3, 0.3, 0.3]);
  });

  it('fans the lanes evenly across the journey', () => {
    expect(alignPositions('offset', 4, 0)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('never lets the first and last lane coincide', () => {
    // A full lap between them would make the fan read as 'together'.
    const out = alignPositions('offset', 4, 0)!;
    expect(out[3]).toBeLessThan(1);
    expect(new Set(out).size).toBe(4);
  });

  it('lays the lanes out from where the dial already is, so nothing jumps', () => {
    expect(alignPositions('offset', 2, 0.5)).toEqual([0.5, 0]);
    expect(alignPositions('together', 2, 0.5)).toEqual([0.5, 0.5]);
  });

  it('degenerates to a single position for one lane', () => {
    expect(alignPositions('offset', 1, 0.4)).toEqual([0.4]);
  });

  it('asks for NO layout in free, which is the mode that means leave them be', () => {
    expect(alignPositions('free', 3, 0.4)).toBeNull();
  });

  it('has nothing to say about a scene with no lanes', () => {
    expect(alignPositions('together', 0, 0.5)).toEqual([]);
  });
});

describe('flowAt', () => {
  it('travels one lap over the journey length', () => {
    expect(flowAt(0, 8)).toBe(0);
    expect(flowAt(4, 8)).toBe(0.5);
  });

  it('wraps, so a scene left running keeps going round', () => {
    // Arriving and stopping would be the static end state this panel exists to
    // avoid.
    expect(flowAt(8, 8)).toBe(0);
    expect(flowAt(12, 8)).toBe(0.5);
  });

  it('stands still at speed OFF, which is the default', () => {
    // A panel that started travelling the moment it opened would change a
    // session nobody touched.
    expect(flowAt(100, 0)).toBe(0);
  });

  it('refuses a nonsense speed rather than dividing by it', () => {
    expect(flowAt(4, -1)).toBe(0);
    expect(flowAt(4, NaN)).toBe(0);
    expect(flowAt(NaN, 8)).toBe(0);
  });
});

describe('asDrift', () => {
  it('keeps the three it knows', () => {
    expect(asDrift('offset')).toBe('offset');
    expect(asDrift('free')).toBe('free');
    expect(asDrift('together')).toBe('together');
  });

  it('falls back to the mode that surprises least', () => {
    // The value comes off the panel ABI, so it is a string from another bundle
    // and a typo must not leave the flow in an undefined mode.
    expect(asDrift('sideways')).toBe('together');
    expect(asDrift('')).toBe('together');
  });
});

describe('applyFlow', () => {
  const lanesWith = (...xs: (number | null)[]) => {
    const out: Record<string, { weave?: { x: number } | null }> = {};
    xs.forEach((x, i) => { out[`l${i}`] = { weave: x === null ? null : { x } }; });
    return out;
  };
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);

  it('moves every lane to where the flow puts it', () => {
    const lanes = lanesWith(0, 0);
    expect(applyFlow(lanes, ids(2), 0.4)).toBe(true);
    expect(lanes.l0.weave!.x).toBe(0.4);
    expect(lanes.l1.weave!.x).toBe(0.4);
  });

  it('carries a hand-placed scene instead of flattening it', () => {
    // The reported complaint, at this level: two lanes a quarter of a lap apart
    // are still a quarter of a lap apart after the dial moves. Under the old
    // 'together' both would have landed on the same number.
    const lanes = lanesWith(0.1, 0.35);
    const base = new Map([['l0', 0.1], ['l1', 0.35]]);
    applyFlow(lanes, ids(2), 0.2, base);
    expect(lanes.l0.weave!.x).toBeCloseTo(0.3, 10);
    expect(lanes.l1.weave!.x).toBeCloseTo(0.55, 10);
  });

  it('SKIPS a lane with no loops chosen', () => {
    // Giving it a position would silently start weaving a lane the user never
    // set up.
    const lanes = lanesWith(0.2, null);
    applyFlow(lanes, ids(2), 0.7);
    expect(lanes.l1.weave).toBe(null);
  });

  it('reports nothing moved when the flow did not change', () => {
    // A caller running per tick skips the source rebuild on this.
    const lanes = lanesWith(0.5, 0.5);
    const base = new Map([['l0', 0], ['l1', 0]]);
    expect(applyFlow(lanes, ids(2), 0.5, base)).toBe(false);
  });

  it('counts from the BASE, so repeated calls travel steadily', () => {
    // Counting from the current position instead would compound: each call
    // would add the whole flow again and the journey would accelerate away.
    const lanes = lanesWith(0.1, 0.1);
    const base = new Map([['l0', 0.1], ['l1', 0.1]]);
    applyFlow(lanes, ids(2), 0.2, base);
    expect(lanes.l0.weave!.x).toBeCloseTo(0.3);
    applyFlow(lanes, ids(2), 0.4, base);
    expect(lanes.l0.weave!.x).toBeCloseTo(0.5);
  });

  it('holds a LOCKED lane where it is', () => {
    // The way to keep one part still while the rest of the scene travels. The
    // field existed and nothing read it, so the lock was a promise the panel
    // could not keep.
    const lanes: Record<string, { weave?: { x: number } | null; locked?: boolean }> = {
      l0: { weave: { x: 0.2 }, locked: true },
      l1: { weave: { x: 0.2 } },
    };
    applyFlow(lanes, ['l0', 'l1'], 0.7, new Map([['l0', 0.2], ['l1', 0.2]]));
    expect(lanes.l0.weave!.x).toBe(0.2);
    expect(lanes.l1.weave!.x).toBeCloseTo(0.9);
  });

  it('moves the others exactly the same, locked neighbour or not', () => {
    // Locking one lane must not re-space the others under it: the lock is a lane
    // sitting out the journey, not a lane leaving the scene.
    const spaced = (locked: boolean) => {
      const lanes: Record<string, { weave?: { x: number } | null; locked?: boolean }> = {
        l0: { weave: { x: 0 }, locked },
        l1: { weave: { x: 0.25 } },
        l2: { weave: { x: 0.5 } },
      };
      applyFlow(lanes, ['l0', 'l1', 'l2'], 0.3,
        new Map([['l0', 0], ['l1', 0.25], ['l2', 0.5]]));
      return [lanes.l1.weave!.x, lanes.l2.weave!.x];
    };
    expect(spaced(true)).toEqual(spaced(false));
  });

  it('reports a lane that WRAPPED past the end of its journey', () => {
    // "Arrived" cannot be `x >= 1`: flowAt folds 1 back to 0, so the position
    // never lands on exactly 1 and that test would never fire. A lap shows up as
    // the position dropping from the far end to the near one.
    const lanes = lanesWith(0.97);
    const wrapped: string[] = [];
    applyFlow(lanes, ids(1), 0.05, new Map([['l0', 0.97]]), (id) => wrapped.push(id));
    expect(wrapped).toEqual(['l0']);
  });

  it('does not call a small step backwards a lap', () => {
    // Dragging the master fader back is a rewind, not an arrival.
    const lanes = lanesWith(0.6);
    const wrapped: string[] = [];
    applyFlow(lanes, ids(1), -0.2, new Map([['l0', 0.6]]), (id) => wrapped.push(id));
    expect(lanes.l0.weave!.x).toBeCloseTo(0.4, 10);
    expect(wrapped).toEqual([]);
  });

  it('leaves the rest of a selection alone — moving is travelling, not re-choosing', () => {
    const lanes: Record<string, { weave?: { x: number; a?: string } | null }> =
      { l0: { weave: { x: 0, a: 'lib:house:bass:2' } } };
    applyFlow(lanes, ['l0'], 0.6);
    expect(lanes.l0.weave!.a).toBe('lib:house:bass:2');
  });
});

describe('with wrapping off, the journey has ends', () => {
  it('stops at 1 instead of folding back to 0', () => {
    expect(flowPositions(1, [0, 0], false)).toEqual([1, 1]);
  });

  it('still folds when wrapping is on — that is what a lap is', () => {
    expect(flowPositions(1, [0, 0])).toEqual([0, 0]);
  });

  it('clamps below zero too', () => {
    expect(flowPositions(-0.25, [0], false)).toEqual([0]);
  });

  it('a fan laid out with the ends on stops each lane at its own end', () => {
    // Two lanes half a lap apart: at flow 0.75 the second would be at 1.25.
    const out = alignPositions('offset', 2, 0.75, false)!;
    expect(out[0]).toBeCloseTo(0.75, 6);
    expect(out[1]).toBe(1);
  });

  it('counts from the base and stops there too', () => {
    expect(flowPositions(0.5, [0.8], false)).toEqual([1]);
  });

  it('applyFlow leaves a lane parked at the end without calling onWrap', () => {
    const lanes: Record<string, { weave: { x: number } }> = {
      l1: { weave: { x: 0.99 } },
    };
    const wrapped: string[] = [];
    applyFlow(lanes, ['l1'], 1, new Map([['l1', 0.99]]), (id) => wrapped.push(id), undefined, false);
    expect(lanes.l1.weave.x).toBe(1);
    expect(wrapped).toEqual([]);
  });
});

describe('journeyLaps — how far, and whether it comes back', () => {
  it('is one way when the journey does not turn round', () => {
    expect(journeyLaps({ thereAndBack: false, pingPongLaps: 4 })).toBe(0);
  });

  it('KEEPS the length while it goes one way, ready for the way back', () => {
    // The whole point of the split: saying "one way" must not throw away how
    // long you said the journey was. The number is still in the state; it is
    // simply not in force.
    const flow = { thereAndBack: false, pingPongLaps: 4 };
    expect(journeyLaps(flow)).toBe(0);
    expect(journeyLaps({ ...flow, thereAndBack: true })).toBe(4);
  });

  it('reads an old session the way it was written', () => {
    // Before the split, laps above zero WAS a there-and-back and zero was one
    // way. A save from then must travel exactly as it did.
    expect(journeyLaps({ pingPongLaps: 8 })).toBe(8);
    expect(journeyLaps({ pingPongLaps: 0 })).toBe(0);
    expect(journeyLaps(undefined)).toBe(0);
  });

  it('gives a round trip with no length the shortest one that means anything', () => {
    expect(journeyLaps({ thereAndBack: true })).toBe(2);
    expect(journeyLaps({ thereAndBack: true, pingPongLaps: 0 })).toBe(2);
  });

  it('refuses a nonsense length rather than travelling by it', () => {
    expect(journeyLaps({ thereAndBack: true, pingPongLaps: -3 })).toBe(2);
    expect(journeyLaps({ thereAndBack: true, pingPongLaps: 2.7 })).toBe(2);
  });
});

describe('there and back', () => {
  // The plain journey is a sawtooth and only ever goes forward. This is the
  // triangle: `laps` out, then the same number home — which is what lets EVOLVE
  // draw on the way out and retrace on the way back.
  const walk = (laps: number, speed = 1, step = 0.02) => {
    let prev = flowAt(0, speed, laps);
    let out = 0;
    let home = 0;
    for (let bars = step; bars <= speed * 2 * laps + 1e-9; bars += step) {
      const p = flowAt(bars, speed, laps);
      // The same two readings applyFlow makes: a drop past half a lap is an
      // arrival, a jump past half a lap is a rewind.
      if (p < prev - 0.5) out++;
      else if (p > prev + 0.5) home++;
      prev = p;
    }
    return { out, home };
  };

  it('goes out and comes back the same number of times', () => {
    // The invariant that matters: every loop drawn on the way out is retraced
    // on the way home. Uneven, the trail would drift — running dry at one end
    // or growing without bound at the other.
    for (const laps of [2, 4, 8]) {
      const { out, home } = walk(laps);
      expect(out).toBe(home);
      expect(out).toBeGreaterThan(0);
    }
  });

  it('turns round further out the more laps you ask for', () => {
    expect(walk(8).out).toBeGreaterThan(walk(2).out);
  });

  it('is the plain one-way journey at zero', () => {
    // Off is the default, and off has to mean EXACTLY what it meant before this
    // existed — a session nobody touched must travel the way it always did.
    for (const bars of [0, 0.25, 1.5, 7.75]) {
      expect(flowAt(bars, 4, 0)).toBe(flowAt(bars, 4));
    }
  });

  it('never leaves 0..1, whatever it is asked', () => {
    for (const laps of [0, 1, 2, 5]) {
      for (let bars = 0; bars < 40; bars += 0.37) {
        const p = flowAt(bars, 3, laps);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(1);
      }
    }
  });

  it('comes home to where it set out', () => {
    // A full there-and-back cycle lands on the start, so the journey repeats
    // rather than creeping.
    for (const laps of [2, 4]) {
      expect(flowAt(2 * laps * 4, 4, laps)).toBeCloseTo(flowAt(0, 4, laps));
    }
  });

  it('ignores a count that is not a journey', () => {
    for (const bad of [-3, NaN, Infinity]) {
      expect(flowAt(2.5, 4, bad)).toBe(flowAt(2.5, 4));
    }
  });
});
