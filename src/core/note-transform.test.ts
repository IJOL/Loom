import { describe, it, expect } from 'vitest';
import { variateNotes, invertMelodic, invertRetrograde, type VariateOpts } from './note-transform';
import { inScale, scaleDegreeToMidi } from './musicality';
import { TICKS_PER_STEP, type NoteEvent } from './notes';

// ── mulberry32 deterministic RNG (same helper as generators.test.ts) ─────────
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────
const KEY = 9;   // A
const SCALE = 'minor' as const;
// Bar of 4 beats at 16ths = 16 steps × 24 ticks
const CLIP_TICKS = 16 * TICKS_PER_STEP; // 384

// Build a simple ascending melody spanning 4 steps, all in scale.
// Scale degrees 0,1,2,3 in A minor relative to REF=0:
//   deg0 → A (midi 9), deg1 → B (midi 11), deg2 → C (midi 12), deg3 → E (midi 16 … wraps)
// Use scaleDegreeToMidi with octaveBase=0 to produce the reference set.
function makeMelody(): NoteEvent[] {
  return [0, 1, 2, 3].map((deg, i) => ({
    start: i * TICKS_PER_STEP,
    duration: TICKS_PER_STEP,
    midi: scaleDegreeToMidi(deg, 0, KEY, SCALE),
    velocity: 80,
  }));
}

function opts(seed: number, overrides: Partial<VariateOpts> = {}): VariateOpts {
  return {
    key: KEY,
    scale: SCALE,
    melodic: true,
    clipTicks: CLIP_TICKS,
    rng: mulberry32(seed),
    ...overrides,
  };
}

// ── variateNotes (melodic) ────────────────────────────────────────────────────
describe('variateNotes (melodic)', () => {
  it('all output notes are in scale', () => {
    for (let seed = 0; seed < 20; seed++) {
      const notes = makeMelody();
      const result = variateNotes(notes, opts(seed));
      for (const n of result) {
        expect(inScale(n.midi, KEY, SCALE), `seed=${seed} midi=${n.midi} not in scale`).toBe(true);
      }
    }
  });

  it('output length is within [n-1, n+1] of the input length', () => {
    const n = makeMelody().length;
    for (let seed = 0; seed < 30; seed++) {
      const result = variateNotes(makeMelody(), opts(seed));
      expect(result.length).toBeGreaterThanOrEqual(n - 1);
      expect(result.length).toBeLessThanOrEqual(n + 1);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = variateNotes(makeMelody(), opts(42));
    const b = variateNotes(makeMelody(), opts(42));
    expect(a).toEqual(b);
  });

  it('at least one note differs from the input across a range of seeds', () => {
    const notes = makeMelody();
    // Run enough seeds to ensure at least one produces a mutation.
    let anyDiff = false;
    for (let seed = 0; seed < 50; seed++) {
      const result = variateNotes(notes, opts(seed));
      const diff =
        result.length !== notes.length ||
        result.some((r, i) => notes[i] && (r.midi !== notes[i].midi || r.velocity !== notes[i].velocity || r.start !== notes[i].start));
      if (diff) { anyDiff = true; break; }
    }
    expect(anyDiff).toBe(true);
  });

  it('all output start positions are >= 0 and start+duration <= clipTicks', () => {
    for (let seed = 0; seed < 20; seed++) {
      const result = variateNotes(makeMelody(), opts(seed));
      for (const n of result) {
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start + n.duration).toBeLessThanOrEqual(CLIP_TICKS);
      }
    }
  });
});

// ── variateNotes (non-melodic / drums) ───────────────────────────────────────
describe('variateNotes (non-melodic / drums)', () => {
  // Drum notes use GM pitches that are NOT in the A-minor scale —
  // the variator must leave them untouched.
  const DRUM_NOTES: NoteEvent[] = [
    { start: 0,               duration: 6, midi: 36, velocity: 115 }, // kick
    { start: TICKS_PER_STEP,  duration: 6, midi: 38, velocity: 80 },  // snare
    { start: 2 * TICKS_PER_STEP, duration: 6, midi: 42, velocity: 80 }, // HH closed
    { start: 3 * TICKS_PER_STEP, duration: 6, midi: 46, velocity: 80 }, // HH open
  ];

  it('preserves all GM midi values (no pitch changes on non-melodic notes)', () => {
    const inputMidis = DRUM_NOTES.map((n) => n.midi);
    for (let seed = 0; seed < 50; seed++) {
      const result = variateNotes(DRUM_NOTES, opts(seed, { melodic: false }));
      // Collect the result midis sorted; input midis sorted. If the variator only
      // drops or adds (same midi), the multiset of midis that survive must be a
      // subset of inputMidis.
      for (const r of result) {
        expect(inputMidis).toContain(r.midi);
      }
    }
  });

  it('may change count (drop / add) and/or velocity, but never introduces new pitches', () => {
    const inputMidis = new Set(DRUM_NOTES.map((n) => n.midi));
    let countChangedOnce = false;
    for (let seed = 0; seed < 100; seed++) {
      const result = variateNotes(DRUM_NOTES, opts(seed, { melodic: false }));
      for (const r of result) expect(inputMidis.has(r.midi)).toBe(true);
      if (result.length !== DRUM_NOTES.length) countChangedOnce = true;
    }
    expect(countChangedOnce).toBe(true);
  });
});

// ── invertMelodic ─────────────────────────────────────────────────────────────
describe('invertMelodic', () => {
  it('returns [] for empty input', () => {
    expect(invertMelodic([], KEY, SCALE)).toEqual([]);
  });

  it('a strictly ascending input produces a strictly descending output', () => {
    const notes = makeMelody(); // degrees 0,1,2,3 → ascending
    const result = invertMelodic(notes, KEY, SCALE);
    // Each consecutive pair must have midi[i] >= midi[i+1] (mirror of ascending).
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].midi).toBeGreaterThanOrEqual(result[i + 1].midi);
    }
    // And at least one step must be strictly greater (not all equal).
    const isStrictlyDesc = result.some((_, i) => i < result.length - 1 && result[i].midi > result[i + 1].midi);
    expect(isStrictlyDesc).toBe(true);
  });

  it('all output pitches are in scale', () => {
    const result = invertMelodic(makeMelody(), KEY, SCALE);
    for (const n of result) {
      expect(inScale(n.midi, KEY, SCALE)).toBe(true);
    }
  });

  it('start times and durations are unchanged', () => {
    const notes = makeMelody();
    const result = invertMelodic(notes, KEY, SCALE);
    for (let i = 0; i < notes.length; i++) {
      expect(result[i].start).toBe(notes[i].start);
      expect(result[i].duration).toBe(notes[i].duration);
    }
  });

  it('the first note (the pivot) has the same midi as the input', () => {
    const notes = makeMelody();
    const result = invertMelodic(notes, KEY, SCALE);
    // degree mirrored around itself → 2*pivot - pivot = pivot → same midi
    expect(result[0].midi).toBe(notes[0].midi);
  });

  it('applying inversion twice returns the original pitches', () => {
    const notes = makeMelody();
    const once = invertMelodic(notes, KEY, SCALE);
    const twice = invertMelodic(once, KEY, SCALE);
    for (let i = 0; i < notes.length; i++) {
      expect(twice[i].midi).toBe(notes[i].midi);
    }
  });
});

// ── invertRetrograde ──────────────────────────────────────────────────────────
describe('invertRetrograde', () => {
  it('returns [] for empty input', () => {
    expect(invertRetrograde([], CLIP_TICKS)).toEqual([]);
  });

  it('pitches are unchanged', () => {
    const notes = makeMelody();
    const result = invertRetrograde(notes, CLIP_TICKS);
    for (let i = 0; i < notes.length; i++) {
      expect(result[i].midi).toBe(notes[i].midi);
      expect(result[i].velocity).toBe(notes[i].velocity);
      expect(result[i].duration).toBe(notes[i].duration);
    }
  });

  it('the note that started last now starts at/near 0', () => {
    const notes = makeMelody(); // sorted ascending by start
    const last = notes[notes.length - 1];
    const result = invertRetrograde(notes, CLIP_TICKS);
    // last note → start = clipTicks - (last.start + last.duration)
    const expected = Math.max(0, CLIP_TICKS - (last.start + last.duration));
    // Find the corresponding result note (same index, pitches are preserved by position)
    expect(result[notes.length - 1].start).toBe(expected);
  });

  it('a note at start=0, dur=TICKS_PER_STEP maps to start=clipTicks-TICKS_PER_STEP', () => {
    const n: NoteEvent = { start: 0, duration: TICKS_PER_STEP, midi: 60, velocity: 80 };
    const [r] = invertRetrograde([n], CLIP_TICKS);
    expect(r.start).toBe(CLIP_TICKS - TICKS_PER_STEP);
  });

  it('applying retrograde twice returns the same start times', () => {
    const notes = makeMelody();
    const once = invertRetrograde(notes, CLIP_TICKS);
    const twice = invertRetrograde(once, CLIP_TICKS);
    for (let i = 0; i < notes.length; i++) {
      expect(twice[i].start).toBe(notes[i].start);
    }
  });

  it('all output start positions are >= 0', () => {
    const notes = makeMelody();
    const result = invertRetrograde(notes, CLIP_TICKS);
    for (const n of result) expect(n.start).toBeGreaterThanOrEqual(0);
  });
});
