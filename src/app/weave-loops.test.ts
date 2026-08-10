// Which loops a lane can weave, and what they sound like once drawn.
//
// This file had no test, and the gap showed as a knob that worked in the middle
// of a crossfade and did nothing at either end. Both halves of that live here:
// weaveLoopContext decides the scale, weaveLoopNotes decides whether a drawn
// loop is pulled into it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { weaveLoopContext, weaveLoopNotes, rehookOnArrival, nearestOffset } from './weave-loops';
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

describe('what a lane hands over TO', () => {
  const note = { start: 0, duration: 24, midi: 40, velocity: 100 };
  const laneWith = (ids: string[]) => ({
    id: 'l1', engineId: 'subtractive', name: 'l1', inserts: [],
    clips: ids.map((id) => ({ id, name: id, notes: [note] })),
  }) as unknown as SessionLane;

  const ctxFor = (lane: SessionLane) => weaveLoopContext(
    lane, { ...DEFAULT_MUSICALITY, lock: false }, undefined,
    { styleMix: 0, darkness: 0.5, laneIndex: 0, seed: 1 },
  );

  it('advances to the NEXT clip, in order', () => {
    const c = ctxFor(laneWith(['c1', 'c2', 'c3']));
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c1', b: 'clip:c2', x: 1 } as never, c, 1, 'l1',
    );
    expect(next).toMatchObject({ a: 'clip:c2', b: 'clip:c3' });
  });

  it('wraps round to the first clip rather than running out', () => {
    const c = ctxFor(laneWith(['c1', 'c2', 'c3']));
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c2', b: 'clip:c3', x: 1 } as never, c, 1, 'l1',
    );
    expect(next).toMatchObject({ a: 'clip:c3', b: 'clip:c1' });
  });

  it('skips an EMPTY clip — the carrier a weaving track is born with', () => {
    const lane = laneWith(['c1', 'c2', 'c3']);
    (lane.clips[1] as { notes: unknown[] }).notes = [];
    const c = ctxFor(lane);
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c3', b: 'clip:c1', x: 1 } as never, c, 1, 'l1',
    );
    expect(next).toMatchObject({ a: 'clip:c1', b: 'clip:c3' });
  });

  it('falls through to the library when the lane has nowhere else to go', () => {
    const c = ctxFor(laneWith(['c1']));
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c1', b: 'clip:c1', x: 1 } as never, c, 1, 'l1',
    );
    expect((next as { b: string }).b.startsWith('lib:')).toBe(true);
  });

  it('a library loop draws ANOTHER one, never the one just left', () => {
    setLibrary({
      synth: {}, drums: {}, bass: { [STYLE]: [OFF_SCALE, OFF_SCALE] }, catalog: {},
    } as never);
    const c = ctxFor(laneWith([]));
    const next = rehookOnArrival(
      { kind: 'ab', a: `lib:${STYLE}:bass:0`, b: `lib:${STYLE}:bass:0`, x: 1 } as never,
      c, 1, 'l1',
    );
    expect(next).toMatchObject({ a: `lib:${STYLE}:bass:0`, b: `lib:${STYLE}:bass:1` });
  });

  it('stays put rather than falling silent when there is nowhere at all', () => {
    // One pattern, no clips: abAdvance holds the pair it has. A loop that
    // repeats is better than a lane that stops.
    const c = ctxFor(laneWith([]));
    const next = rehookOnArrival(
      { kind: 'ab', a: `lib:${STYLE}:bass:0`, b: `lib:${STYLE}:bass:0`, x: 1 } as never,
      c, 1, 'l1',
    );
    expect(next).toMatchObject({ a: `lib:${STYLE}:bass:0`, b: `lib:${STYLE}:bass:0` });
  });
});

// Reported from the panel: a two-bar clip woven against a library loop went
// silent for its whole second half as the fader crossed toward the loop.
// Weaving two CLIPS was fine — both sides had notes in both bars.
//
// Every pattern in the library is ONE bar, and patternNotes has taken clipBars
// since it was written; its own doc names this exact failure. This context
// passed `undefined`, so nothing repeated. The mechanism was there and unused.
describe('a drawn loop fills the clip it is going into', () => {
  const BAR = 16 * 24;   // TICKS_PER_STEP * 16, the library's own bar
  const ctxBars = (clipBars?: number) => weaveLoopContext(
    LANE,
    { ...DEFAULT_MUSICALITY, lock: false },
    undefined,
    { styleMix: 0, darkness: 0.5, laneIndex: 0, seed: 1 },
    clipBars ? { clipBars, barTicks: BAR } : undefined,
  );

  it('repeats the one-bar pattern across a two-bar clip', () => {
    const one = weaveLoopNotes(ID, ctxBars(1))!;
    const two = weaveLoopNotes(ID, ctxBars(2))!;
    expect(two).toHaveLength(one.length * 2);
    expect(two.some((n) => n.start >= BAR)).toBe(true);
  });

  it('repeats it, it does not stretch it', () => {
    // The distinction that matters to the ear: the groove has to arrive at the
    // same speed twice, not once at half speed.
    const one = weaveLoopNotes(ID, ctxBars(1))!;
    const two = weaveLoopNotes(ID, ctxBars(2))!;
    const firstBar = two.filter((n) => n.start < BAR);
    expect(firstBar.map((n) => n.start)).toEqual(one.map((n) => n.start));
    expect(firstBar.map((n) => n.duration)).toEqual(one.map((n) => n.duration));
    // And the copy sits exactly one bar later, same spacing.
    const secondBar = two.filter((n) => n.start >= BAR);
    expect(secondBar.map((n) => n.start - BAR)).toEqual(one.map((n) => n.start));
  });

  it('four bars take four copies', () => {
    const one = weaveLoopNotes(ID, ctxBars(1))!;
    expect(weaveLoopNotes(ID, ctxBars(4))!).toHaveLength(one.length * 4);
  });

  it('no clip length ⇒ one bar, exactly as before', () => {
    expect(weaveLoopNotes(ID, ctxBars())!).toHaveLength(OFF_SCALE.length);
  });

  it('a CLIP loop is never repeated — it is already the length it is', () => {
    // Only DRAWN patterns are one bar by construction. A clip carries its own
    // length, and tiling it would duplicate music the user wrote.
    const lane = {
      ...LANE,
      clips: [{ id: 'c1', notes: [{ start: 0, duration: 24, midi: 40, velocity: 100 }] }],
    } as unknown as SessionLane;
    const c = weaveLoopContext(
      lane, { ...DEFAULT_MUSICALITY, lock: false }, undefined,
      { styleMix: 0, darkness: 0.5, laneIndex: 0, seed: 1 },
      { clipBars: 4, barTicks: BAR },
    );
    expect(weaveLoopNotes('clip:c1', c)).toHaveLength(1);
  });
});

// "nunca pones bajos que suenen a bajos" — reported by ear, and true.
//
// The library's bass patterns live at MIDI 36..48 (C2..C3, a real bass
// register) and the key was added outright, so the whole shelf walked upwards
// as the key rose. In A that is 45..57 — A2..A3 — which is not a bass.
describe('a library loop lands in the right REGISTER, not just the right key', () => {
  it('shifts to the nearest tonic, never more than half an octave', () => {
    for (let key = 0; key < 12; key++) {
      expect(Math.abs(nearestOffset(key))).toBeLessThanOrEqual(6);
    }
  });

  it('goes DOWN for a key in the top half of the octave', () => {
    expect(nearestOffset(9)).toBe(-3);      // A: down a minor third, not up a sixth
    expect(nearestOffset(7)).toBe(-5);      // G
    expect(nearestOffset(11)).toBe(-1);     // B
  });

  it('goes up for a key in the bottom half, exactly as before', () => {
    expect(nearestOffset(0)).toBe(0);
    expect(nearestOffset(2)).toBe(2);
    expect(nearestOffset(5)).toBe(5);
  });

  it('is still the same NOTE — only the octave moves', () => {
    for (let key = 0; key < 12; key++) {
      expect((((nearestOffset(key) % 12) + 12) % 12)).toBe(key);
    }
  });

  it('keeps a bass in the bass in EVERY key', () => {
    // The property that failed: the register the patterns were written for is
    // C2..C3, and no key may push a loop out of an octave around it.
    for (let key = 0; key < 12; key++) {
      const root = 36 + nearestOffset(key);
      expect(root).toBeGreaterThanOrEqual(30);
      expect(root).toBeLessThanOrEqual(41);
    }
  });
});
