// A chordal part is GENERATED, never authored. The shapes are the rhythms that
// already have names in harmony.ts; the notes come from the diatonic triad, so
// they are in the session's scale by construction — in every scale, which is
// what a stack of fixed semitones could never be.
import { describe, it, expect } from 'vitest';
import { CHORD_SHAPES, isChordShape, renderChordShape } from './harmony-shapes';
import { inScale } from './musicality';
import { TICKS_PER_STEP } from './notes';

const BAR = TICKS_PER_STEP * 16;
const OPTS = { key: 9, scale: 'minor' as const, octaveBase: 48, barTicks: BAR };

describe('the chord shapes a lane is offered', () => {
  it('offers every shape with an id and a label', () => {
    expect(CHORD_SHAPES.length).toBeGreaterThan(0);
    for (const s of CHORD_SHAPES) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });

  it('recognises its own ids and refuses anything else', () => {
    // The guard behind the loop id. An id that parses but does not exist is a
    // loop that shows in the dropdown and plays silence.
    for (const s of CHORD_SHAPES) expect(isChordShape(s.id)).toBe(true);
    expect(isChordShape('nope')).toBe(false);
    expect(isChordShape('toString')).toBe(false);   // not an inherited property
  });
});

describe('rendering one', () => {
  it('renders three notes per hit, all in the scale', () => {
    for (const s of CHORD_SHAPES) {
      const notes = renderChordShape(s.id, OPTS);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.length % 3).toBe(0);
      for (const n of notes) expect(inScale(n.midi, OPTS.key, OPTS.scale)).toBe(true);
    }
  });

  it('stays in the scale in EVERY scale, which is the whole point', () => {
    // A stack of fixed semitones cannot be diatonic in minor and major at once,
    // and the library is keyed by style while the scale is chosen per session.
    // Generated from degrees, it simply is.
    for (const scale of ['minor', 'major', 'pentMinor', 'dorian'] as const) {
      for (const key of [0, 5, 9]) {
        for (const n of renderChordShape('sustained', { ...OPTS, key, scale })) {
          expect(inScale(n.midi, key, scale)).toBe(true);
        }
      }
    }
  });

  it('stays inside ONE bar, because the blend folds by position within a bar', () => {
    for (const s of CHORD_SHAPES) {
      for (const n of renderChordShape(s.id, OPTS)) {
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start + n.duration).toBeLessThanOrEqual(BAR);
      }
    }
  });

  it('sustains the pad shape for the whole bar', () => {
    // The shape that IS a pad. If this stops being one hit of a full bar, the
    // pad role has quietly become something else.
    const notes = renderChordShape('sustained', OPTS);
    expect(notes).toHaveLength(3);
    for (const n of notes) expect(n.duration).toBe(BAR);
  });

  it('renders on the TONIC, so the progression can move it', () => {
    // Library loops are written on one chord and moved per bar by
    // applyProgression. A shape that pre-applied a chord would be moved twice.
    const root = Math.min(...renderChordShape('sustained', OPTS).map((n) => n.midi));
    expect(((root % 12) + 12) % 12).toBe(((OPTS.octaveBase + OPTS.key) % 12 + 12) % 12);
  });

  it('accents the downbeat, the way the comping generator already does', () => {
    const notes = renderChordShape('offbeat', OPTS);
    expect(notes[0].velocity).toBeGreaterThan(notes[notes.length - 1].velocity);
  });
});
