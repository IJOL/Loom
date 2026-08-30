import { describe, it, expect } from 'vitest';
import { newBandId, migrateArrangementBands, emptyArrangementState, emptyLaneRec } from './performance';

describe('band identity', () => {
  it('newBandId is unique across calls', () => {
    expect(newBandId()).not.toBe(newBandId());
  });

  it('a burst of ids stays unique (the seq half does the work within one ms)', () => {
    const ids = Array.from({ length: 1000 }, () => newBandId());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('migrateArrangementBands backfills missing ids and leaves existing ones alone', () => {
    const a = emptyArrangementState(120);
    a.lanes.push(emptyLaneRec('l1'));
    a.lanes[0].clipEvents.push(
      { clipId: 'c1', laneId: 'l1', atSec: 0, untilSec: 2 } as never, // old save: no id
      { id: 'keep-me', clipId: 'c2', laneId: 'l1', atSec: 2, untilSec: 4 },
    );
    migrateArrangementBands(a);
    expect(a.lanes[0].clipEvents[0].id).toBeTruthy();
    expect(a.lanes[0].clipEvents[1].id).toBe('keep-me');
    const ids = a.lanes[0].clipEvents.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
