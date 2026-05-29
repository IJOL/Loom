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
});

describe('emptyLaneRec', () => {
  it('produces an empty record for a given laneId', () => {
    const r: ArrangementLaneRec = emptyLaneRec('tb-303-1');
    expect(r.laneId).toBe('tb-303-1');
    expect(r.clipEvents).toEqual([]);
    expect(r.automation).toEqual([]);
  });
});
