// Which loops a lane can weave, and what they sound like once drawn.
//
// This file had no test, and the gap showed as a knob that worked in the middle
// of a crossfade and did nothing at either end. Both halves of that live here:
// weaveLoopContext decides the scale, weaveLoopNotes decides whether a drawn
// loop is pulled into it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { weaveLoopContext, weaveLoopNotes } from './weave-loops';
import { setLibrary } from '../patterns/pattern-library';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { inScale } from '../core/musicality';
import type { SessionLane } from '../session/session';

const STYLE = DEFAULT_MUSICALITY.style;
const LANE = { id: 'l1', engineId: 'subtractive', name: 'l1', clips: [], inserts: [] } as unknown as SessionLane;

// A pattern that deliberately leaves the session's scale: a minor third and a
// minor seventh above the root. In a BRIGHT scale both have to move; in the
// session's own minor they are already at home. One note would prove nothing —
// a single pitch is in every scale, which is exactly what made a first attempt
// at this measurement in the browser useless.
const OFF_SCALE = [
  { semi: 3, vel: 0.8, slide: false },
  { semi: 10, vel: 0.8, slide: false },
  { semi: 0, vel: 0.8, slide: false },
  { semi: 7, vel: 0.8, slide: false },
];

beforeEach(() => {
  setLibrary({ synth: {}, drums: {}, bass: { [STYLE]: [OFF_SCALE] }, catalog: {} } as never);
});
afterEach(() => setLibrary(null as never));

const ID = `lib:${STYLE}:bass:0`;

/** The lane's context at a given Mood, with the session's scale lock OPEN —
 *  which is the default and the configuration the bug was reported in. */
const ctxAt = (darkness: number) => weaveLoopContext(
  LANE,
  { ...DEFAULT_MUSICALITY, lock: false },
  undefined,
  { styleMix: 0, darkness, laneIndex: 0, seed: 1 },
);

describe('Mood reaches a loop the weave DRAWS, not only one it blends', () => {
  it('leaves a pattern exactly as its author wrote it at the neutral', () => {
    // The whole reason the lock defaults to open: in acid the chromatic notes
    // ARE the line, and a macro sitting at its neutral has no opinion.
    const c = ctxAt(0.5);
    const notes = weaveLoopNotes(ID, c)!;
    expect(notes).toHaveLength(OFF_SCALE.length);
    expect(c.darkened).toBe(false);
  });

  it('pulls the pattern into the scale Mood chose, lock open', () => {
    // The reported bug: with the lock open — the default — the colour only
    // landed where the blend interpolates, so at either end of a crossfade the
    // knob did nothing at all.
    const c = ctxAt(0);                       // brightest
    expect(c.darkened).toBe(true);
    for (const n of weaveLoopNotes(ID, c)!) {
      expect(inScale(n.midi, c.key, c.scale)).toBe(true);
    }
  });

  it('actually MOVES notes — a scale change is not a filter', () => {
    const plain = weaveLoopNotes(ID, ctxAt(0.5))!.map((n) => n.midi);
    const bright = weaveLoopNotes(ID, ctxAt(0))!.map((n) => n.midi);
    expect(bright).not.toEqual(plain);
  });

  it('moves them further apart the further the two scales are', () => {
    // Bright and dark are at opposite ends of the ladder, so they cannot agree
    // on the same pattern. If they did, the ladder would be decoration.
    const bright = weaveLoopNotes(ID, ctxAt(0))!.map((n) => n.midi);
    const dark = weaveLoopNotes(ID, ctxAt(1))!.map((n) => n.midi);
    expect(bright).not.toEqual(dark);
  });

  it('keeps the RHYTHM untouched — Mood is a colour, not an edit', () => {
    const plain = weaveLoopNotes(ID, ctxAt(0.5))!;
    const bright = weaveLoopNotes(ID, ctxAt(0))!;
    expect(bright.map((n) => n.start)).toEqual(plain.map((n) => n.start));
    expect(bright.map((n) => n.duration)).toEqual(plain.map((n) => n.duration));
  });
});
