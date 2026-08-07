import { describe, it, expect } from 'vitest';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { createWeaveSource, createWeaveNotes } from './weave-runtime';
import type { LaneWeaveConfig } from './weave-state';
import type { BlendOptions } from './blend-clip';

const BAR = TICKS_PER_STEP * 16;
const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });
const tick = (step: number) => step * TICKS_PER_STEP;

const opts: BlendOptions = { barTicks: BAR, melodic: false, key: 9, scale: 'minor', octaveBase: 36 };

// Shared: kick 0, snare 4. A-only: hat 3. B-only: hat 11.
const A = [hit(0, 36), hit(4, 38), hit(3, 42)];
const B = [hit(0, 36), hit(4, 38), hit(11, 42)];

const cfg = (x: number): LaneWeaveConfig => ({
  weave: { kind: 'ab', state: { a: { id: 'a', notes: A }, b: { id: 'b', notes: B }, x } },
  locked: false, harmonyLeader: false,
});

/** The hits a source produces, as `step:midi`, so a set comparison reads. */
const hitsOf = (src: ReturnType<typeof createWeaveSource>) =>
  new Set((src() ?? []).map((n) => `${n.start / TICKS_PER_STEP}:${n.midi}`));

describe('weave source', () => {
  it('keeps a shared hit at every position', () => {
    // The shared skeleton is what holds the bar up while the differences hand
    // over. It must never be the thing that disappears.
    for (let i = 0; i <= 10; i++) {
      expect(hitsOf(createWeaveSource(cfg(i / 10), opts))).toContain('0:36');
    }
  });

  it('plays A at x=0 and B at x=1', () => {
    expect(hitsOf(createWeaveSource(cfg(0), opts))).toContain('3:42');
    expect(hitsOf(createWeaveSource(cfg(0), opts))).not.toContain('11:42');

    expect(hitsOf(createWeaveSource(cfg(1), opts))).toContain('11:42');
    expect(hitsOf(createWeaveSource(cfg(1), opts))).not.toContain('3:42');
  });

  it('produces B\'s hit, rather than merely permitting it', () => {
    // The distinction the first shape of this got wrong. B's hat is not in A at
    // all, so a predicate over A's notes could never have let it sound.
    const out = createWeaveSource(cfg(1), opts)() ?? [];
    expect(out.some((n) => n.start === tick(11) && n.midi === 42)).toBe(true);
  });

  it('describes ONE bar, whatever the clip does with it', () => {
    for (const n of createWeaveSource(cfg(0.5), opts)() ?? []) {
      expect(n.start).toBeLessThan(BAR);
    }
  });

  it('follows the position as it moves, rather than answering from a stale cache', () => {
    // The cache keys on the weights, so a moving fader must re-fold. Sharing one
    // config object is exactly how the live panel drives this.
    const shared = cfg(0);
    const src = createWeaveSource(shared, opts);
    expect(hitsOf(src)).toContain('3:42');
    if (shared.weave.kind === 'ab') shared.weave.state.x = 1;
    expect(hitsOf(src)).toContain('11:42');
    expect(hitsOf(src)).not.toContain('3:42');
  });

  it('is stable when asked twice at the same position', () => {
    const src = createWeaveSource(cfg(0.5), opts);
    expect(src()).toBe(src());
  });

  it('names no layer unless asked to', () => {
    const out = createWeaveSource(cfg(0), opts)() ?? [];
    expect(out.every((n) => n.layerIndex === undefined)).toBe(true);
  });

  it('names the loop each hit came from when asked', () => {
    const out = createWeaveSource(cfg(0), opts, true)() ?? [];
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((n) => n.layerIndex !== undefined)).toBe(true);
  });
});

describe('the harmony leader, inside the runtime', () => {
  const melodicOpts: BlendOptions = { ...opts, melodic: true };
  const still = (notes: NoteEvent[], leader: boolean): LaneWeaveConfig => ({
    weave: { kind: 'ab', state: { a: { id: 'a', notes }, b: { id: 'b', notes }, x: 0 } },
    locked: false, harmonyLeader: leader,
  });
  const note = (midi: number): NoteEvent =>
    ({ start: 0, duration: TICKS_PER_STEP, midi, velocity: 90 });

  it('leaves every lane alone when no lane leads', () => {
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(45)], false), melodic: true },
      { laneId: 'lead', cfg: still([note(46)], false), melodic: true },
    ], melodicOpts);
    expect(out.get('lead')?.[0].midi).toBe(46);
  });

  it('moves a clashing note once a lane leads', () => {
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(45)], true), melodic: true },
      { laneId: 'lead', cfg: still([note(46)], false), melodic: true },
    ], melodicOpts);
    expect(out.get('lead')?.[0].midi).not.toBe(46);
  });

  it('never alters the leader itself', () => {
    // Moving it would make the rule chase its own tail.
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(45), note(46)], true), melodic: true },
      { laneId: 'lead', cfg: still([note(52)], false), melodic: true },
    ], melodicOpts);
    expect(out.get('bass')?.map((n) => n.midi)).toEqual([45, 46]);
  });

  it('takes the leader’s LOWEST note as the root', () => {
    // The same melody over two different bass notes is two different
    // harmonies, and it is the bottom one that says which.
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(57), note(45)], true), melodic: true },
      { laneId: 'lead', cfg: still([note(46)], false), melodic: true },
    ], melodicOpts);
    expect(out.get('lead')?.[0].midi).not.toBe(46);
  });

  it('leaves percussion alone, because a drum note picks a voice', () => {
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(45)], true), melodic: true },
      { laneId: 'drums', cfg: still([note(46)], false), melodic: false },
    ], melodicOpts);
    expect(out.get('drums')?.[0].midi).toBe(46);
  });

  it('does nothing when the leading lane happens to be silent', () => {
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([], true), melodic: true },
      { laneId: 'lead', cfg: still([note(46)], false), melodic: true },
    ], melodicOpts);
    expect(out.get('lead')?.[0].midi).toBe(46);
  });

  it('returns one entry per lane', () => {
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(45)], true), melodic: true },
      { laneId: 'lead', cfg: still([note(52)], false), melodic: true },
    ], melodicOpts);
    expect([...out.keys()].sort()).toEqual(['bass', 'lead']);
  });
});

describe('routing a woven bar to each loop\'s own instrument', () => {
  /** The layer a particular hit was sent to, or undefined if it did not sound. */
  const layerOf = (x: number, step: number, midi: number) =>
    (createWeaveSource(cfg(x), opts, true)() ?? [])
      .find((n) => n.start === tick(step) && n.midi === midi)?.layerIndex;

  it('sends an A-only hit to A\'s instrument', () => {
    expect(layerOf(0, 3, 42)).toBe(0);
  });

  it('sends B\'s own hits to B\'s instrument once they have entered', () => {
    expect(layerOf(1, 11, 42)).toBe(1);
    // And A's hat is gone at the far end, routed or not.
    expect(layerOf(1, 3, 42)).toBeUndefined();
  });

  it('does not produce a hit that belongs to neither side right now', () => {
    expect(layerOf(0, 11, 42)).toBeUndefined();
  });

  it('gives the shared skeleton ONE owner, not both', () => {
    // The kick is in both loops. It must fire once, from one instrument —
    // emitting it from each would double every hit the two patterns agree on,
    // which is the loudest possible bug.
    const kicks = (createWeaveSource(cfg(0.5), opts, true)() ?? [])
      .filter((n) => n.start === tick(0) && n.midi === 36);
    expect(kicks).toHaveLength(1);
    expect([0, 1]).toContain(kicks[0].layerIndex);
  });
});
