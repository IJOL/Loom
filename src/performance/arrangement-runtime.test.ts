import { describe, it, expect } from 'vitest';
import {
  createArrangementPlayState, startArrangement, stopArrangement,
  overrideLane, backToArrangement, isLaneOverridden,
  tickArrangement,
} from './arrangement-runtime';
import { emptyArrangementState } from './performance';
import { appendClipEvent, closePendingClipEvent, writeAutomationSample } from './arrangement-ops';

describe('ArrangementPlayState lifecycle', () => {
  it('createArrangementPlayState returns isPlaying=false and no overrides', () => {
    const ps = createArrangementPlayState();
    expect(ps.isPlaying).toBe(false);
    expect(ps.laneOverridden.size).toBe(0);
    expect(ps.nextEventIdxPerLane.size).toBe(0);
  });

  it('startArrangement sets isPlaying and remembers startedAtCtx', () => {
    const ps = createArrangementPlayState();
    startArrangement(ps, 42);
    expect(ps.isPlaying).toBe(true);
    expect(ps.startedAtCtx).toBe(42);
  });

  it('stopArrangement flips isPlaying and clears nextEventIdx', () => {
    const ps = createArrangementPlayState();
    startArrangement(ps, 0);
    ps.nextEventIdxPerLane.set('lane-a', 5);
    stopArrangement(ps);
    expect(ps.isPlaying).toBe(false);
    expect(ps.nextEventIdxPerLane.size).toBe(0);
  });

  it('overrideLane / backToArrangement toggle the per-lane flag', () => {
    const ps = createArrangementPlayState();
    overrideLane(ps, 'lane-a');
    expect(isLaneOverridden(ps, 'lane-a')).toBe(true);
    expect(isLaneOverridden(ps, 'lane-b')).toBe(false);
    backToArrangement(ps);
    expect(isLaneOverridden(ps, 'lane-a')).toBe(false);
  });
});

describe('tickArrangement', () => {
  it('emits launchClip when an event falls inside the lookahead window', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'tb-303-1', 'c1', 0.0);
    closePendingClipEvent(s, 'tb-303-1', 2.0);

    const ps = createArrangementPlayState();
    startArrangement(ps, /*nowCtx=*/100);

    const launches: string[] = [];
    const stops: string[] = [];
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: (laneId, clipId) => launches.push(`${laneId}:${clipId}`),
      onStopLane: (laneId) => stops.push(laneId),
      applyAutomation: () => {},
    });
    expect(launches).toEqual(['tb-303-1:c1']);
  });

  it('emits stopLane when untilSec falls inside the lookahead window', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'tb-303-1', 'c1', 0.0);
    closePendingClipEvent(s, 'tb-303-1', 0.05);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);

    const stops: string[] = [];
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: () => {},
      onStopLane: (laneId) => stops.push(laneId),
      applyAutomation: () => {},
    });
    expect(stops).toEqual(['tb-303-1']);
  });

  it('skips lanes that are overridden', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'tb-303-1', 'c1', 0.0);
    closePendingClipEvent(s, 'tb-303-1', 2.0);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);
    overrideLane(ps, 'tb-303-1');

    const launches: string[] = [];
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: (laneId, clipId) => launches.push(`${laneId}:${clipId}`),
      onStopLane: () => {},
      applyAutomation: () => {},
    });
    expect(launches).toEqual([]);
  });

  it('applies global automation samples', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'fx.reverb.wet', 0.7, 0, []);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);

    const applied: Record<string, number> = {};
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: () => {},
      onStopLane: () => {},
      applyAutomation: (id, v) => { applied[id] = v; },
    });
    expect(applied['fx.reverb.wet']).toBe(0.7);
  });
});

describe('backToArrangement', () => {
  it('clears all overrides; tick resumes emitting from the current playhead position', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'tb-303-1', 'c1', 0.0);
    closePendingClipEvent(s, 'tb-303-1', 4.0);
    appendClipEvent(s, 'tb-303-1', 'c2', 4.0);
    closePendingClipEvent(s, 'tb-303-1', 8.0);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);
    overrideLane(ps, 'tb-303-1');

    let launches: string[] = [];
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: (laneId, clipId) => launches.push(`${laneId}:${clipId}`),
      onStopLane: () => {},
      applyAutomation: () => {},
    });
    expect(launches).toEqual([]);

    backToArrangement(ps);
    launches = [];
    tickArrangement({
      ps, state: s, nowCtx: 104, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: (laneId, clipId) => launches.push(`${laneId}:${clipId}`),
      onStopLane: () => {},
      applyAutomation: () => {},
    });
    expect(launches).toContain('tb-303-1:c2');
  });
});

describe('tickArrangement respects curve.enabled', () => {
  it('does not apply a disabled global automation curve', () => {
    const state = emptyArrangementState(120);
    state.durationSec = 4;
    state.globalAutomation.push({ paramId: 'fx.reverb.wet', values: [0.9, 0.9, 0.9, 0.9], enabled: false });
    const ps = createArrangementPlayState();
    startArrangement(ps, 0);
    const applied: string[] = [];
    tickArrangement({
      ps, state, nowCtx: 0.01, lookaheadSec: 0.1, bpm: 120,
      onLaunchClip: () => {}, onStopLane: () => {},
      applyAutomation: (id) => applied.push(id),
    });
    expect(applied).not.toContain('fx.reverb.wet');
  });
});

describe('tickArrangement song-end stop', () => {
  it('stops every lane and fires onArrangementEnd once when the playhead reaches endSec', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'l1', 'c1', 0); closePendingClipEvent(s, 'l1', 4);
    appendClipEvent(s, 'l2', 'd1', 0); closePendingClipEvent(s, 'l2', 4);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);

    const stops: string[] = [];
    let ended = 0;
    const tick = (nowCtx: number) => tickArrangement({
      ps, state: s, nowCtx, lookaheadSec: 0.12, bpm: 120,
      loopWindow: { startSec: 0, endSec: 4, active: false },
      onArrangementEnd: () => { ended++; },
      onLaunchClip: () => {}, onStopLane: (id) => stops.push(id), applyAutomation: () => {},
    });
    tick(101);     // tNow=1, nothing
    expect(ended).toBe(0);
    tick(104);     // tNow=4 reaches end
    expect(new Set(stops)).toEqual(new Set(['l1', 'l2']));
    expect(ended).toBe(1);
    tick(104.05);  // already ended ⇒ no repeat
    expect(ended).toBe(1);
  });
});

describe('tickArrangement A-B loop wrap', () => {
  it('re-anchors the clock and relaunches the active clip at A when crossing B', () => {
    const s = emptyArrangementState(120);
    // Lane has one long clip covering [0,8). Loop window A=2 B=6.
    appendClipEvent(s, 'l1', 'c1', 0); closePendingClipEvent(s, 'l1', 8);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);
    const lw = { startSec: 2, endSec: 6, active: true };

    const launches: Array<{ id: string; at: number }> = [];
    const stops: string[] = [];
    const tick = (nowCtx: number) => tickArrangement({
      ps, state: s, nowCtx, lookaheadSec: 0.12, bpm: 120, loopWindow: lw,
      onLaunchClip: (_l, id, at) => launches.push({ id, at }),
      onStopLane: (id) => stops.push(id), applyAutomation: () => {},
    });

    tick(100);   // tNow=0: launches c1 at start
    expect(launches.map((l) => l.id)).toEqual(['c1']);
    const startedBefore = ps.startedAtCtx;
    tick(106);   // tNow=6 reaches B ⇒ wrap
    expect(stops).toContain('l1');               // stop scheduled at B
    expect(ps.startedAtCtx).toBeCloseTo(startedBefore + (lw.endSec - lw.startSec), 5); // re-anchored by period (4)
    // After the wrap the active clip is relaunched so A keeps sounding.
    expect(launches.length).toBeGreaterThanOrEqual(2);
    expect(launches[launches.length - 1].id).toBe('c1');
    expect(ps.ended).toBe(false); // loop never "ends"
  });
});
