import { describe, it, expect } from 'vitest';
import { drumPatternToNotes, melodicPatternToNotes } from './mpump-patterns';
import { TICKS_PER_STEP } from '../core/notes';

describe('drumPatternToNotes', () => {
  it('lands every hit of a step on that step, one NoteEvent per hit', () => {
    // Verbatim head of mpump's techno drum pattern #0: kick+hat, rest, hat.
    const pattern = [
      [{ note: 36, vel: 120 }, { note: 42, vel: 100 }],
      [],
      [{ note: 42, vel: 100 }],
    ];

    expect(drumPatternToNotes(pattern)).toEqual([
      { start: 0,                  duration: TICKS_PER_STEP, midi: 36, velocity: 120 },
      { start: 0,                  duration: TICKS_PER_STEP, midi: 42, velocity: 100 },
      { start: 2 * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi: 42, velocity: 100 },
    ]);
  });

  it('remaps the two notes where mpump follows the 808 layout, not GM', () => {
    // mpump: CP(clap)=50, CB(cowbell)=47 — in GM those are toms, so playing
    // them raw would fire the wrong voice. Loom's GM notes: clap=39, cowbell=56.
    const pattern = [[{ note: 50, vel: 100 }, { note: 47, vel: 90 }]];

    expect(drumPatternToNotes(pattern).map((n) => n.midi)).toEqual([39, 56]);
  });
});

describe('melodicPatternToNotes', () => {
  it('reads each step as a semitone offset from the root, and drops the rests', () => {
    // mpump stores melody as an offset from whatever root the user is playing,
    // with null for a rest and vel as 0..1.
    const pattern = [
      { semi: 0, vel: 1, slide: false },
      null,
      { semi: 12, vel: 0.5, slide: false },
    ];

    expect(melodicPatternToNotes(pattern, 36)).toEqual([
      { start: 0,                  duration: TICKS_PER_STEP, midi: 36, velocity: 127 },
      { start: 2 * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi: 48, velocity: 64 },
    ]);
  });

  it('stretches a sliding step so its gate overlaps the next one — how Loom slides', () => {
    // mpump carries an explicit `slide` flag; Loom has no such field. A slide in
    // Loom IS the overlap: the note must still be sounding when the next fires,
    // so the scheduler skips the amp re-attack and ramps pitch instead.
    const pattern = [
      { semi: 0, vel: 1, slide: true },
      { semi: 5, vel: 1, slide: false },
    ];

    const [sliding, next] = melodicPatternToNotes(pattern, 36);

    expect(sliding.duration).toBeGreaterThan(TICKS_PER_STEP);
    expect(sliding.start + sliding.duration).toBeGreaterThan(next.start);
  });

  it('leaves a non-sliding step short enough to NOT overlap the next one', () => {
    const pattern = [
      { semi: 0, vel: 1, slide: false },
      { semi: 5, vel: 1, slide: false },
    ];

    const [plain, next] = melodicPatternToNotes(pattern, 36);

    expect(plain.start + plain.duration).toBeLessThanOrEqual(next.start);
  });
});
