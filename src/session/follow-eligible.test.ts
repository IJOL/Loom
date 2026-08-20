// The picker and the LOADER must agree about who can lead. They read this same
// function precisely so they cannot drift: a dropdown that offered a lane the
// loader then discards is a setting that survives until the next reload.

import { describe, it, expect } from 'vitest';
import { eligibleLeaders } from './follow-eligible';
import {
  registerEngineCapabilities, unregisterEngineCapabilities,
} from '../plugins/capabilities';
import type { SessionLane } from './session-types';

const lane = (id: string, engineId = 'subtractive', extra: Record<string, unknown> = {}) =>
  ({ id, engineId, clips: [], inserts: [], ...extra }) as unknown as SessionLane;

describe('eligibleLeaders', () => {
  it('offers the other melodic lanes', () => {
    expect(eligibleLeaders([lane('a'), lane('b')], 'b').map((l) => l.id)).toEqual(['a']);
  });

  it('never offers the lane itself', () => {
    expect(eligibleLeaders([lane('a')], 'a')).toEqual([]);
  });

  it('never offers a drum lane — there is no harmony in it to read', () => {
    // The registry has to be seeded: an UNKNOWN id answers "behaves like an
    // ordinary melodic instrument" on purpose, so without this the drum lane
    // reads as eligible and the test passes for the wrong reason in reverse.
    registerEngineCapabilities('drums-machine', {
      harmonic: false, clipContent: 'notes', shortLabel: 'DR', outputTrim: 1,
    });
    try {
      expect(eligibleLeaders([lane('d', 'drums-machine'), lane('b')], 'b')).toEqual([]);
    } finally {
      unregisterEngineCapabilities('drums-machine');
    }
  });

  it('never offers a lane that already follows — no chains, so no cycles', () => {
    const lanes = [lane('a', 'subtractive', { follow: { leaderId: 'c' } }), lane('b')];
    expect(eligibleLeaders(lanes, 'b')).toEqual([]);
  });

  it('offers a lane that is FOLLOWED — being a leader twice is fine', () => {
    // Two lanes accompanying one melody is the ordinary case: a pad and a bass.
    const lanes = [lane('lead'), lane('pad', 'subtractive', { follow: { leaderId: 'lead' } }), lane('bass')];
    expect(eligibleLeaders(lanes, 'bass').map((l) => l.id)).toEqual(['lead']);
  });

  it('is empty when there is nobody to follow', () => {
    expect(eligibleLeaders([lane('only')], 'only')).toEqual([]);
  });
});
