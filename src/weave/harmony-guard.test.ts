import { describe, it, expect } from 'vitest';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { inScale } from '../core/musicality';
import { avoidClash } from './harmony-guard';

const note = (midi: number, step = 0): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 90 });
const KEY = 9;                         // A minor throughout

describe('avoidClash', () => {
  it('changes nothing when there is no leader', () => {
    const ns = [note(45), note(46), note(51)];
    expect(avoidClash(ns, null, KEY, 'minor')).toEqual(ns);
  });

  it('moves a semitone against the root', () => {
    expect(avoidClash([note(46)], 45, KEY, 'minor')[0].midi).not.toBe(46);
  });

  it('moves a tritone against the root', () => {
    expect(avoidClash([note(51)], 45, KEY, 'minor')[0].midi).not.toBe(51);
  });

  it('moves a major seventh against the root', () => {
    expect(avoidClash([note(56)], 45, KEY, 'minor')[0].midi).not.toBe(56);
  });

  it('leaves a fifth alone', () => {
    expect(avoidClash([note(52)], 45, KEY, 'minor')[0].midi).toBe(52);
  });

  it('leaves an octave alone', () => {
    expect(avoidClash([note(57)], 45, KEY, 'minor')[0].midi).toBe(57);
  });

  it('leaves the root itself alone, though its interval is zero', () => {
    expect(avoidClash([note(45)], 45, KEY, 'minor')[0].midi).toBe(45);
  });

  it('judges by interval, not by absolute pitch, across octaves', () => {
    // 58 is a semitone above 45 an octave up: the same clash.
    expect(avoidClash([note(58)], 45, KEY, 'minor')[0].midi).not.toBe(58);
  });

  it('never silences a note', () => {
    const ns = [note(46), note(51), note(45), note(56)];
    expect(avoidClash(ns, 45, KEY, 'minor')).toHaveLength(ns.length);
  });

  it('lands every moved note inside the scale', () => {
    for (let m = 40; m < 70; m++) {
      for (const n of avoidClash([note(m)], 45, KEY, 'minor')) {
        // Only assert on notes it actually moved: the library's own chromatics
        // are deliberate and pass through untouched.
        if (n.midi !== m) expect(inScale(n.midi, KEY, 'minor')).toBe(true);
      }
    }
  });

  it('leaves an out-of-scale note that does not clash exactly where it was', () => {
    // 49 is a fourth above 45 -- outside A minor but harmless against the root,
    // and the library's chromatics are the line, not a mistake.
    expect(avoidClash([note(49)], 45, KEY, 'minor')[0].midi).toBe(49);
  });

  it('keeps the rest of the note untouched when it moves the pitch', () => {
    const original = note(46, 3);
    const moved = avoidClash([original], 45, KEY, 'minor')[0];
    expect(moved.start).toBe(original.start);
    expect(moved.duration).toBe(original.duration);
    expect(moved.velocity).toBe(original.velocity);
  });

  it('handles an empty bar', () => {
    expect(avoidClash([], 45, KEY, 'minor')).toEqual([]);
  });
});
