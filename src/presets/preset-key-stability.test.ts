// @vitest-environment jsdom
//
// The "poly" rename may touch the TYPE name but never the storage key or its
// shape. Changing either silently loses every preset the user saved, and this
// project has no migrations. Committed BEFORE the rename so it is a guard, not
// a description of whatever the rename happened to do.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadUserPolyPresets, saveUserPolyPresets } from '../polysynth/poly-preset-store';

const KEY = 'tb303-poly-presets-v1';

describe('user preset storage survives the rename', () => {
  beforeEach(() => localStorage.removeItem(KEY));

  it('reads back what a pre-rename build wrote under its own key', () => {
    const stored = { 'My Patch': { filter: { cutoff: 0.42 } } };
    localStorage.setItem(KEY, JSON.stringify(stored));

    const loaded = loadUserPolyPresets();

    expect(loaded['My Patch'], 'the saved patch is still there').toBeTruthy();
    expect((loaded['My Patch'] as unknown as { filter: { cutoff: number } }).filter.cutoff).toBe(0.42);
  });

  it('writes to that exact key', () => {
    saveUserPolyPresets({} as Parameters<typeof saveUserPolyPresets>[0]);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});
