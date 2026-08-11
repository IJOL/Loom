import { describe, it, expect } from 'vitest';
import {
  defaultSelection, retopologise, selectionLoopIds, resolveSelection,
  redrawQuietest, slotWeights,
} from './weave-selection';
import type { PanelWeave } from './weave-selection';
import type { NoteEvent } from '../core/notes';

const note = (start: number, midi: number): NoteEvent => ({ start, duration: 24, midi, velocity: 100 });
const LIB: Record<string, NoteEvent[]> = {
  c1: [note(0, 36)],
  c2: [note(0, 38)],
  c3: [note(0, 40)],
};
const notesOf = (id: string) => LIB[id];

describe('defaultSelection', () => {
  it('has nothing to say about a lane with no loops', () => {
    expect(defaultSelection('ab', [])).toBeNull();
  });

  it('puts the first two loops at the ends of an A→B leg', () => {
    expect(defaultSelection('ab', ['c1', 'c2', 'c3'])).toEqual({ kind: 'ab', a: 'c1', b: 'c2', x: 0 });
  });

  it('a queue is the whole list, from the start', () => {
    expect(defaultSelection('queue', ['c1', 'c2', 'c3']))
      .toEqual({ kind: 'queue', loops: ['c1', 'c2', 'c3'], x: 0 });
  });

  it('fills the cloud by cycling, so two loops still make a square', () => {
    // Four empty corners would be a control that governs nothing; a repeated
    // corner is a square whose edges still cross-fade.
    const sel = defaultSelection('cloud', ['c1', 'c2']);
    expect(sel).toEqual({ kind: 'cloud', corners: ['c1', 'c2', 'c1', 'c2'], x: 0.5, y: 0.5 });
  });

  it('starts the cloud dot in the middle, where every corner has a say', () => {
    const sel = defaultSelection('cloud', ['c1', 'c2', 'c3']) as Extract<PanelWeave, { kind: 'cloud' }>;
    expect(sel.x).toBe(0.5);
    expect(sel.y).toBe(0.5);
  });
});

describe('retopologise', () => {
  it('keeps the loops the user chose when the control changes', () => {
    const ab: PanelWeave = { kind: 'ab', a: 'c2', b: 'c3', x: 0.4 };
    // The whole library is offered, but the two named loops win: switching the
    // control must not silently rewrite which material is playing.
    expect(retopologise(ab, 'queue', ['c1', 'c2', 'c3']))
      .toEqual({ kind: 'queue', loops: ['c2', 'c3'], x: 0 });
  });

  it('is a no-op when the topology already matches', () => {
    const ab: PanelWeave = { kind: 'ab', a: 'c1', b: 'c2', x: 0.7 };
    expect(retopologise(ab, 'ab', ['c3'])).toBe(ab);
  });

  it('builds from the lane when there is no selection yet', () => {
    expect(retopologise(null, 'ab', ['c1', 'c2'])).toEqual({ kind: 'ab', a: 'c1', b: 'c2', x: 0 });
  });
});

describe('slots', () => {
  it('lists each loop once, in order', () => {
    const sel: PanelWeave = { kind: 'cloud', corners: ['c1', 'c2', 'c1', 'c3'], x: 0, y: 0 };
    expect(selectionLoopIds(sel)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('resolveSelection', () => {
  it('hands the topologies real notes', () => {
    const w = resolveSelection({ kind: 'ab', a: 'c1', b: 'c2', x: 0.3 }, notesOf);
    expect(w).toEqual({ kind: 'ab', state: { a: { id: 'c1', notes: LIB.c1 }, b: { id: 'c2', notes: LIB.c2 }, x: 0.3 } });
  });

  it('substitutes a loop whose clip is gone instead of dropping it', () => {
    // Dropping a corner renumbers the rest and moves what the dot means under
    // the user's hand mid-gesture.
    const w = resolveSelection({ kind: 'cloud', corners: ['c1', 'gone', 'c2', 'c3'], x: 0.2, y: 0.8 }, notesOf);
    expect(w?.kind).toBe('cloud');
    const s = (w as Extract<LaneWeaveLike, { kind: 'cloud' }>).state;
    expect(s.corners.map((c) => c.id)).toEqual(['c1', 'c1', 'c2', 'c3']);
    expect(s.x).toBe(0.2);
  });

  it('pads a short cloud rather than blanking the lane', () => {
    const w = resolveSelection({ kind: 'cloud', corners: ['c1', 'c2'], x: 0.5, y: 0.5 }, notesOf);
    const s = (w as Extract<LaneWeaveLike, { kind: 'cloud' }>).state;
    expect(s.corners).toHaveLength(4);
  });

  it('gives up when nothing resolves, so the lane plays untouched', () => {
    expect(resolveSelection({ kind: 'ab', a: 'x', b: 'y', x: 0 }, notesOf)).toBeNull();
  });
});

// Local alias so the cloud assertions can reach into the resolved state without
// importing the whole weave-state surface into a selection test.
type LaneWeaveLike = NonNullable<ReturnType<typeof resolveSelection>>;

// The dice, from the side that decides WHICH loop it takes.
//
// Reported as a cut you could not avoid: pressing Reshuffle replaced both ends
// of every crossfade, so whatever was sounding stopped mid-phrase. The rule is
// that a press may only take a loop nobody is hearing.

const leg = (a: string, b: string, x: number): PanelWeave => ({ kind: 'ab', a, b, x });
const square = (corners: string[], x: number, y: number): PanelWeave =>
  ({ kind: 'cloud', corners, x, y });

const SHELF = ['c1', 'c2', 'c3'];

describe('redrawQuietest — A→B', () => {
  it('takes the FAR end while the near one is being heard', () => {
    // A fifth of the way across the leg: A is four fifths of what you hear, so
    // A is the one that must survive.
    const next = redrawQuietest(leg('a', 'b', 0.2), SHELF);
    expect(next).toEqual({ kind: 'ab', a: 'a', b: 'c1', x: 0.2 });
  });

  it('takes the NEAR end once the journey has crossed over', () => {
    // Past the middle the roles swap, and so must the answer — a rule that only
    // ever redrew B would cut the sound in the second half of every leg.
    const next = redrawQuietest(leg('a', 'b', 0.9), SHELF);
    expect(next).toEqual({ kind: 'ab', a: 'c1', b: 'b', x: 0.9 });
  });

  it('never draws a loop the selection already names', () => {
    // Taking the loud end back would leave the lane crossfading from a loop to
    // itself: the fader moves and nothing happens, which reads as a dice that
    // did nothing at all.
    expect(redrawQuietest(leg('c1', 'c2', 0.2), SHELF)).toEqual({
      kind: 'ab', a: 'c1', b: 'c3', x: 0.2,
    });
  });

  it('returns null when the shelf has nothing else to offer', () => {
    // A lane whose whole shelf is already in play holds what it has. Null so the
    // caller can skip the write rather than storing an identical selection.
    expect(redrawQuietest(leg('c1', 'c2', 0.2), ['c1', 'c2'])).toBeNull();
  });
});

describe('redrawQuietest — cloud', () => {
  it('takes the corner the dot is furthest from', () => {
    // Near the top-left, so the bottom-right contributes least — and the other
    // three, all of them audible, are untouched.
    const next = redrawQuietest(square(['tl', 'tr', 'bl', 'br'], 0.1, 0.1), SHELF);
    expect((next as Extract<PanelWeave, { kind: 'cloud' }>).corners)
      .toEqual(['tl', 'tr', 'bl', 'c1']);
  });

  it('keeps both axes and the path it is walking', () => {
    // A cloud's position is two numbers plus where it is round its lap. Dropping
    // any of them would teleport the dot on every press.
    const sel: PanelWeave = {
      kind: 'cloud', corners: ['tl', 'tr', 'bl', 'br'], x: 0.2, y: 0.8, path: 'cross', t: 0.6,
    };
    expect(redrawQuietest(sel, SHELF))
      .toMatchObject({ x: 0.2, y: 0.8, path: 'cross', t: 0.6 });
  });
});

describe('slotWeights', () => {
  it('answers one weight per SLOT, duplicates included', () => {
    // Not `selectionLoopIds`, which dedupes: a cloud with the same loop on two
    // corners still has four corners, and an index into this list has to address
    // the corner rather than the material.
    expect(slotWeights(square(['same', 'same', 'bl', 'br'], 0.5, 0.5))).toHaveLength(4);
  });
});
