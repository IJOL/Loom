// Winding the wheel BACK.
//
// A journey that only ever draws forward is a journey you cannot re-hear: land
// on something good, keep going, and it is gone. The trail is what makes the
// way back the way you came.
import { describe, it, expect } from 'vitest';
import { rehookOnRewind, pushTrail, TRAIL_MAX } from './weave-loops';
import { applyFlow, type PositionedWeave } from '../weave/flow';
import type { PanelWeave } from '@loom/plugin-sdk';

const leg = (a: string, b: string, x = 0.5): PanelWeave => ({ kind: 'ab', a, b, x });

describe('the trail', () => {
  it('remembers the loop a lane leaves behind', () => {
    expect(pushTrail(undefined, 'one')).toEqual(['one']);
    expect(pushTrail(['one'], 'two')).toEqual(['one', 'two']);
  });

  it('is capped, because it is saved with the session', () => {
    // A scene left running for an hour would otherwise carry thousands of ids
    // nobody is going to wind back to.
    let t: string[] = [];
    for (let i = 0; i < TRAIL_MAX * 3; i++) t = pushTrail(t, `l${i}`);
    expect(t).toHaveLength(TRAIL_MAX);
    // The NEWEST survive: a rewind reaches them first.
    expect(t[t.length - 1]).toBe(`l${TRAIL_MAX * 3 - 1}`);
  });
});

describe('rehookOnRewind', () => {
  it('puts the lane back on the loop it came from', () => {
    // Advancing from one→two to two→three pushes 'one' and leaves the lane on
    // two→three. Winding back must give one→two again, and the loop the lane
    // is on becomes the FAR end — that is where it was arrived at from.
    const back = rehookOnRewind(leg('two', 'three'), ['one']);
    expect(back!.weave).toMatchObject({ kind: 'ab', a: 'one', b: 'two' });
    expect(back!.trail).toEqual([]);
  });

  it('walks one leg per turn, oldest last', () => {
    const back = rehookOnRewind(leg('three', 'four'), ['one', 'two']);
    expect(back!.weave).toMatchObject({ a: 'two', b: 'three' });
    expect(back!.trail).toEqual(['one']);
  });

  it('never DRAWS on the way back', () => {
    // Going forward draws — that is what makes the journey endless. Going back
    // must not, or winding to and fro would shred the material instead of
    // reviewing it.
    const back = rehookOnRewind(leg('three', 'four'), ['one', 'two']);
    expect(['one', 'two', 'three', 'four']).toContain(back!.weave.kind === 'ab' ? back!.weave.a : '');
  });

  it('holds what it has when there is nothing behind', () => {
    // A lane at the start of its trail must not draw something new: that would
    // be travelling forwards while the hand went back.
    expect(rehookOnRewind(leg('one', 'two'), [])).toBeNull();
    expect(rehookOnRewind(leg('one', 'two'), undefined)).toBeNull();
  });

  it('refuses a leg from a loop to itself', () => {
    // The trail's newest being what the lane is ALREADY on is an inconsistent
    // state, not a normal one — but swapping there would build a crossfade from
    // a loop to itself, a fader that moves and does nothing, so it is refused
    // rather than trusted.
    expect(rehookOnRewind(leg('two', 'three'), ['two'])).toBeNull();
  });

  it('leaves a topology that is not a leg alone', () => {
    const cloud: PanelWeave = { kind: 'cloud', corners: ['a', 'b', 'c', 'd'], x: 0, y: 0 };
    expect(rehookOnRewind(cloud, ['one'])).toBeNull();
  });
});

describe('which way the wheel turned', () => {
  type Lanes = Record<string, { weave?: PositionedWeave | null; locked?: boolean }>;
  const lanes = (x: number): Lanes => ({ l1: { weave: { kind: 'ab', a: 'one', b: 'two', x } } });

  it('reports a REWIND when the position jumps forward past half a lap', () => {
    // The same threshold as an arrival, read the other way: anything short of
    // half a lap is just travelling, in whichever direction.
    const fwd: string[] = [];
    const back: string[] = [];
    applyFlow(lanes(0.05), ['l1'], 0.95, 'together', undefined,
      (id) => fwd.push(id), (id) => back.push(id));
    expect(back).toEqual(['l1']);
    expect(fwd).toEqual([]);
  });

  it('still reports an ARRIVAL the other way round', () => {
    const fwd: string[] = [];
    const back: string[] = [];
    applyFlow(lanes(0.95), ['l1'], 0.05, 'together', undefined,
      (id) => fwd.push(id), (id) => back.push(id));
    expect(fwd).toEqual(['l1']);
    expect(back).toEqual([]);
  });

  it('says nothing at all for ordinary travel', () => {
    const fwd: string[] = [];
    const back: string[] = [];
    applyFlow(lanes(0.4), ['l1'], 0.6, 'together', undefined,
      (id) => fwd.push(id), (id) => back.push(id));
    expect(fwd).toEqual([]);
    expect(back).toEqual([]);
  });
});
