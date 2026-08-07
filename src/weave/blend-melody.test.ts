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
