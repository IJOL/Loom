import { describe, it, expect } from 'vitest';
import {
  emptyArrangementState, emptyLaneRec,
  type ArrangementState, type ArrangementLaneRec,
} from './performance';
import { songBarSec } from '../core/song-position';
import { DEFAULT_METER } from '../core/meter';

describe('emptyArrangementState', () => {
  it('returns durationSec=0, empty lanes, empty globalAutomation, bpm preserved', () => {
    const s: ArrangementState = emptyArrangementState(130);
    expect(s.bpm).toBe(130);
    expect(s.durationSec).toBe(0);
    expect(s.lanes).toEqual([]);
    expect(s.globalAutomation).toEqual([]);
  });

  it('carries the meter it was given, so a bar is as long as the session says', () => {
    const three = emptyArrangementState(120, { num: 3, den: 4 });
    const four = emptyArrangementState(120);
    // Relative: a 3/4 bar is three quarters where the default one is four.
    expect(songBarSec(120, three.meter) / songBarSec(120, four.meter)).toBeCloseTo(3 / 4, 6);
    expect(songBarSec(120, four.meter)).toBe(songBarSec(120, DEFAULT_METER));
  });

  it('stores a copy of the meter, never an alias of the session one', () => {
    const live = { num: 3, den: 4 };
    const s = emptyArrangementState(120, live);
    live.num = 7;
    expect(s.meter).toEqual({ num: 3, den: 4 });
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
