import { describe, it, expect } from 'vitest';
import { keymapEntryFor, repitchRate } from './keymap';
import type { KeymapEntry } from './types';

const melodic: KeymapEntry[] = [{ sampleId: 'lead', rootNote: 60, loNote: 0, hiNote: 127 }];
const rack: KeymapEntry[] = [
  { sampleId: 'kick',  rootNote: 36, loNote: 36, hiNote: 36 },
  { sampleId: 'snare', rootNote: 38, loNote: 38, hiNote: 38 },
];

describe('keymapEntryFor', () => {
  it('a single full-range entry matches any note (melodic)', () => {
    expect(keymapEntryFor(melodic, 24)?.sampleId).toBe('lead');
    expect(keymapEntryFor(melodic, 96)?.sampleId).toBe('lead');
  });
  it('single-note entries match only their note (rack)', () => {
    expect(keymapEntryFor(rack, 36)?.sampleId).toBe('kick');
    expect(keymapEntryFor(rack, 38)?.sampleId).toBe('snare');
    expect(keymapEntryFor(rack, 40)).toBeUndefined();
  });
  it('a later pad overrides an earlier broad range', () => {
    const mixed: KeymapEntry[] = [...melodic, { sampleId: 'fx', rootNote: 60, loNote: 60, hiNote: 60 }];
    expect(keymapEntryFor(mixed, 60)?.sampleId).toBe('fx');   // last match wins
    expect(keymapEntryFor(mixed, 61)?.sampleId).toBe('lead');
  });
});

describe('repitchRate', () => {
  it('plays at unity on the root note', () => {
    expect(repitchRate(60, 60)).toBeCloseTo(1, 6);
  });
  it('an octave up doubles the rate', () => {
    expect(repitchRate(72, 60)).toBeCloseTo(2, 6);
  });
  it('applies a global pitch offset in semitones', () => {
    expect(repitchRate(60, 60, 12)).toBeCloseTo(2, 6);
  });
});
