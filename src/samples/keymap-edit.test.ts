import { describe, it, expect } from 'vitest';
import { addSampleToKeymap, removeKeymapEntry, setEntryRoot, setEntryRange } from './keymap-edit';
import type { KeymapEntry } from './types';

const base: KeymapEntry[] = [{ sampleId: 'a', rootNote: 60, loNote: 0, hiNote: 127 }];

describe('keymap-edit', () => {
  it('addSampleToKeymap appends a full-range melodic entry by default', () => {
    const out = addSampleToKeymap([], 'a');
    expect(out).toEqual([{ sampleId: 'a', rootNote: 60, loNote: 0, hiNote: 127 }]);
  });
  it('addSampleToKeymap accepts a root override and does not mutate the input', () => {
    const input: KeymapEntry[] = [];
    const out = addSampleToKeymap(input, 'b', { rootNote: 48 });
    expect(out[0].rootNote).toBe(48);
    expect(input).toEqual([]); // immutability
  });
  it('removeKeymapEntry removes by index', () => {
    expect(removeKeymapEntry(base, 0)).toEqual([]);
  });
  it('setEntryRoot updates one entry root, leaving others intact', () => {
    const two = [...base, { sampleId: 'c', rootNote: 36, loNote: 36, hiNote: 36 }];
    const out = setEntryRoot(two, 1, 40);
    expect(out[1].rootNote).toBe(40);
    expect(out[0].rootNote).toBe(60);
  });
  it('setEntryRange clamps lo<=hi and stays in 0..127', () => {
    const out = setEntryRange(base, 0, 200, -5);
    expect(out[0].loNote).toBeGreaterThanOrEqual(0);
    expect(out[0].hiNote).toBeLessThanOrEqual(127);
    expect(out[0].loNote).toBeLessThanOrEqual(out[0].hiNote);
  });
});
