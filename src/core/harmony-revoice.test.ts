// Voice-leading a part that is already written.
//
// A woven chordal lane draws its shape on the tonic and the progression then
// shifts every note by the degree of its bar: the right chord, in whatever
// position the shift landed on. Left alone the part jumps by as much as eleven
// semitones between bars for no musical reason.
import { describe, it, expect } from 'vitest';
import { diatonicTriad, revoiceChords } from './harmony';
import { inScale } from './musicality';
import { TICKS_PER_STEP, type NoteEvent } from './notes';

const BAR = TICKS_PER_STEP * 16;
const KEY = 9;                 // A
const SCALE = 'minor' as const;
const ANCHOR = diatonicTriad(0, 48, KEY, SCALE);

const chordAt = (start: number, pitches: number[]): NoteEvent[] =>
  pitches.map((midi) => ({ start, duration: BAR, midi, velocity: 100 }));

/** How far a stack sits from the anchor, voice by voice. */
const spread = (ms: number[]) =>
  ms.slice().sort((a, b) => a - b)
    .reduce((s, m, i) => s + Math.abs(m - ANCHOR[i]), 0);

const at = (out: NoteEvent[], start: number) =>
  out.filter((n) => n.start === start).map((n) => n.midi);

describe('revoiceChords', () => {
  it('pulls a chord back towards the anchor', () => {
    const raw = [65, 69, 72];                       // a triad that landed high
    const out = revoiceChords(chordAt(0, raw), ANCHOR);
    expect(spread(at(out, 0))).toBeLessThan(spread(raw));
  });

  it('keeps the same pitch CLASSES — it is the same chord', () => {
    // The one thing voicing must never do is change the harmony.
    const raw = [65, 69, 72];
    const out = revoiceChords(chordAt(0, raw), ANCHOR);
    const classes = (ms: number[]) => [...new Set(ms.map((m) => ((m % 12) + 12) % 12))].sort();
    expect(classes(at(out, 0))).toEqual(classes(raw));
  });

  it('leaves consecutive bars near each other, which is the complaint', () => {
    // Both bars are placed against the same anchor, so they cannot be far apart
    // — that is what anchoring buys over chaining bar to bar.
    const notes = [...chordAt(0, [57, 60, 64]), ...chordAt(BAR, [65, 69, 72])];
    const out = revoiceChords(notes, ANCHOR);
    const jump = at(out, 0).slice().sort((a, b) => a - b)
      .reduce((s, m, i) => s + Math.abs(m - at(out, BAR).slice().sort((x, y) => x - y)[i]), 0);
    const before = [57, 60, 64].reduce((s, m, i) => s + Math.abs(m - [65, 69, 72][i]), 0);
    expect(jump).toBeLessThan(before);
  });

  it('gives the SAME answer whichever bars it is shown', () => {
    // The reason it is anchored and not chained: WEAVE re-derives a lane's
    // notes on every scheduling ask, over a window usually shorter than the
    // progression. A chained voicing would depend on how much of the phrase
    // happened to be in view, so the seam between two asks would jump.
    const together = revoiceChords(
      [...chordAt(0, [57, 60, 64]), ...chordAt(BAR, [65, 69, 72])], ANCHOR,
    );
    const alone = revoiceChords(chordAt(BAR, [65, 69, 72]), ANCHOR);
    expect(at(alone, BAR)).toEqual(at(together, BAR));
  });

  it('voices each stack of a bar separately', () => {
    // A stab shape puts four separate chords in one bar. Voicing all twelve
    // notes as one stack would be meaningless.
    const notes = [...chordAt(0, [65, 69, 72]), ...chordAt(BAR / 2, [67, 71, 74])];
    const out = revoiceChords(notes, ANCHOR);
    expect(at(out, 0)).toHaveLength(3);
    expect(at(out, BAR / 2)).toHaveLength(3);
    expect(spread(at(out, BAR / 2))).toBeLessThan(spread([67, 71, 74]));
  });

  it('leaves a single-note part alone', () => {
    // A bass or a melody is one note at a time and has no voicing to choose.
    const notes = [
      { start: 0, duration: BAR, midi: 45, velocity: 100 },
      { start: BAR, duration: BAR, midi: 53, velocity: 100 },
    ];
    expect(revoiceChords(notes, ANCHOR)).toEqual(notes);
  });

  it('leaves everything alone when there is no anchor', () => {
    // Which is how a lane that does not play chords passes through untouched.
    const notes = chordAt(0, [65, 69, 72]);
    expect(revoiceChords(notes, null)).toEqual(notes);
  });

  it('leaves a stack the anchor cannot describe as written', () => {
    // A four-note chord under a triad anchor: there is no voice-by-voice
    // comparison to make, so it stays as written rather than being voiced
    // against the wrong notes.
    const notes = chordAt(0, [65, 69, 72, 76]);
    expect(revoiceChords(notes, ANCHOR).map((n) => n.midi)).toEqual([65, 69, 72, 76]);
  });

  it('leaves the timing and the velocities untouched', () => {
    const notes = [...chordAt(0, [57, 60, 64]), ...chordAt(BAR, [65, 69, 72])];
    const out = revoiceChords(notes, ANCHOR);
    expect(out.map((n) => n.start)).toEqual(notes.map((n) => n.start));
    expect(out.map((n) => n.duration)).toEqual(notes.map((n) => n.duration));
    expect(out.map((n) => n.velocity)).toEqual(notes.map((n) => n.velocity));
  });

  it('never leaves the scale', () => {
    // Voicing moves notes by whole octaves, so it cannot — but the part is
    // played against everything else and a silent drift out of key would be
    // heard before it was found.
    // Real triads of the key, an octave above the anchor — what the progression
    // actually hands over.
    for (const raw of [0, 1, 2, 3, 4, 5, 6].map((d) => diatonicTriad(d, 60, KEY, SCALE))) {
      for (const n of revoiceChords(chordAt(0, raw), ANCHOR)) {
        expect(inScale(n.midi, KEY, SCALE)).toBe(true);
      }
    }
  });
});
