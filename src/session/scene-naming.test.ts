// Printing named every scene the same word.
//
// Reported from a session with a dozen prints in it: twelve rows called
// "Weave", and the clips carry the scene's name, so twelve clips too. Nothing
// on screen said which print was which.
import { describe, it, expect } from 'vitest';
import { nextSceneName } from './session-runtime';

const named = (...names: string[]) => names.map((name) => ({ name }));

describe('nextSceneName', () => {
  it('starts at one', () => {
    expect(nextSceneName([], 'Weave')).toBe('Weave 1');
  });

  it('counts the family and takes the next', () => {
    expect(nextSceneName(named('Weave 1', 'Weave 2'), 'Weave')).toBe('Weave 3');
  });

  it('treats a bare stem as number one — the prints made before this existed', () => {
    expect(nextSceneName(named('Weave'), 'Weave')).toBe('Weave 2');
  });

  it('counts from the HIGHEST, not from how many there are', () => {
    // Delete scene 2 of three and the next print must not collide with 3.
    expect(nextSceneName(named('Weave 1', 'Weave 3'), 'Weave')).toBe('Weave 4');
  });

  it('ignores scenes of other families', () => {
    expect(nextSceneName(named('Scene 1', 'Stems', 'MIDI Import'), 'Weave')).toBe('Weave 1');
  });

  it('ignores a name that merely CONTAINS the stem', () => {
    // "Weave ideas" is something the user typed, not a print. Renaming a scene
    // must never make the next print skip a number.
    expect(nextSceneName(named('Weave ideas', 'Reweave 2'), 'Weave')).toBe('Weave 1');
  });

  it('survives an unnamed scene', () => {
    expect(nextSceneName([{}, { name: 'Weave 1' }], 'Weave')).toBe('Weave 2');
  });

  it('works for any stem, so the next thing that prints gets it free', () => {
    expect(nextSceneName(named('Stems 1'), 'Stems')).toBe('Stems 2');
  });
});
