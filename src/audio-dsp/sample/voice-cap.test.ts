import { describe, it, expect } from 'vitest';
import { stealForCap, type CapSlot } from './voice-cap';

interface Slot extends CapSlot { id: number; }
const pool = (n: number): Slot[] => Array.from({ length: n }, (_, id) => ({ id }));

describe('stealForCap — the sampler voice budget', () => {
  it('does nothing while the pool is under budget', () => {
    const live = pool(3);
    const stolen: number[] = [];
    stealForCap(live, 4, (s) => stolen.push(s.id));
    expect(stolen).toEqual([]);
  });

  it('steals exactly the oldest voice when the pool is at budget', () => {
    const live = pool(4);
    const stolen: number[] = [];
    stealForCap(live, 4, (s) => stolen.push(s.id));
    expect(stolen).toEqual([0]);
    expect(live[0].stolen).toBe(true);
  });

  it('never steals a voice twice — a second spawn moves on to the next oldest', () => {
    const live = pool(4);
    const stolen: number[] = [];
    stealForCap(live, 4, (s) => stolen.push(s.id));
    stealForCap(live, 4, (s) => stolen.push(s.id));
    expect(stolen).toEqual([0, 1]);
  });

  it('steals enough to land back at budget when already over it', () => {
    // 6 live against a budget of 4: the incoming voice makes 7, so 3 fades are
    // needed for the pool to settle at 4 once they finish.
    const live = pool(6);
    const stolen: number[] = [];
    stealForCap(live, 4, (s) => stolen.push(s.id));
    expect(stolen).toEqual([0, 1, 2]);
  });

  it('a budget of 1 makes the pool effectively mono', () => {
    const live = pool(1);
    const stolen: number[] = [];
    stealForCap(live, 1, (s) => stolen.push(s.id));
    expect(stolen).toEqual([0]);
  });
});
