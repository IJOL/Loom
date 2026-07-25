import { describe, it, expect } from 'vitest';
import {
  emptyArrangementState, emptyLaneRec,
  type ArrangementState, type ArrangementLaneRec,
} from './performance';

describe('emptyArrangementState', () => {
  it('returns durationSec=0, empty lanes, empty globalAutomation, bpm preserved', () => {
    const s: ArrangementState = emptyArrangementState(130);
    expect(s.bpm).toBe(130);
    expect(s.durationSec).toBe(0);
    expect(s.lanes).toEqual([]);
    expect(s.globalAutomation).toEqual([]);
  });

  it('stores no meter of its own — bars belong to the song', () => {
    // A copy here was a cache the session could outrun (the Meter selector sits
    // in the always-visible transport row). Readers take the meter from the
    // Sequencer at use time instead; nothing may re-introduce a field.
    const s = emptyArrangementState(120) as ArrangementState & { meter?: unknown };
    expect(s.meter).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(s, 'meter')).toBe(false);
  });
});

describe('emptyLaneRec', () => {
  it('produces an empty record for a given laneId', () => {
    const r: ArrangementLaneRec = emptyLaneRec('tb-303-1');
    expect(r.laneId).toBe('tb-303-1');
    expect(r.clipEvents).toEqual([]);
    expect(r.automation).toEqual([]);
  });
});
