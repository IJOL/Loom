import { describe, it, expect } from 'vitest';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { createWeaveGate, createWeaveNotes } from './weave-runtime';
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

describe('weave gate', () => {
  it('lets a shared hit through at every position', () => {
    for (let i = 0; i <= 10; i++) {
      const gate = createWeaveGate(cfg(i / 10), opts);
      expect(gate({ midi: 36 }, 0, tick(0))).toBe(true);
    }
  });

  it('lets an A-only hit through at x=0', () => {
    expect(createWeaveGate(cfg(0), opts)({ midi: 42 }, 0, tick(3))).toBe(true);
  });

  it('refuses that same A-only hit at x=1', () => {
    expect(createWeaveGate(cfg(1), opts)({ midi: 42 }, 0, tick(3))).toBe(false);
  });

  it('refuses a B-only hit at x=0', () => {
    expect(createWeaveGate(cfg(0), opts)({ midi: 42 }, 0, tick(11))).toBe(false);
  });

  it('lets that same B-only hit through at x=1', () => {
    expect(createWeaveGate(cfg(1), opts)({ midi: 42 }, 0, tick(11))).toBe(true);
  });

  it('refuses a note the blend never contained', () => {
    expect(createWeaveGate(cfg(0.5), opts)({ midi: 99 }, 0, tick(0))).toBe(false);
  });

  it('answers on the voice as well as the step', () => {
    // A hit on step 0 exists, but as a kick. Asking for a snare there must not
    // ride on the kick's answer.
    const gate = createWeaveGate(cfg(0), opts);
    expect(gate({ midi: 36 }, 0, tick(0))).toBe(true);
    expect(gate({ midi: 38 }, 0, tick(0))).toBe(false);
  });

  it('folds a tick from a later bar back into the bar', () => {
    // The scheduler counts ticks from the clip start across iterations; the
    // blend only ever describes one bar.
    const gate = createWeaveGate(cfg(0), opts);
    expect(gate({ midi: 36 }, 0, tick(0) + BAR)).toBe(true);
    expect(gate({ midi: 36 }, 0, tick(0) + BAR * 3)).toBe(true);
  });

  it('follows the position as it moves, rather than answering from a stale cache', () => {
    // The cache keys on the weights, so a moving fader must re-fold. Sharing
    // one config object is exactly how the live panel drives this.
    const shared = cfg(0);
    const gate = createWeaveGate(shared, opts);
    expect(gate({ midi: 42 }, 0, tick(3))).toBe(true);
    if (shared.weave.kind === 'ab') shared.weave.state.x = 1;
    expect(gate({ midi: 42 }, 0, tick(3))).toBe(false);
    expect(gate({ midi: 42 }, 0, tick(11))).toBe(true);
  });

  it('is stable when asked the same thing twice', () => {
    const gate = createWeaveGate(cfg(0.5), opts);
    const first = gate({ midi: 42 }, 0, tick(3));
    expect(gate({ midi: 42 }, 0, tick(3))).toBe(first);
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
