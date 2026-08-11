// Editing a progression by hand. Pure on purpose — the panel only decides what
// a cell looks like, so every rule about what an edit MEANS is testable with no
// DOM and no session.
import { describe, it, expect } from 'vitest';
import { setDegree, setLength, insertAfter, removeAt, activeProgression } from './chord-track';
import { progressionById, type Chord } from './progression';

const track: Chord[] = [
  { degree: 0, bars: 2 }, { degree: 5, bars: 1 }, { degree: 3, bars: 1 },
];

describe('editing a chord track', () => {
  it('changes one slot s degree and nothing else', () => {
    expect(setDegree(track, 1, 4)).toEqual([
      { degree: 0, bars: 2 }, { degree: 4, bars: 1 }, { degree: 3, bars: 1 },
    ]);
  });

  it('never mutates what it was given', () => {
    // The weave state is read while the panel repaints; an in-place edit would
    // change what a reader is halfway through.
    const before = JSON.stringify(track);
    setDegree(track, 0, 6);
    setLength(track, 0, 4);
    insertAfter(track, 0);
    removeAt(track, 0);
    expect(JSON.stringify(track)).toBe(before);
  });

  it('keeps a slot at least one bar long', () => {
    // A zero-bar chord is a chord that never sounds, and progressionBars would
    // count it as nothing — a lap that silently skips a slot.
    expect(setLength(track, 1, 0)[1].bars).toBe(1);
    expect(setLength(track, 1, -3)[1].bars).toBe(1);
  });

  it('rounds a dragged length to whole bars', () => {
    expect(setLength(track, 1, 2.6)[1].bars).toBe(3);
  });

  it('inserts a copy after the slot, so a new cell starts somewhere sensible', () => {
    const out = insertAfter(track, 0);
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual({ degree: 0, bars: 2 });
  });

  it('appends when asked to insert after the last slot', () => {
    expect(insertAfter(track, 2)).toHaveLength(4);
  });

  it('removes a slot', () => {
    expect(removeAt(track, 1)).toEqual([{ degree: 0, bars: 2 }, { degree: 3, bars: 1 }]);
  });

  it('refuses to remove the last slot', () => {
    // An empty track means "no progression", and the panel would then show an
    // editor with nothing in it and no way back.
    const one: Chord[] = [{ degree: 0, bars: 1 }];
    expect(removeAt(one, 0)).toEqual(one);
  });

  it('ignores an index that is not there, rather than growing holes', () => {
    for (const op of [
      () => setDegree(track, 9, 1), () => setLength(track, -1, 2),
      () => insertAfter(track, 9), () => removeAt(track, 9),
    ]) expect(op()).toEqual(track);
  });
});

describe('which progression is actually playing', () => {
  it('uses the catalogue entry when nothing is written', () => {
    expect(activeProgression({ progression: 'i-VI' }))
      .toEqual(progressionById('i-VI')!.chords);
  });

  it('lets a WRITTEN track win over the catalogue', () => {
    const chords = [{ degree: 0, bars: 1 }, { degree: 4, bars: 3 }];
    expect(activeProgression({ progression: 'i-VI', chords })).toEqual(chords);
  });

  it('falls back to static for an id the catalogue does not have', () => {
    // A save from a future build must not take the harmony with it.
    expect(activeProgression({ progression: 'no-such-thing' }))
      .toEqual(progressionById('static')!.chords);
  });

  it('ignores an EMPTY written track', () => {
    // Empty means "nothing written", not "silence": the editor cannot reach
    // zero slots by design, and answering with it would stop the harmony.
    expect(activeProgression({ progression: 'i-VI', chords: [] }))
      .toEqual(progressionById('i-VI')!.chords);
  });
});
