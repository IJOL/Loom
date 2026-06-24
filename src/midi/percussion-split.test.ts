import { describe, it, expect } from 'vitest';
import { partitionDrumNotes, planDrumLanes, isPercKitNote, isStandardDrumNote } from './percussion-split';
import type { NoteEvent } from '../core/notes';

const n = (midi: number): NoteEvent => ({ start: 0, duration: 6, midi, velocity: 80 });

describe('percussion-split note classification', () => {
  it('kit pads (54,56,58,60..87) are percussion; the rest of 27..87 is standard drum', () => {
    expect(isPercKitNote(54)).toBe(true);   // tambourine
    expect(isPercKitNote(69)).toBe(true);   // cabasa
    expect(isPercKitNote(64)).toBe(true);   // low conga
    expect(isStandardDrumNote(36)).toBe(true); // kick
    expect(isStandardDrumNote(38)).toBe(true); // snare
    expect(isStandardDrumNote(42)).toBe(true); // closed hat
    expect(isStandardDrumNote(57)).toBe(true); // crash 2 (cymbal, not in kit)
    expect(isStandardDrumNote(54)).toBe(false); // tambourine is perc, not drum
    expect(isPercKitNote(36)).toBe(false);
  });
});

describe('partitionDrumNotes', () => {
  it('splits a mixed track (Darude-like) into drum vs perc, dropping noise', () => {
    // [35,36,39,40,41,42,43,49,52,57,59,62,63] + a 91 noise note
    const notes = [35, 36, 39, 40, 41, 42, 43, 49, 52, 57, 59, 62, 63, 91].map(n);
    const { drum, perc } = partitionDrumNotes(notes);
    expect(drum.map((x) => x.midi).sort((a, b) => a - b)).toEqual([35, 36, 39, 40, 41, 42, 43, 49, 52, 57, 59]);
    expect(perc.map((x) => x.midi).sort((a, b) => a - b)).toEqual([62, 63]); // congas
    // 91 (noise, >87) dropped
  });
});

describe('planDrumLanes', () => {
  it('mixed → both lanes', () => {
    const plan = planDrumLanes([36, 38, 42, 69, 70].map(n)); // kick/snare/hat + cabasa/maracas
    expect(plan.drum?.map((x) => x.midi)).toEqual([36, 38, 42]);
    expect(plan.perc?.map((x) => x.midi)).toEqual([69, 70]);
  });
  it('only percussion → only the perc lane', () => {
    const plan = planDrumLanes([54, 69, 75].map(n));
    expect(plan.drum).toBeNull();
    expect(plan.perc?.map((x) => x.midi)).toEqual([54, 69, 75]);
  });
  it('only standard drums → only the drum lane', () => {
    const plan = planDrumLanes([36, 38, 42, 46].map(n));
    expect(plan.perc).toBeNull();
    expect(plan.drum?.map((x) => x.midi)).toEqual([36, 38, 42, 46]);
  });
});
