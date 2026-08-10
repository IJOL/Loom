// What key is this in? Asked of twelve numbers, answered with a root, a scale
// and how sure it is.
//
// The hard case is not "which seven notes" — it is WHICH OF THEM IS HOME. A
// minor, C major and D dorian are the same seven notes; only how much the music
// leans on one of them tells the three apart, which is why every test that
// cares about the scale states a tonic the material actually insists on.
import { describe, it, expect } from 'vitest';
import { detectKey } from './key-detect';
import { profileFromNotes } from './pitch-profile';
import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';

const BAR = TICKS_PER_QUARTER * 4;
const n = (start: number, midi: number, duration = TICKS_PER_QUARTER): NoteEvent =>
  ({ start, duration, midi, velocity: 90 });

/** A bar that leans hard on `root`, plus the rest of `pcs` passing through. */
function leaningOn(root: number, pcs: number[]): NoteEvent[] {
  const out = [n(0, 48 + root, BAR)];                       // the tonic, held
  pcs.forEach((pc, i) => out.push(n((i + 1) * (BAR / (pcs.length + 1)), 60 + pc, TICKS_PER_QUARTER / 2)));
  return out;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

describe('detectKey', () => {
  it('finds the root a piece leans on', () => {
    const p = profileFromNotes(leaningOn(9, MINOR.map((d) => (9 + d) % 12)), BAR);
    expect(detectKey(p).key).toBe(9);                       // A
  });

  it('moves with the music — transpose everything and the answer follows', () => {
    // The one property that cannot be fudged by a lucky template: the detector
    // must have no favourite key.
    for (const shift of [0, 1, 5, 7, 11]) {
      const notes = leaningOn(shift, MINOR.map((d) => (shift + d) % 12));
      expect(detectKey(profileFromNotes(notes, BAR)).key).toBe(shift);
    }
  });

  it('tells minor from major on the same tonic', () => {
    const minor = detectKey(profileFromNotes(leaningOn(0, MINOR), BAR));
    const major = detectKey(profileFromNotes(leaningOn(0, MAJOR), BAR));
    expect(minor.scale).toBe('minor');
    expect(major.scale).toBe('major');
  });

  it('tells A minor from C major, which are the same seven notes', () => {
    // The whole reason a template weights its tonic: the note SET cannot
    // separate these and the emphasis can.
    const aMinor = detectKey(profileFromNotes(leaningOn(9, MINOR.map((d) => (9 + d) % 12)), BAR));
    const cMajor = detectKey(profileFromNotes(leaningOn(0, MAJOR), BAR));
    expect(aMinor.key).toBe(9);
    expect(cMajor.key).toBe(0);
  });

  it('never answers chromatic — it fits everything and says nothing', () => {
    const p = profileFromNotes(
      Array.from({ length: 12 }, (_, i) => n(i * (BAR / 12), 60 + i)), BAR,
    );
    expect(detectKey(p).scale).not.toBe('chromatic');
  });

  it('is not sure about twelve notes weighted equally', () => {
    // Real music leans somewhere. A flat profile leans nowhere, and the honest
    // answer is a low number rather than a confident wrong one.
    //
    // Built by hand rather than from a chromatic run of notes: a run climbs, and
    // the profile's low-note rule would tilt it — which would be measuring the
    // fixture, not the detector.
    const flat = new Float32Array(12).fill(1);
    expect(detectKey(flat).confidence).toBeLessThan(0.2);
  });

  it('is sure of the ROOT of a scale played over its own tonic', () => {
    const p = profileFromNotes(leaningOn(0, MINOR), BAR);
    expect(detectKey(p).confidence).toBeGreaterThan(0.5);
  });

  it('and much less sure of its MODE, which is the honest reading', () => {
    // Measured: a plain minor scale scores its own root under all six modes
    // within 5% of each other. The root is beyond doubt; the mode is nearly a
    // coin toss, and reporting one number for both hid that.
    const r = detectKey(profileFromNotes(leaningOn(0, MINOR), BAR));
    expect(r.modeConfidence).toBeLessThan(r.confidence);
  });

  it('says nothing, confidently, about silence', () => {
    const r = detectKey(new Float32Array(12));
    expect(r.confidence).toBe(0);
    expect(r.alternatives).toEqual([]);
  });

  it('offers ranked alternatives, best first, itself excluded', () => {
    const r = detectKey(profileFromNotes(leaningOn(9, MINOR.map((d) => (9 + d) % 12)), BAR));
    expect(r.alternatives.length).toBeGreaterThan(0);
    for (let i = 1; i < r.alternatives.length; i++) {
      expect(r.alternatives[i - 1].score).toBeGreaterThanOrEqual(r.alternatives[i].score);
    }
    expect(r.alternatives.some((a) => a.key === r.key && a.scale === r.scale)).toBe(false);
  });

  it('reads a bare power chord as a root, without inventing a third', () => {
    // Root and fifth only — the commonest thing in electronic music. It says
    // exactly where home is and says NOTHING about major or minor, and the two
    // numbers have to report that split honestly.
    const r = detectKey(profileFromNotes([n(0, 45, BAR), n(0, 52, BAR)], BAR));   // A + E
    expect(r.key).toBe(9);
    expect(r.confidence).toBeGreaterThan(0.5);       // where home is: certain
    expect(r.modeConfidence).toBeLessThan(0.2);      // major or minor: no idea
  });
});
