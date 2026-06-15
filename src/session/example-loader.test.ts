// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderExampleNotes, validateExample, type Example,
  loadUserExamples, saveUserExample, deleteUserExample,
  loadAllExamples, clipToExample, exampleToJson,
  __resetExampleCache,
} from './example-loader';
import { inScale, snapToScale } from '../core/musicality';
import type { NoteEvent } from '../core/notes';

const melodic: Example = {
  id: 'b1', name: 'Acid roller', style: 'acid', kind: 'bass', bars: 1,
  degrees: [{ start: 0, duration: 24, degree: 0, octave: 0, velocity: 115 },
            { start: 24, duration: 24, degree: 2, octave: 0, velocity: 80 }],
};
const beat: Example = {
  id: 'd1', name: 'Four floor', style: 'house', kind: 'beat', bars: 1,
  notes: [{ start: 0, duration: 24, midi: 36, velocity: 115 }],
};

// 2-bar melodic example
const melodic2: Example = {
  id: 'b2', name: 'Two bar roller', style: 'acid', kind: 'bass', bars: 2,
  degrees: [
    { start: 0,   duration: 24, degree: 0, octave: 0, velocity: 100 },
    { start: 192, duration: 24, degree: 2, octave: 0, velocity: 80 },
  ],
};

describe('example loader', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetExampleCache();
  });

  // ── existing tests (must keep passing) ──────────────────────────────────────

  it('validates melodic and beat examples', () => {
    expect(validateExample(melodic)).toBe(true);
    expect(validateExample(beat)).toBe(true);
    expect(validateExample({ id: 'x' })).toBe(false);
  });

  it('validates examples with optional source field', () => {
    const withSource: Example = { ...melodic, source: 'user' };
    expect(validateExample(withSource)).toBe(true);
    const withFactory: Example = { ...melodic, source: 'factory' };
    expect(validateExample(withFactory)).toBe(true);
  });

  it('renders melodic degrees into the target tonality (in scale)', () => {
    const notes = renderExampleNotes(melodic, { key: 9, scale: 'minor' }, 36);
    expect(notes.length).toBe(2);
    for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
  });

  it('passes beat notes through unchanged (GM)', () => {
    const notes = renderExampleNotes(beat, { key: 9, scale: 'minor' }, 36);
    expect(notes[0].midi).toBe(36);
  });

  // ── 2. Length adaptation ─────────────────────────────────────────────────────

  describe('renderExampleNotes — length adaptation', () => {
    const ticksPerBar = 384;

    it('no clipBars → behaves exactly as before (back-compat)', () => {
      const noClip = renderExampleNotes(melodic, { key: 0, scale: 'minor' }, 36);
      const withUndef = renderExampleNotes(melodic, { key: 0, scale: 'minor' }, 36, undefined, ticksPerBar);
      expect(noClip).toEqual(withUndef);
    });

    it('1-bar example into 2-bar clip yields ~2× the notes spanning 2 bars', () => {
      const notes = renderExampleNotes(melodic, { key: 0, scale: 'minor' }, 36, 2, ticksPerBar);
      // 2 degrees per bar × 2 bars = 4 notes
      expect(notes.length).toBe(4);
      // second repeat starts at naturalTicks (384)
      expect(notes[2].start).toBe(384 + melodic.degrees![0].start);
      expect(notes[3].start).toBe(384 + melodic.degrees![1].start);
      // all notes inside [0, 768)
      for (const n of notes) {
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start).toBeLessThan(2 * ticksPerBar);
      }
    });

    it('1-bar example into 4-bar clip repeats correctly (4 copies)', () => {
      const notes = renderExampleNotes(melodic, { key: 0, scale: 'minor' }, 36, 4, ticksPerBar);
      expect(notes.length).toBe(8); // 2 notes × 4 repeats
      // last group starts at 3 * 384
      expect(notes[6].start).toBe(3 * 384 + melodic.degrees![0].start);
    });

    it('2-bar example into 1-bar clip is trimmed to 1 bar', () => {
      const notes = renderExampleNotes(melodic2, { key: 0, scale: 'minor' }, 36, 1, ticksPerBar);
      // Second note is at tick 192, still inside bar 0 (384 ticks)
      // Note at start=0 is in; note at start=192 is in; but melodic2 has bar2 note at 192+384=576>384? No:
      // melodic2 starts are 0 and 192, both < 384 so both survive trim
      for (const n of notes) {
        expect(n.start).toBeLessThan(ticksPerBar);
      }
    });

    it('beat notes are also repeated/trimmed', () => {
      const notes = renderExampleNotes(beat, { key: 0, scale: 'minor' }, 36, 2, ticksPerBar);
      // beat has 1 note at start=0; 2-bar → 2 copies
      expect(notes.length).toBe(2);
      expect(notes[1].start).toBe(384);
    });

    it('trims a note that starts before but ends after the clip boundary', () => {
      const longNote: Example = {
        id: 'ln', name: 'Long', style: 'acid', kind: 'bass', bars: 1,
        degrees: [{ start: 360, duration: 100, degree: 0, octave: 0, velocity: 80 }],
      };
      const notes = renderExampleNotes(longNote, { key: 0, scale: 'minor' }, 36, 1, ticksPerBar);
      expect(notes.length).toBe(1);
      // note starts at 360, ends at 460 → clamp to 384; duration = 384-360 = 24
      expect(notes[0].start).toBe(360);
      expect(notes[0].start + notes[0].duration).toBeLessThanOrEqual(ticksPerBar);
    });

    it('drops notes that start exactly at or after the clip boundary', () => {
      const atBoundary: Example = {
        id: 'ab', name: 'At boundary', style: 'acid', kind: 'bass', bars: 2,
        degrees: [
          { start: 0,   duration: 24, degree: 0, octave: 0, velocity: 80 },
          { start: 384, duration: 24, degree: 1, octave: 0, velocity: 80 }, // exactly at 1-bar boundary
        ],
      };
      const notes = renderExampleNotes(atBoundary, { key: 0, scale: 'minor' }, 36, 1, ticksPerBar);
      expect(notes.length).toBe(1); // second note dropped
      expect(notes[0].start).toBe(0);
    });
  });

  // ── 3. User examples in localStorage ────────────────────────────────────────

  describe('localStorage user examples', () => {
    it('loadUserExamples returns [] when key absent', () => {
      expect(loadUserExamples('acid')).toEqual([]);
    });

    it('saveUserExample appends and loadUserExamples returns it', () => {
      const ex: Example = { ...melodic, id: 'user-b1', source: 'user' };
      saveUserExample(ex);
      const list = loadUserExamples('acid');
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('user-b1');
      expect(list[0].source).toBe('user');
    });

    it('saveUserExample throws on invalid example', () => {
      expect(() => saveUserExample({ id: 'bad' } as Example)).toThrow();
    });

    it('loadUserExamples filters invalid entries silently', () => {
      // Inject bad JSON array directly
      localStorage.setItem('loom.examples.acid', JSON.stringify([{ id: 'bad' }, melodic]));
      const list = loadUserExamples('acid');
      // Only the valid melodic survives
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('b1');
    });

    it('loadUserExamples returns [] on parse error', () => {
      localStorage.setItem('loom.examples.acid', 'not-json!!');
      expect(loadUserExamples('acid')).toEqual([]);
    });

    it('saveUserExample accumulates across multiple saves', () => {
      const ex1: Example = { ...melodic, id: 'user-1', source: 'user' };
      const ex2: Example = { ...melodic, id: 'user-2', source: 'user' };
      saveUserExample(ex1);
      saveUserExample(ex2);
      const list = loadUserExamples('acid');
      expect(list.length).toBe(2);
    });

    it('deleteUserExample removes a specific example by id', () => {
      const ex1: Example = { ...melodic, id: 'user-del-1', source: 'user' };
      const ex2: Example = { ...melodic, id: 'user-del-2', source: 'user' };
      saveUserExample(ex1);
      saveUserExample(ex2);
      deleteUserExample('acid', 'user-del-1');
      const list = loadUserExamples('acid');
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('user-del-2');
    });

    it('deleteUserExample is a no-op when id not found', () => {
      const ex: Example = { ...melodic, id: 'user-x', source: 'user' };
      saveUserExample(ex);
      deleteUserExample('acid', 'nonexistent');
      expect(loadUserExamples('acid').length).toBe(1);
    });

    it('user examples for different styles are stored separately', () => {
      const acidEx: Example = { ...melodic, id: 'user-acid', style: 'acid', source: 'user' };
      const houseEx: Example = { ...melodic, id: 'user-house', style: 'house', source: 'user' };
      saveUserExample(acidEx);
      saveUserExample(houseEx);
      expect(loadUserExamples('acid').length).toBe(1);
      expect(loadUserExamples('house').length).toBe(1);
      expect(loadUserExamples('acid')[0].id).toBe('user-acid');
    });
  });

  // ── 4. clipToExample + exampleToJson ─────────────────────────────────────────

  describe('clipToExample', () => {
    const ton = { key: 0, scale: 'minor' as const };
    const octaveBase = 36;
    const ticksPerBar = 384;

    // Build a set of in-scale notes in C minor (degrees 0,2,4 in octaveBase 36 → midi 36,39,41... wait: C minor intervals [0,2,3,5,7,8,10])
    // key=0 minor: C2=36 (deg0), D2=38 (deg1), Eb2=39 (deg2)
    const inScaleNotes: NoteEvent[] = [
      { start: 0,   duration: 22, midi: 36, velocity: 100 }, // C2 = degree 0
      { start: 24,  duration: 22, midi: 38, velocity: 80  }, // D2 = degree 1
      { start: 48,  duration: 22, midi: 39, velocity: 90  }, // Eb2 = degree 2
    ];

    it('converts melodic notes to ExampleDegree[] and back (round-trip)', () => {
      const ex = clipToExample({
        id: 'user-bass-test',
        name: 'Test bass',
        style: 'acid',
        kind: 'bass',
        notes: inScaleNotes,
        bars: 1,
        ton,
        octaveBase,
        ticksPerBar,
      });
      expect(ex.kind).toBe('bass');
      expect(ex.bars).toBe(1);
      expect(ex.degrees).toBeDefined();
      expect(ex.notes).toBeUndefined();
      expect(ex.degrees!.length).toBe(inScaleNotes.length);

      // Round-trip: render back and check midis match snapToScale of originals
      const rendered = renderExampleNotes(ex, ton, octaveBase);
      for (let i = 0; i < inScaleNotes.length; i++) {
        expect(rendered[i].midi).toBe(snapToScale(inScaleNotes[i].midi, ton.key, ton.scale));
      }
    });

    it('beat clips store notes as-is (GM), no degrees', () => {
      const beatNotes: NoteEvent[] = [
        { start: 0, duration: 24, midi: 36, velocity: 115 },
        { start: 96, duration: 24, midi: 42, velocity: 80 },
      ];
      const ex = clipToExample({
        id: 'user-beat-test',
        name: 'Test beat',
        style: 'house',
        kind: 'beat',
        notes: beatNotes,
        bars: 1,
        ton,
        octaveBase,
      });
      expect(ex.kind).toBe('beat');
      expect(ex.notes).toBeDefined();
      expect(ex.degrees).toBeUndefined();
      expect(ex.notes!.length).toBe(2);
      expect(ex.notes![0].midi).toBe(36);
    });

    it('generated example has correct metadata', () => {
      const ex = clipToExample({
        id: 'user-meta-test',
        name: 'My Riff',
        style: 'synthwave',
        kind: 'melody',
        notes: inScaleNotes,
        bars: 2,
        ton,
        octaveBase,
      });
      expect(ex.id).toBe('user-meta-test');
      expect(ex.name).toBe('My Riff');
      expect(ex.style).toBe('synthwave');
      expect(ex.bars).toBe(2);
      expect(ex.source).toBe('user');
    });

    it('ExampleDegree has octave folded into degree (octave field is always 0)', () => {
      const ex = clipToExample({
        id: 'user-octave-test',
        name: 'Octave test',
        style: 'acid',
        kind: 'bass',
        notes: inScaleNotes,
        bars: 1,
        ton,
        octaveBase,
      });
      for (const d of ex.degrees!) {
        expect(d.octave).toBe(0);
      }
    });

    it('exampleToJson produces valid JSON that parses back to the example', () => {
      const ex = clipToExample({
        id: 'user-json-test',
        name: 'JSON export',
        style: 'acid',
        kind: 'bass',
        notes: inScaleNotes,
        bars: 1,
        ton,
        octaveBase,
      });
      const json = exampleToJson(ex);
      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json) as Example;
      expect(validateExample(parsed)).toBe(true);
      expect(parsed.id).toBe(ex.id);
      expect(parsed.degrees!.length).toBe(ex.degrees!.length);
    });

    it('out-of-scale midi is snapped before degree conversion', () => {
      const outOfScaleNotes: NoteEvent[] = [
        { start: 0, duration: 24, midi: 37, velocity: 80 }, // C#2 not in C minor → snaps to D2=38
      ];
      const ex = clipToExample({
        id: 'user-snap-test',
        name: 'Snap test',
        style: 'acid',
        kind: 'bass',
        notes: outOfScaleNotes,
        bars: 1,
        ton,
        octaveBase,
      });
      const rendered = renderExampleNotes(ex, ton, octaveBase);
      expect(rendered[0].midi).toBe(snapToScale(37, ton.key, ton.scale)); // 38 (D2)
    });
  });
});
