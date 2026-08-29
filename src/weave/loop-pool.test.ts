// The list a lane draws from, walked in the order it was written.
import { describe, it, expect } from 'vitest';
import { nextFromPool } from './loop-pool';

describe('nextFromPool', () => {
  it('hands over to the next entry in the list', () => {
    expect(nextFromPool(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextFromPool(['a', 'b', 'c'], 'b')).toBe('c');
  });

  it('wraps at the end rather than running out', () => {
    // A lane that reached the last entry and stopped would go quietly static
    // while the rest of the scene travels — the same rule the clip walk uses.
    expect(nextFromPool(['a', 'b', 'c'], 'c')).toBe('a');
  });

  it('starts at the head when the loop leaving is not in the list', () => {
    // The list was edited under a lane that was already travelling. Rejoining
    // at the front is the answer that plays what the user wrote next.
    expect(nextFromPool(['a', 'b'], 'zzz')).toBe('a');
  });

  it('says nothing for an empty list — there is no successor', () => {
    expect(nextFromPool([], 'a')).toBeNull();
  });

  it('holds a list of ONE where it is', () => {
    // Honest rather than clever: one entry is one entry, and the caller decides
    // whether that means "do not hand over".
    expect(nextFromPool(['a'], 'a')).toBe('a');
  });
});
