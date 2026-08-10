// The measurement everything harmonic is built on: how much of each of the
// twelve notes a piece of music actually leans on.
//
// Asserted RELATIVELY throughout — which bin beats which, by roughly how much.
// The absolute numbers depend on three tuning weights, and a test that pinned
// them would break every time one is nudged while saying nothing about whether
// the answer got better.
import { describe, it, expect } from 'vitest';
import { profileFromNotes, PITCH_CLASSES } from './pitch-profile';
import { TICKS_PER_QUARTER, TICKS_PER_STEP, type NoteEvent } from '../core/notes';

const BAR = TICKS_PER_QUARTER * 4;
const n = (start: number, midi: number, duration = TICKS_PER_STEP, velocity = 90): NoteEvent =>
  ({ start, duration, midi, velocity });

/** Which pitch class won, and by how much over the runner-up. */
function top(p: Float32Array): { pc: number; lead: number } {
  let pc = 0;
  for (let i = 1; i < PITCH_CLASSES; i++) if (p[i] > p[pc]) pc = i;
  const rest = [...p].filter((_, i) => i !== pc).sort((a, b) => b - a);
  return { pc, lead: rest[0] > 0 ? p[pc] / rest[0] : Infinity };
}

describe('profileFromNotes', () => {
  it('has one bin per pitch class and nothing else', () => {
    expect(profileFromNotes([], BAR)).toHaveLength(12);
  });

  it('says nothing at all about silence', () => {
    // Not a flat profile of equal weights: NO evidence is different from equal
    // evidence, and a detector reading this must be able to tell.
    expect([...profileFromNotes([], BAR)].every((v) => v === 0)).toBe(true);
  });

  it('folds octaves together — a note is its pitch class', () => {
    const low = profileFromNotes([n(0, 36)], BAR);      // C2
    const high = profileFromNotes([n(0, 60)], BAR);     // C4
    expect(top(low).pc).toBe(0);
    expect(top(high).pc).toBe(0);
  });

  it('counts a LONG note for more than a short one', () => {
    // Presence, not hit count: a pad holding a note through the bar says more
    // about the harmony than a passing sixteenth.
    const p = profileFromNotes([
      n(0, 60, BAR),                    // C, held all bar
      n(0, 62, TICKS_PER_STEP),         // D, a flick
    ], BAR);
    expect(p[0]).toBeGreaterThan(p[2] * 4);
  });

  it('counts a LOUD note for more than a quiet one', () => {
    const p = profileFromNotes([
      n(0, 60, TICKS_PER_STEP, 120),
      n(0, 62, TICKS_PER_STEP, 30),
    ], BAR);
    expect(p[0]).toBeGreaterThan(p[2]);
  });

  it('counts a LOW note for more than the same note played high', () => {
    // The bass carries the root. Two notes, same length, same velocity, two
    // octaves apart: the low one has to weigh more or a busy lead would out-vote
    // the bass line that is actually naming the chord.
    const p = profileFromNotes([n(0, 36), n(0, 62)], BAR);
    expect(p[0]).toBeGreaterThan(p[2]);
  });

  it('counts a note ON THE BAR LINE for more than one off the beat', () => {
    // Where a note falls says how structural it is. The same note on the
    // downbeat and on the last sixteenth are not the same evidence.
    const p = profileFromNotes([
      n(0, 60),                                  // C, on the bar line
      n(BAR - TICKS_PER_STEP, 62),               // D, on the last sixteenth
    ], BAR);
    expect(p[0]).toBeGreaterThan(p[2]);
  });

  it('counts a note on a BEAT for more than one between beats, but less than the bar line', () => {
    const at = (start: number) => profileFromNotes([n(start, 60)], BAR)[0];
    const barLine = at(0);
    const beat = at(TICKS_PER_QUARTER);
    const between = at(TICKS_PER_QUARTER + TICKS_PER_STEP);
    expect(barLine).toBeGreaterThan(beat);
    expect(beat).toBeGreaterThan(between);
  });

  it('reads a plain triad as those three notes and nothing else', () => {
    // C major: C E G. The three bins are lit and the other nine are dark.
    const p = profileFromNotes([n(0, 60, BAR), n(0, 64, BAR), n(0, 67, BAR)], BAR);
    for (const lit of [0, 4, 7]) expect(p[lit]).toBeGreaterThan(0);
    for (const dark of [1, 2, 3, 5, 6, 8, 9, 10, 11]) expect(p[dark]).toBe(0);
  });

  it('lets a held bass root out-weigh a busy line above it', () => {
    // The case the low-note weighting exists for, stated as music: a bass
    // holding A under a lead running all over the scale. The bass names the
    // harmony and has to win.
    const bass = [n(0, 33, BAR)];                                  // A1, held
    const lead: NoteEvent[] = [];
    for (let i = 0; i < 16; i++) lead.push(n(i * TICKS_PER_STEP, 72 + (i % 5)));
    expect(top(profileFromNotes([...bass, ...lead], BAR)).pc).toBe(9);   // A
  });

  it('spans as many bars as it is given, without needing to know how many', () => {
    // Four bars of C against one bar of D: the profile is over the WHOLE
    // material, and only the position inside each bar matters for emphasis.
    const notes = [0, 1, 2, 3].map((b) => n(b * BAR, 60, BAR));
    notes.push(n(0, 62, BAR));
    expect(top(profileFromNotes(notes, BAR)).pc).toBe(0);
  });

  it('lights the same three bins when the whole chord moves an octave', () => {
    // Which notes are present cannot depend on the octave they are played in.
    //
    // Their exact WEIGHTS can and do: the low-note rule is per note, so moving
    // a chord down spreads its three voices across a steeper part of the curve
    // and the root gains on the fifth. That is the rule doing its job — a chord
    // voiced low really is more about its root — so this asserts the notes, not
    // the numbers.
    const a = [n(0, 60, BAR), n(0, 64, BAR), n(0, 67, BAR)];
    const b = a.map((x) => ({ ...x, midi: x.midi - 12 }));
    const lit = (ns: NoteEvent[]) =>
      [...profileFromNotes(ns, BAR)].map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    expect(lit(a)).toEqual([0, 4, 7]);
    expect(lit(b)).toEqual(lit(a));
  });

  it('and the lower the chord, the more it is about its root', () => {
    // The same three notes, two octaves apart, read as the same chord with
    // different emphasis — which is what a bass register actually does.
    const ratio = (base: number) => {
      const p = profileFromNotes([n(0, base, BAR), n(0, base + 4, BAR), n(0, base + 7, BAR)], BAR);
      return p[base % 12] / p[(base + 7) % 12];
    };
    expect(ratio(36)).toBeGreaterThan(ratio(60));
  });

  it('refuses to divide by a bar of no length', () => {
    // A caller with a broken meter gets an answer, not a NaN that poisons every
    // comparison downstream in silence.
    const p = profileFromNotes([n(0, 60)], 0);
    expect([...p].every(Number.isFinite)).toBe(true);
  });
});
