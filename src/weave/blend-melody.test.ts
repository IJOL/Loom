import { describe, it, expect } from 'vitest';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { inScale, SCALE_CATALOG } from '../core/musicality';
import { blendMelody } from './blend-melody';

const BAR = TICKS_PER_STEP * 16;
const OCT = 36;                       // C2 — the octave base the tests root on
const KEY = 9;                        // A
const note = (step: number, midi: number, vel = 90): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: vel });
const midis = (ns: NoteEvent[]) => ns.map((n) => n.midi);
const at = (ns: NoteEvent[], step: number) => ns.find((n) => n.start === step * TICKS_PER_STEP);

describe('blendMelody', () => {
  it('is exactly A at x=0', () => {
    const a = [note(0, 45), note(4, 48)];
    const b = [note(0, 52), note(4, 55)];
    expect(midis(blendMelody(a, b, 0, BAR, KEY, 'minor', OCT))).toEqual([45, 48]);
  });

  it('is exactly B at x=1', () => {
    const a = [note(0, 45), note(4, 48)];
    const b = [note(0, 52), note(4, 55)];
    expect(midis(blendMelody(a, b, 1, BAR, KEY, 'minor', OCT))).toEqual([52, 55]);
  });

  it('walks a pitch monotonically from A to B', () => {
    const a = [note(0, 45)];
    const b = [note(0, 57)];
    const seen: number[] = [];
    for (let i = 0; i <= 20; i++) {
      seen.push(blendMelody(a, b, i / 20, BAR, KEY, 'minor', OCT)[0].midi);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(seen[0]).toBe(45);
    expect(seen[seen.length - 1]).toBe(57);
  });

  it('passes THROUGH the scale rather than jumping straight across', () => {
    // The whole reason for interpolating degrees: an octave apart must be
    // walked, not cut. If it only ever showed the two endpoints this would be a
    // switch, not a crossfade.
    const a = [note(0, 45)];
    const b = [note(0, 57)];
    const seen = new Set<number>();
    for (let i = 0; i <= 20; i++) {
      seen.add(blendMelody(a, b, i / 20, BAR, KEY, 'minor', OCT)[0].midi);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('never leaves the scale, in any scale of the catalogue', () => {
    const a = [note(0, 45), note(2, 50), note(7, 44)];
    const b = [note(0, 59), note(2, 43), note(7, 56)];
    for (const { id } of SCALE_CATALOG) {
      for (let i = 0; i <= 20; i++) {
        for (const n of blendMelody(a, b, i / 20, BAR, KEY, id, OCT)) {
          expect(inScale(n.midi, KEY, id)).toBe(true);
        }
      }
    }
  });

  it('walks down as readily as up', () => {
    const a = [note(0, 57)];
    const b = [note(0, 45)];
    const seen: number[] = [];
    for (let i = 0; i <= 20; i++) {
      seen.push(blendMelody(a, b, i / 20, BAR, KEY, 'minor', OCT)[0].midi);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeLessThanOrEqual(seen[i - 1]);
    }
  });

  it('leaves an unpaired note at its own pitch', () => {
    const a = [note(0, 45), note(3, 50)];
    const b = [note(0, 52)];
    // Step 3 exists only in A: while it survives, its pitch must not drift —
    // there is nothing to interpolate it towards.
    const out = blendMelody(a, b, 0.2, BAR, KEY, 'minor', OCT);
    expect(at(out, 3)?.midi).toBe(50);
  });

  it('hands the onsets over the way a rhythm does', () => {
    // A note that exists only in B must not appear at x=0, and one that exists
    // only in A must be gone by x=1.
    const a = [note(0, 45), note(3, 50)];
    const b = [note(0, 52), note(11, 55)];
    expect(at(blendMelody(a, b, 0, BAR, KEY, 'minor', OCT), 11)).toBeUndefined();
    expect(at(blendMelody(a, b, 1, BAR, KEY, 'minor', OCT), 3)).toBeUndefined();
  });

  it('pairs notes by onset even when they share no pitch', () => {
    // Two melodies rarely agree on a pitch. Keying on (start, pitch) the way
    // percussion does would leave every note unpaired and nothing would ever
    // interpolate.
    const a = [note(0, 45)];
    const b = [note(0, 52)];
    const mid = blendMelody(a, b, 0.5, BAR, KEY, 'minor', OCT);
    expect(mid).toHaveLength(1);
    expect(mid[0].midi).toBeGreaterThan(45);
    expect(mid[0].midi).toBeLessThan(52);
  });

  it('crossfades velocity too, so a quiet part does not arrive at full tilt', () => {
    const a = [note(0, 45, 40)];
    const b = [note(0, 45, 120)];
    const mid = blendMelody(a, b, 0.5, BAR, KEY, 'minor', OCT)[0];
    expect(mid.velocity).toBeGreaterThan(40);
    expect(mid.velocity).toBeLessThan(120);
  });

  it('handles an empty pattern on either side', () => {
    const a = [note(0, 45)];
    expect(midis(blendMelody(a, [], 0, BAR, KEY, 'minor', OCT))).toEqual([45]);
    expect(midis(blendMelody([], a, 1, BAR, KEY, 'minor', OCT))).toEqual([45]);
  });
});

describe('whose note a shared onset is', () => {
  // Anything riding on a note survives the blend by riding on the object that
  // comes out — chiefly the layer that sends each loop to its own instrument.
  // A shared onset has to pick a side, and picking the same one every time was
  // the bug: with two loops that agree on every position, every note came out
  // claiming loop A, so a LAYERS lane played the whole bar on A's instrument at
  // every point of the fader and the sound never crossed over at all.
  const tagged = (step: number, midi: number, from: number) =>
    ({ ...note(step, midi), from });
  // Steps 0, 4, 8 and 15: the downbeat, two beats, and the very last sixteenth.
  // Deliberately NOT four quarter notes — those are all metrically strong, and a
  // fixture made of them says nothing about an ORDER of handover. (My first one
  // was, and it read as the fix not working.)
  const STEPS = [0, 4, 8, 15];
  const A = STEPS.map((s) => tagged(s, 45, 0));
  const B = STEPS.map((s) => tagged(s, 47, 1));
  const owners = (x: number) =>
    (blendMelody(A, B, x, BAR, KEY, 'minor', OCT) as { from?: number }[]).map((n) => n.from);

  it('is entirely A at the A end', () => {
    expect(new Set(owners(0))).toEqual(new Set([0]));
  });

  it('is entirely B at the B end', () => {
    expect(new Set(owners(1))).toEqual(new Set([1]));
  });

  it('is SHARED in between — the whole point of routing by origin', () => {
    const mid = owners(0.5);
    expect(mid).toContain(0);
    expect(mid).toContain(1);
  });

  it('hands the weak positions over before the strong ones', () => {
    // The rule the rest of the blend already runs on. The downbeat is the last
    // thing to change instrument, which is what makes the crossover sound like
    // a transition rather than a switch.
    const early = owners(0.3);
    expect(early[0]).toBe(0);                    // the downbeat is still A's
    expect(early[early.length - 1]).toBe(1);     // the weakest has gone over
  });
});

// Reported from the panel: "scene 2 nunca se escucha limpio... da la sensación
// de que haces desaparecer los acordes antes de nada."
//
// It was right. Pitch was read with a `find` — ONE note per onset — so three
// notes struck together came out as one interpolated note the moment the dial
// left an end. A pad lane lost its chords to a fader nobody had moved far.
describe('chords survive the crossfade', () => {
  const chord = (step: number, ...midis: number[]) => midis.map((m) => note(step, m));
  const atAll = (ns: NoteEvent[], step: number) =>
    ns.filter((n) => n.start === step * TICKS_PER_STEP).map((n) => n.midi).sort((p, q) => p - q);

  it('keeps every voice of A at x=0', () => {
    const a = chord(0, 45, 48, 52);
    const b = chord(0, 47, 50, 53);   // B D F — all in A minor
    expect(atAll(blendMelody(a, b, 0, BAR, KEY, 'minor', OCT), 0)).toEqual([45, 48, 52]);
  });

  it('keeps every voice of B at x=1', () => {
    const a = chord(0, 45, 48, 52);
    const b = chord(0, 47, 50, 53);   // B D F — all in A minor
    expect(atAll(blendMelody(a, b, 1, BAR, KEY, 'minor', OCT), 0)).toEqual([47, 50, 53]);
  });

  it('is still a CHORD halfway, not one note', () => {
    const a = chord(0, 45, 48, 52);
    const b = chord(0, 47, 50, 53);   // B D F — all in A minor
    const out = atAll(blendMelody(a, b, 0.5, BAR, KEY, 'minor', OCT), 0);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);        // three VOICES, not one tripled
    // And every voice is in the scale, which is the whole point of walking in
    // degrees rather than semitones.
    for (const m of out) expect(inScale(m, KEY, 'minor')).toBe(true);
  });

  it('does not lose a voice the instant the dial leaves the end', () => {
    // The reported symptom, stated as a number: a hair off A must still be a
    // three-note chord.
    const a = chord(0, 45, 48, 52);
    const b = chord(0, 47, 50, 53);   // B D F — all in A minor
    const out = atAll(blendMelody(a, b, 0.02, BAR, KEY, 'minor', OCT), 0);
    expect(new Set(out).size).toBe(3);
  });

  it('a chord against a single note keeps the chord\'s voices', () => {
    // Uneven counts are the ordinary case: a pad against a bass line.
    const a = chord(0, 45, 48, 52);
    const b = [note(0, 47)];
    expect(new Set(atAll(blendMelody(a, b, 0.1, BAR, KEY, 'minor', OCT), 0)).size).toBeGreaterThan(1);
  });

  it('a monophonic line is untouched by any of this', () => {
    const a = [note(0, 45), note(4, 48)];
    const b = [note(0, 52), note(4, 55)];
    expect(midis(blendMelody(a, b, 0, BAR, KEY, 'minor', OCT))).toEqual([45, 48]);
    expect(midis(blendMelody(a, b, 1, BAR, KEY, 'minor', OCT))).toEqual([52, 55]);
  });
});
