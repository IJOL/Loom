import { describe, it, expect } from 'vitest';
import {
  inScale, snapToScale, degreesOf, scaleDegreeToMidi, rootNameEs,
  SCALE_CATALOG, STYLE_CATALOG, scaleIntervals,
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
});
