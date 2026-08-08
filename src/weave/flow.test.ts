import { describe, it, expect } from 'vitest';
import { flowPositions, flowAt, applyFlow, asDrift } from './flow';

describe('flowPositions — together', () => {
  it('puts every lane at the same place, which is what a section change is', () => {
    expect(flowPositions(0.3, 3, 'together')).toEqual([0.3, 0.3, 0.3]);
  });

  it('wraps rather than clamping, so the journey goes round', () => {
    expect(flowPositions(1.25, 2, 'together')).toEqual([0.25, 0.25]);
  });

  it('has nothing to say about a scene with no lanes', () => {
    expect(flowPositions(0.5, 0, 'together')).toEqual([]);
  });
});

describe('flowPositions — offset', () => {
  it('fans the lanes evenly across the journey', () => {
    const out = flowPositions(0, 4, 'offset');
    expect(out).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('never lets the first and last lane coincide', () => {
    // A full lap between them would make the fan read as 'together'.
    const out = flowPositions(0, 4, 'offset');
    expect(out[3]).toBeLessThan(1);
    expect(new Set(out).size).toBe(4);
  });

  it('carries the whole fan as the flow moves', () => {
    const a = flowPositions(0, 3, 'offset');
    const b = flowPositions(0.1, 3, 'offset');
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo((a[i] + 0.1) % 1);
  });

  it('degenerates to a single position for one lane', () => {
    expect(flowPositions(0.4, 1, 'offset')).toEqual([0.4]);
  });
});

describe('flowPositions — free', () => {
  it('moves each lane BY the flow, keeping where the user put it', () => {
    // The master control still means something on a hand-placed scene. The
    // third lane wraps past the end, which is the one value that cannot come
    // back bit-exact.
    const out = flowPositions(0.1, 3, 'free', [0, 0.5, 0.9]);
    expect(out[0]).toBe(0.1);
    expect(out[1]).toBeCloseTo(0.6, 10);
    expect(out[2]).toBeCloseTo(0, 10);
  });

  it('leaves a scene alone at flow 0', () => {
    expect(flowPositions(0, 2, 'free', [0.2, 0.8])).toEqual([0.2, 0.8]);
  });

  it('treats a lane with no position yet as 0', () => {
    expect(flowPositions(0.25, 2, 'free', [0.5])).toEqual([0.75, 0.25]);
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
    expect(applyFlow(lanes, ids(2), 0.4, 'together')).toBe(true);
    expect(lanes.l0.weave!.x).toBe(0.4);
    expect(lanes.l1.weave!.x).toBe(0.4);
  });

  it('SKIPS a lane with no loops chosen', () => {
    // Giving it a position would silently start weaving a lane the user never
    // set up.
    const lanes = lanesWith(0.2, null);
    applyFlow(lanes, ids(2), 0.7, 'together');
    expect(lanes.l1.weave).toBe(null);
  });

  it('reports nothing moved when the flow did not change', () => {
    // A caller running per tick skips the source rebuild on this.
    const lanes = lanesWith(0.5, 0.5);
    expect(applyFlow(lanes, ids(2), 0.5, 'together')).toBe(false);
  });

  it('counts free drift from the BASE, so repeated calls travel steadily', () => {
    // Counting from the current position instead would compound: each call
    // would add the whole flow again and the journey would accelerate away.
    const lanes = lanesWith(0.1, 0.1);
    const base = new Map([['l0', 0.1], ['l1', 0.1]]);
    applyFlow(lanes, ids(2), 0.2, 'free', base);
    expect(lanes.l0.weave!.x).toBeCloseTo(0.3);
    applyFlow(lanes, ids(2), 0.4, 'free', base);
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
    applyFlow(lanes, ['l0', 'l1'], 0.9, 'together');
    expect(lanes.l0.weave!.x).toBe(0.2);
    expect(lanes.l1.weave!.x).toBeCloseTo(0.9);
  });

  it('still counts a locked lane in the fan', () => {
    // Locking one lane must not re-space the others under it: the lock is a lane
    // sitting out the journey, not a lane leaving the scene.
    const spaced = (locked: boolean) => {
      const lanes: Record<string, { weave?: { x: number } | null; locked?: boolean }> = {
        l0: { weave: { x: 0 }, locked },
        l1: { weave: { x: 0 } },
        l2: { weave: { x: 0 } },
      };
      applyFlow(lanes, ['l0', 'l1', 'l2'], 0, 'offset');
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
    applyFlow(lanes, ids(1), 0.02, 'together', undefined, (id) => wrapped.push(id));
    expect(wrapped).toEqual(['l0']);
  });

  it('does not call a small step backwards a lap', () => {
    // Dragging the master fader back is a rewind, not an arrival.
    const lanes = lanesWith(0.6);
    const wrapped: string[] = [];
    applyFlow(lanes, ids(1), 0.4, 'together', undefined, (id) => wrapped.push(id));
    expect(wrapped).toEqual([]);
  });

  it('leaves the rest of a selection alone — moving is travelling, not re-choosing', () => {
    const lanes: Record<string, { weave?: { x: number; a?: string } | null }> =
      { l0: { weave: { x: 0, a: 'lib:house:bass:2' } } };
    applyFlow(lanes, ['l0'], 0.6, 'together');
    expect(lanes.l0.weave!.a).toBe('lib:house:bass:2');
  });
});
