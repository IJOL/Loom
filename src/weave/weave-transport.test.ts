// Play must start what WEAVE is weaving.
//
// Reported from a session: the transport's Play started the clock and the panel
// looked broken, because a weaving lane whose carrier clip was never launched
// contributes nothing. Stop already stopped everything, so the asymmetry was
// the surprise rather than either half on its own.
import { describe, it, expect, vi } from 'vitest';
import {
  weavingLaneIds, clipRowForLane, launchWeavingLanes, createWeaveAwareStart,
} from './weave-transport';
import { defaultWeaveState, type WeaveState } from './weave-state';
import type { SessionClip } from '../session/session';

const clip = (name: string): SessionClip => ({ name } as SessionClip);

function stateWith(lanes: Record<string, unknown>): WeaveState {
  return { ...defaultWeaveState(), lanes: lanes as WeaveState['lanes'] };
}

const woven = { weave: { kind: 'ab', x: 0 }, locked: false, harmonyLeader: false };
const idle = { weave: null, locked: false, harmonyLeader: false };

describe('weavingLaneIds', () => {
  it('returns the lanes that have something to weave', () => {
    const s = stateWith({ a: woven, b: woven });
    expect(weavingLaneIds(s, ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('skips a lane whose selection is empty', () => {
    // A lane can hold a selection object with no weave in it — that is what a
    // lane looks like before its loops are chosen, and starting it would launch
    // a carrier clip that has no notes.
    const s = stateWith({ a: woven, b: idle });
    expect(weavingLaneIds(s, ['a', 'b'])).toEqual(['a']);
  });

  it('skips a lane the weave has never heard of', () => {
    const s = stateWith({ a: woven });
    expect(weavingLaneIds(s, ['a', 'ghost'])).toEqual(['a']);
  });

  it('follows the SESSION order, not the order the weave learned them', () => {
    // The map's insertion order is whatever the user clicked first. Launching
    // in session order keeps the result reproducible and matches what the grid
    // does, which is what makes two starts sound the same.
    const s = stateWith({ b: woven, a: woven });
    expect(weavingLaneIds(s, ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('says nothing to start when nothing is weaving', () => {
    expect(weavingLaneIds(defaultWeaveState(), ['a'])).toEqual([]);
  });
});

describe('clipRowForLane', () => {
  it('prefers the launched scene when the lane has a clip there', () => {
    // Following the scene is what keeps a lane started by Play in step with the
    // lanes started from the grid.
    expect(clipRowForLane([clip('0'), clip('1'), clip('2')], 1)).toBe(1);
  });

  it('falls back to the lane s first clip when the scene row is empty', () => {
    expect(clipRowForLane([null, null, clip('2')], 0)).toBe(2);
  });

  it('reports no row rather than throwing when the lane is empty', () => {
    // -1 is a real answer: an empty lane is not a failure, it is a lane with
    // nothing to launch, and the caller skips it.
    expect(clipRowForLane([], 0)).toBe(-1);
    expect(clipRowForLane([null, null], 0)).toBe(-1);
  });

  it('falls back when the scene index is off the end', () => {
    // The active scene can outlive the clips of a lane added later.
    expect(clipRowForLane([clip('0')], 7)).toBe(0);
    expect(clipRowForLane([clip('0')], -1)).toBe(0);
  });
});

describe('launchWeavingLanes', () => {
  const lanes = [
    { id: 'a', clips: [clip('a0'), clip('a1')] },
    { id: 'b', clips: [null, clip('b1')] },
    { id: 'c', clips: [clip('c0')] },
  ];

  it('launches every weaving lane on the active scene s row', () => {
    const launchClipAt = vi.fn();
    launchWeavingLanes(stateWith({ a: woven, b: woven }), {
      lanes, activeSceneIdx: 1, launchClipAt,
    });
    expect(launchClipAt.mock.calls).toEqual([['a', 1], ['b', 1]]);
  });

  it('leaves a lane that is not weaving alone', () => {
    // Play must not turn the panel into a second way of launching the whole
    // grid: only what WEAVE drives is WEAVE's to start.
    const launchClipAt = vi.fn();
    launchWeavingLanes(stateWith({ a: woven }), { lanes, activeSceneIdx: 0, launchClipAt });
    expect(launchClipAt.mock.calls).toEqual([['a', 0]]);
  });

  it('skips a weaving lane with no clip at all', () => {
    const launchClipAt = vi.fn();
    launchWeavingLanes(stateWith({ empty: woven }), {
      lanes: [{ id: 'empty', clips: [] }], activeSceneIdx: 0, launchClipAt,
    });
    expect(launchClipAt).not.toHaveBeenCalled();
  });

  it('does nothing at all when nothing is weaving', () => {
    const launchClipAt = vi.fn();
    launchWeavingLanes(defaultWeaveState(), { lanes, activeSceneIdx: 0, launchClipAt });
    expect(launchClipAt).not.toHaveBeenCalled();
  });
});

describe('Play, when launching a clip is itself a Play', () => {
  // Reported from the app: "lo he parado de arriba y ya no ha arrancado más".
  // `launchClipAt` on a STOPPED transport arranges the lane and then presses
  // Play itself — which is the very wrapper that launches the weaving lanes. One
  // weaving lane is enough to make that unbounded: start → launch → start → …
  // until the stack gives out, and the clock never starts. Play stayed dead for
  // the rest of the session, with the button still looking armed.

  /** A transport whose clip launch presses Play back, the way the real one
   *  does while stopped. */
  function transport() {
    let playing = false;
    const starts: string[] = [];
    let press: () => void = () => {};
    return {
      get starts() { return starts; },
      setPress(p: () => void) { press = p; },
      launchClipAt(id: string) {
        starts.push(`launch:${id}`);
        if (!playing) press();          // exactly what launchClipAt does
      },
      start() { starts.push('clock'); playing = true; },
      get playing() { return playing; },
    };
  }

  it('starts the clock instead of recursing', () => {
    const t = transport();
    const press = createWeaveAwareStart({
      launchWeaving: () => { t.launchClipAt('a'); },
      start: () => t.start(),
    });
    t.setPress(press);
    expect(() => press()).not.toThrow();
    expect(t.playing).toBe(true);
  });

  it('starts the clock exactly ONCE per press', () => {
    const t = transport();
    const press = createWeaveAwareStart({
      launchWeaving: () => { t.launchClipAt('a'); t.launchClipAt('b'); },
      start: () => t.start(),
    });
    t.setPress(press);
    press();
    expect(t.starts.filter((s) => s === 'clock')).toHaveLength(1);
  });

  it('launches EVERY lane before the clock, so they begin together', () => {
    // Not merely damage control. While the clock is stopped every lane takes
    // the idle branch and is queued at the same instant; let a nested press
    // start the clock early and the lanes after it are quantised to the next
    // boundary instead — the first lane would begin a bar before the rest.
    const t = transport();
    const press = createWeaveAwareStart({
      launchWeaving: () => { t.launchClipAt('a'); t.launchClipAt('b'); t.launchClipAt('c'); },
      start: () => t.start(),
    });
    t.setPress(press);
    press();
    expect(t.starts).toEqual(['launch:a', 'launch:b', 'launch:c', 'clock']);
  });

  it('can still be started again after a stop', () => {
    // The guard must not latch: it is released before the clock starts, so a
    // second press behaves like the first.
    const t = transport();
    const press = createWeaveAwareStart({
      launchWeaving: () => { t.launchClipAt('a'); },
      start: () => t.start(),
    });
    t.setPress(press);
    press();
    press();
    expect(t.starts.filter((s) => s === 'clock')).toHaveLength(2);
  });

  it('does not leave Play dead when a lane s launch throws', () => {
    // One bad lane must not lock the transport out for the rest of the session,
    // which is the exact failure this function exists to end.
    const t = transport();
    let boom = true;
    const press = createWeaveAwareStart({
      launchWeaving: () => { if (boom) throw new Error('bad lane'); t.launchClipAt('a'); },
      start: () => t.start(),
    });
    t.setPress(press);
    expect(() => press()).toThrow();
    boom = false;
    press();
    expect(t.playing).toBe(true);
  });
});
