import { describe, it, expect } from 'vitest';
import {
  inScale, snapToScale, degreesOf, scaleDegreeToMidi, rootNameEs,
  SCALE_CATALOG, STYLE_CATALOG, scaleIntervals, midiToScaleDegree,
} from './musicality';

describe('musicality core', () => {
  it('inScale knows A minor notes (A B C D E F G)', () => {
    expect(inScale(69, 9, 'minor')).toBe(true);  // A4
    expect(inScale(60, 9, 'minor')).toBe(true);  // C4
    expect(inScale(70, 9, 'minor')).toBe(false); // A#4 (not in A minor)
  });

  it('snapToScale pulls an out-of-scale note to the nearest in-scale note', () => {
    expect(snapToScale(70, 9, 'minor')).toBe(71); // A#4 → B4 (tie → up)
    expect(snapToScale(61, 9, 'minor')).toBe(62); // C#4 → D4 (tie → up)
    expect(snapToScale(60, 9, 'minor')).toBe(60); // already in scale
  });

  it('degreesOf returns the pitch classes of the scale', () => {
    expect(degreesOf(9, 'minor').sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(degreesOf(0, 'pentMinor').sort((a, b) => a - b)).toEqual([0, 3, 5, 7, 10]);
  });

  it('scaleDegreeToMidi maps degree index + octave to a midi in scale', () => {
    // degree 0 = root: key=0 (Do), base 60 → C4 = 60
    expect(scaleDegreeToMidi(0, 60, 0, 'minor')).toBe(60);
    // degree 7 wraps one octave (7-note scale) → C5 = 72
    expect(scaleDegreeToMidi(7, 60, 0, 'minor')).toBe(72);
    expect(inScale(scaleDegreeToMidi(0, 60, 0, 'minor'), 0, 'minor')).toBe(true);
    expect(inScale(scaleDegreeToMidi(7, 60, 0, 'minor'), 0, 'minor')).toBe(true);
  });

  it('rootNameEs uses Spanish note names', () => {
    expect(rootNameEs(9)).toBe('La');
    expect(rootNameEs(0)).toBe('Do');
  });

  it('catalogs are non-empty and every scale has intervals', () => {
    expect(SCALE_CATALOG.length).toBeGreaterThan(3);
    expect(STYLE_CATALOG.length).toBe(4);
    for (const s of SCALE_CATALOG) expect(scaleIntervals(s.id).length).toBeGreaterThan(0);
  });

  // --- midiToScaleDegree ---
  describe('midiToScaleDegree', () => {
    it('round-trips: scaleDegreeToMidi(midiToScaleDegree(m)) === snapToScale(m) for C minor, octaveBase 36', () => {
      const key = 0; const scale = 'minor'; const octaveBase = 36;
      const testMidis = [36, 37, 38, 40, 43, 48, 50, 51, 53, 55, 60, 62, 63, 65, 67];
      for (const m of testMidis) {
        const deg = midiToScaleDegree(m, key, scale, octaveBase);
        const rebuilt = scaleDegreeToMidi(deg, octaveBase, key, scale);
        expect(rebuilt).toBe(snapToScale(m, key, scale));
      }
    });

    it('round-trips for A minor, octaveBase 36', () => {
      const key = 9; const scale = 'minor'; const octaveBase = 36;
      const testMidis = [36, 40, 45, 52, 57, 60, 69, 72, 81];
      for (const m of testMidis) {
        const deg = midiToScaleDegree(m, key, scale, octaveBase);
        const rebuilt = scaleDegreeToMidi(deg, octaveBase, key, scale);
        expect(rebuilt).toBe(snapToScale(m, key, scale));
      }
    });

    it('round-trips for major, phrygian, dorian, pentMinor', () => {
      const octaveBase = 36;
      const cases: Array<{ key: number; scale: Parameters<typeof midiToScaleDegree>[2] }> = [
        { key: 0, scale: 'major' },
        { key: 5, scale: 'phrygian' },
        { key: 2, scale: 'dorian' },
        { key: 0, scale: 'pentMinor' },
      ];
      const testMidis = [36, 38, 42, 48, 53, 60, 65, 72];
      for (const { key, scale } of cases) {
        for (const m of testMidis) {
          const deg = midiToScaleDegree(m, key, scale, octaveBase);
          const rebuilt = scaleDegreeToMidi(deg, octaveBase, key, scale);
          expect(rebuilt).toBe(snapToScale(m, key, scale));
        }
      }
    });

    it('degree 0 maps to the root note at octaveBase', () => {
      // C minor, octaveBase 36: root = C2 = 36
      expect(midiToScaleDegree(36, 0, 'minor', 36)).toBe(0);
      // degree for one octave up (midi 48 = C3) should be 7 (scale length of minor)
      expect(midiToScaleDegree(48, 0, 'minor', 36)).toBe(7);
    });

    it('handles notes below octaveBase (negative degrees)', () => {
      const key = 0; const scale = 'minor'; const octaveBase = 60;
      const m = 48; // C3, one octave below octaveBase C4
      const deg = midiToScaleDegree(m, key, scale, octaveBase);
      expect(deg).toBe(-7); // -1 octave = -7 degrees in 7-note scale
      const rebuilt = scaleDegreeToMidi(deg, octaveBase, key, scale);
      expect(rebuilt).toBe(snapToScale(m, key, scale));
    });

    it('chromatic scale round-trip (12 degrees per octave)', () => {
      const key = 0; const scale = 'chromatic'; const octaveBase = 36;
      const testMidis = [36, 37, 38, 39, 40, 41, 48, 60, 72];
      for (const m of testMidis) {
        const deg = midiToScaleDegree(m, key, scale, octaveBase);
        const rebuilt = scaleDegreeToMidi(deg, octaveBase, key, scale);
        expect(rebuilt).toBe(snapToScale(m, key, scale));
      }
    });
  });
});
