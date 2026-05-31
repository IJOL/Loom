import { describe, it, expect } from 'vitest';
import { emptyArrangementState, emptyLaneRec } from './performance';
import {
  appendClipEvent, closePendingClipEvent, getOrCreateLane,
} from './arrangement-ops';

describe('getOrCreateLane', () => {
  it('creates a new lane record on first call, returns the same on second', () => {
    const s = emptyArrangementState(120);
    const a = getOrCreateLane(s, 'lane-a');
    expect(s.lanes).toHaveLength(1);
    const b = getOrCreateLane(s, 'lane-a');
    expect(b).toBe(a);
    expect(s.lanes).toHaveLength(1);
  });
});

describe('appendClipEvent', () => {
  it('appends an open-ended event (untilSec = +Infinity)', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0.5);
    const lane = s.lanes[0];
    expect(lane.clipEvents).toHaveLength(1);
    expect(lane.clipEvents[0]).toMatchObject({
      clipId: 'clip-1', laneId: 'lane-a', atSec: 0.5, untilSec: Infinity,
    });
  });

  it('overdub: new event closes the previous open event in the same lane', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0);
    appendClipEvent(s, 'lane-a', 'clip-2', 2);
    const lane = s.lanes[0];
    expect(lane.clipEvents).toHaveLength(2);
    expect(lane.clipEvents[0].untilSec).toBe(2);
    expect(lane.clipEvents[1].untilSec).toBe(Infinity);
  });

  it('does not touch events in other lanes', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0);
    appendClipEvent(s, 'lane-b', 'clip-2', 1);
    expect(s.lanes[0].clipEvents[0].untilSec).toBe(Infinity);
    expect(s.lanes[1].clipEvents[0].untilSec).toBe(Infinity);
  });
});

describe('closePendingClipEvent', () => {
  it('sets untilSec on the last open event', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0);
    closePendingClipEvent(s, 'lane-a', 3);
    expect(s.lanes[0].clipEvents[0].untilSec).toBe(3);
  });

  it('is a no-op when the lane has no events', () => {
    const s = emptyArrangementState(120);
    expect(() => closePendingClipEvent(s, 'lane-a', 3)).not.toThrow();
  });

  it('is a no-op when the last event is already closed', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0);
    closePendingClipEvent(s, 'lane-a', 3);
    closePendingClipEvent(s, 'lane-a', 5);
    expect(s.lanes[0].clipEvents[0].untilSec).toBe(3);
  });
});

import { routeParamId, writeAutomationSample, sampleAutomationAt } from './arrangement-ops';
import { AUTOMATION_SUB_RES } from '../core/pattern';

describe('routeParamId', () => {
  const laneIds = ['tb-303-1', 'drums-1', 'subtractive-1'];

  it('matches a paramId by lane prefix', () => {
    expect(routeParamId('tb-303-1.cutoff', laneIds)).toEqual({ kind: 'lane', laneId: 'tb-303-1' });
    expect(routeParamId('subtractive-1.amp.attack', laneIds)).toEqual({ kind: 'lane', laneId: 'subtractive-1' });
  });

  it('falls back to global for prefixes not in the lane list', () => {
    expect(routeParamId('fx.reverb.wet', laneIds)).toEqual({ kind: 'global' });
    expect(routeParamId('mix.master.pan', laneIds)).toEqual({ kind: 'global' });
    expect(routeParamId('tb303.something', laneIds)).toEqual({ kind: 'global' });
  });

  it('matches the longest lane id when prefixes overlap', () => {
    const ids = ['subtractive-1', 'subtractive-10'];
    expect(routeParamId('subtractive-10.cutoff', ids)).toEqual({ kind: 'lane', laneId: 'subtractive-10' });
  });
});

describe('writeAutomationSample', () => {
  it('creates a curve on first write, sized for the sample index', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'tb-303-1.cutoff', 0.42, /*subIdx=*/3, ['tb-303-1']);
    const lane = s.lanes[0];
    const curve = lane.automation[0];
    expect(curve.paramId).toBe('tb-303-1.cutoff');
    expect(curve.values.length).toBeGreaterThanOrEqual(4);
    expect(curve.values[3]).toBe(0.42);
  });

  it('global paramIds go to globalAutomation', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'fx.reverb.wet', 0.8, 1, ['tb-303-1']);
    expect(s.globalAutomation).toHaveLength(1);
    expect(s.globalAutomation[0].values[1]).toBe(0.8);
    expect(s.lanes).toHaveLength(0);
  });

  it('overdub: new write at the same subIdx overwrites the previous value', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'tb-303-1.cutoff', 0.2, 5, ['tb-303-1']);
    writeAutomationSample(s, 'tb-303-1.cutoff', 0.9, 5, ['tb-303-1']);
    expect(s.lanes[0].automation[0].values[5]).toBe(0.9);
  });
});

describe('sampleAutomationAt', () => {
  it('returns the sample at the floor-rounded subIdx', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'fx.reverb.wet', 0.3, 0, []);
    writeAutomationSample(s, 'fx.reverb.wet', 0.7, 1, []);
    const curve = s.globalAutomation[0];
    expect(sampleAutomationAt(curve, 0)).toBe(0.3);
    expect(sampleAutomationAt(curve, 1)).toBe(0.7);
  });

  it('holds the last written value for sub-steps past the end', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'fx.reverb.wet', 0.5, 2, []);
    const curve = s.globalAutomation[0];
    expect(sampleAutomationAt(curve, 99)).toBe(0.5);
  });
});

import { finalizeArrangement } from './arrangement-ops';
import { stepsPerSec } from './performance';

describe('finalizeArrangement', () => {
  it('sets durationSec to the max finite untilSec across lanes', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'c1', 0); closePendingClipEvent(s, 'lane-a', 4);
    appendClipEvent(s, 'lane-b', 'c2', 0); closePendingClipEvent(s, 'lane-b', 6);
    finalizeArrangement(s, 10);
    expect(s.durationSec).toBe(6);
  });

  it('closes any still-open clip event at atSec, then counts it toward duration', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'c1', 1); // untilSec = Infinity (still playing)
    finalizeArrangement(s, 7);
    expect(s.lanes[0].clipEvents[0].untilSec).toBe(7);
    expect(s.durationSec).toBe(7);
  });

  it('leaves durationSec at 0 for an empty arrangement (nothing recorded)', () => {
    const s = emptyArrangementState(120);
    finalizeArrangement(s, 12);
    expect(s.durationSec).toBe(0);
  });

  it('extends durationSec to cover automation written past the last clip', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'c1', 0); closePendingClipEvent(s, 'lane-a', 2);
    const subIdxAt5s = Math.floor(5 * stepsPerSec(120) * AUTOMATION_SUB_RES);
    writeAutomationSample(s, 'lane-a.cutoff', 0.5, subIdxAt5s, ['lane-a']);
    finalizeArrangement(s, 10);
    // automation ends ~5s, well past the clip's 2s end
    expect(s.durationSec).toBeGreaterThan(2);
  });
});

import {
  effectiveDurationSec, setArrangementLengthBars,
  addAutomationCurve, removeAutomationCurve,
} from './arrangement-ops';

describe('arrangement length', () => {
  it('effectiveDurationSec is max(durationSec, lengthBars*barSec)', () => {
    const s = emptyArrangementState(120);          // barSec = 2s at 120bpm
    s.durationSec = 3;
    s.lengthBars = 4;                               // 4 bars * 2s = 8s
    expect(effectiveDurationSec(s)).toBe(8);
    s.lengthBars = 1;                               // 2s < 3s recorded
    expect(effectiveDurationSec(s)).toBe(3);
  });

  it('setArrangementLengthBars grows curves by hold and truncates on shrink', () => {
    const s = emptyArrangementState(120);
    s.globalAutomation.push({ paramId: 'fx.reverb.wet', values: [0.2, 0.9], enabled: true });
    setArrangementLengthBars(s, 1);                 // 1 bar -> 16*SUB_RES samples
    const curve = s.globalAutomation[0];
    const expected = 1 * 16 * AUTOMATION_SUB_RES;
    expect(curve.values.length).toBe(expected);
    expect(curve.values[curve.values.length - 1]).toBe(0.9);   // held last value
    expect(s.lengthBars).toBe(1);
  });
});

describe('addAutomationCurve', () => {
  const laneIds = ['tb-303-1', 'subtractive-1'];

  it('routes a lane-prefixed param into that lane and sizes to the arrangement', () => {
    const s = emptyArrangementState(120);
    s.lengthBars = 1;
    addAutomationCurve(s, 'tb-303-1.cutoff', laneIds);
    const lane = s.lanes.find((l) => l.laneId === 'tb-303-1')!;
    expect(lane.automation[0].paramId).toBe('tb-303-1.cutoff');
    expect(lane.automation[0].values.every((v) => v === 0.5)).toBe(true);
    expect(lane.automation[0].values.length).toBe(1 * 16 * AUTOMATION_SUB_RES);
  });

  it('routes a non-lane param into globalAutomation and is idempotent', () => {
    const s = emptyArrangementState(120);
    s.lengthBars = 1;
    addAutomationCurve(s, 'fx.reverb.wet', laneIds);
    addAutomationCurve(s, 'fx.reverb.wet', laneIds);   // no duplicate
    expect(s.globalAutomation.length).toBe(1);
  });

  it('removeAutomationCurve removes by paramId from the routed list', () => {
    const s = emptyArrangementState(120);
    s.lengthBars = 1;
    addAutomationCurve(s, 'fx.reverb.wet', laneIds);
    removeAutomationCurve(s, 'fx.reverb.wet', laneIds);
    expect(s.globalAutomation.length).toBe(0);
  });
});
