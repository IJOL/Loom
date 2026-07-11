import { describe, it, expect } from 'vitest';
import { expandChordForLane } from './live-notefx';
import { getNoteFxChain } from '../notefx/notefx-registry';

describe('expandChordForLane', () => {
  it('returns the single note when no note-FX is enabled', () => {
    expect(expandChordForLane('lane-none', 60, 100, 120)).toEqual([60]);
  });

  it('expands to a major triad when a chord note-FX is enabled', () => {
    const chain = getNoteFxChain('lane-chord');
    const s = chain.addNoteFx('chord');   // defaults: maj, octave 0 → [0,4,7]
    s.enabled = true;
    expect(expandChordForLane('lane-chord', 60, 100, 120)).toEqual([60, 64, 67]);
  });

  it('ignores arp note-FX (live arp is out of scope)', () => {
    const chain = getNoteFxChain('lane-arp');
    chain.addNoteFx('arp').enabled = true;
    expect(expandChordForLane('lane-arp', 60, 100, 120)).toEqual([60]);
  });
});
