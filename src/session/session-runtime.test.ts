// Unit tests for the note-based tickSession scheduler (Phase D.3).
// Drives the transport loop with a fake clock and asserts that per-lane
// independent clip loops fire the correct number of times.
//
// Transport harness design note: tickLane fires every note whose schedule
// time falls in [now - DRIFT, now + lookahead - DRIFT).  To prevent
// double-firing, the tick interval must equal the lookahead window so that
// consecutive calls produce non-overlapping windows.  This matches the
// existing lane-scheduler.test.ts convention.

import { describe, it, expect } from 'vitest';
import {
  tickSession,
  emptyLanePlayState,
  type LanePlayState,
} from './session-runtime';
import type { SessionState, SessionClip } from './session';
import { TICKS_PER_STEP } from '../core/notes';

// ── Constants ─────────────────────────────────────────────────────────────

const BPM = 120;
// Tick interval MUST equal LOOK so consecutive windows are exactly adjacent.
const LOOK = 0.2;
const TICK = LOOK; // non-overlapping windows → no double-fires
// At 120 BPM: 1 bar = 4 beats × (60/120) s/beat = 2 s
const SEC_PER_BAR = (60 / BPM) * 4;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal SessionState with two lanes.
 * Each lane gets a single clip whose `lengthBars` is configurable.
 * Each clip has exactly ONE note at tick 0 so it fires once per loop.
 */
function makeTwoLaneState(
  lane1Bars: number,
  lane2Bars: number,
): { state: SessionState; laneStates: Map<string, LanePlayState>; clipA: SessionClip; clipB: SessionClip } {
  const noteA = { midi: 60, start: 0, duration: TICKS_PER_STEP - 1, velocity: 80 };
  const noteB = { midi: 62, start: 0, duration: TICKS_PER_STEP - 1, velocity: 80 };

  const clipA: SessionClip = { id: 'clip-a', lengthBars: lane1Bars, notes: [noteA] };
  const clipB: SessionClip = { id: 'clip-b', lengthBars: lane2Bars, notes: [noteB] };

  const state: SessionState = {
    lanes: [
      { id: 'lane-1', engineId: 'subtractive', clips: [clipA] },
      { id: 'lane-2', engineId: 'subtractive', clips: [clipB] },
    ],
    scenes: [],
    globalQuantize: 'immediate',
  };

  const laneStates = new Map<string, LanePlayState>([
    ['lane-1', { ...emptyLanePlayState('lane-1'), playing: clipA, startTime: 0, loopStartedAt: 0 }],
    ['lane-2', { ...emptyLanePlayState('lane-2'), playing: clipB, startTime: 0, loopStartedAt: 0 }],
  ]);

  return { state, laneStates, clipA, clipB };
}

/**
 * Simulate the transport by calling tickSession repeatedly.
 * The tick interval equals LOOK so windows are non-overlapping (no double-fires).
 * Runs from t=0 to t < endTime.
 */
function runTransport(
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  endTime: number,
): Array<{ laneId: string; midi: number; scheduleTime: number }> {
  const fired: Array<{ laneId: string; midi: number; scheduleTime: number }> = [];

  for (let t = 0; t < endTime; t += TICK) {
    tickSession(
      laneStates, state, t, LOOK, BPM,
      (laneId, midi, scheduleTime, _gate, _accent, _slide) => {
        fired.push({ laneId, midi, scheduleTime });
      },
      () => { /* ignore step-fired callbacks in this test */ },
    );
  }
  return fired;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('tickSession (note-based, Phase D.3)', () => {
  describe('independent clip loop counts', () => {
    it('fires a 1-bar clip 4× and a 4-bar clip 1× over 4 bars', () => {
      const { state, laneStates } = makeTwoLaneState(1, 4);
      // Run for exactly 4 bars.  Notes at t=0,2,4,6 fall inside [0,8).
      const endTime = 4 * SEC_PER_BAR; // 8 s
      const fired = runTransport(state, laneStates, endTime);

      const lane1Fires = fired.filter((f) => f.laneId === 'lane-1');
      const lane2Fires = fired.filter((f) => f.laneId === 'lane-2');

      // 1-bar clip loops 4 times → note fires 4×
      expect(lane1Fires).toHaveLength(4);
      // 4-bar clip loops once → note fires 1×
      expect(lane2Fires).toHaveLength(1);
    });

    it('fires a 2-bar clip 4× and an 8-bar clip 1× over 8 bars', () => {
      const { state, laneStates } = makeTwoLaneState(2, 8);
      // Stop clearly between the 4th fire (t=12) and the 5th (t=16) to avoid
      // float drift pushing t just past 15.999... into a window that includes t=16.
      const endTime = 8 * SEC_PER_BAR - TICK; // 15.8 s — last window ends at 16.0 - DRIFT
      const fired = runTransport(state, laneStates, endTime);

      const lane1Fires = fired.filter((f) => f.laneId === 'lane-1');
      const lane2Fires = fired.filter((f) => f.laneId === 'lane-2');

      expect(lane1Fires).toHaveLength(4);
      expect(lane2Fires).toHaveLength(1);
    });
  });

  describe('note schedule times', () => {
    it('fires lane-1 notes at integer bar boundaries (1-bar clip)', () => {
      const { state, laneStates } = makeTwoLaneState(1, 4);
      const endTime = 4 * SEC_PER_BAR;
      const fired = runTransport(state, laneStates, endTime);
      const lane1Fires = fired.filter((f) => f.laneId === 'lane-1');

      // 1-bar clip at 120 BPM → notes at 0, 2, 4, 6 seconds
      expect(lane1Fires).toHaveLength(4);
      for (let i = 0; i < 4; i++) {
        const expected = i * SEC_PER_BAR;
        expect(lane1Fires[i].scheduleTime).toBeCloseTo(expected, 5);
      }
    });

    it('fires lane-2 note at t=0 only (4-bar clip over 4 bars)', () => {
      const { state, laneStates } = makeTwoLaneState(1, 4);
      const endTime = 4 * SEC_PER_BAR;
      const fired = runTransport(state, laneStates, endTime);
      const lane2Fires = fired.filter((f) => f.laneId === 'lane-2');

      expect(lane2Fires).toHaveLength(1);
      expect(lane2Fires[0].scheduleTime).toBeCloseTo(0, 5);
    });
  });

  describe('queue promotion', () => {
    it('promotes a queued clip and starts firing once the boundary is reached', () => {
      const clipA: SessionClip = {
        id: 'qa', lengthBars: 1,
        notes: [{ midi: 48, start: 0, duration: 23, velocity: 80 }],
      };
      const state: SessionState = {
        lanes: [{ id: 'ql', engineId: 'subtractive', clips: [clipA] }],
        scenes: [],
        globalQuantize: 'immediate',
      };
      const lp = emptyLanePlayState('ql');
      // Queue the clip to start at t=0.5 (boundary)
      lp.queued = clipA;
      lp.queuedBoundary = 0.5;
      const laneStates = new Map([['ql', lp]]);

      const fired: Array<{ laneId: string; midi: number; scheduleTime: number }> = [];
      // Tick before boundary (now=0, look window [0, 0.2)): should not fire
      tickSession(laneStates, state, 0, LOOK, BPM,
        (id, midi, t) => fired.push({ laneId: id, midi, scheduleTime: t }),
        () => {},
      );
      expect(fired).toHaveLength(0);

      // Tick that crosses boundary: now=0.4, window [0.4, 0.6) includes boundary 0.5
      // Clip promoted; note at clip-tick 0 scheduled at t=0.5
      tickSession(laneStates, state, 0.4, LOOK, BPM,
        (id, midi, t) => fired.push({ laneId: id, midi, scheduleTime: t }),
        () => {},
      );
      expect(fired).toHaveLength(1);
      expect(fired[0].scheduleTime).toBeCloseTo(0.5, 5);
    });

    it('does not fire before the queued boundary', () => {
      const clipA: SessionClip = {
        id: 'qb', lengthBars: 1,
        notes: [{ midi: 48, start: 0, duration: 23, velocity: 80 }],
      };
      const state: SessionState = {
        lanes: [{ id: 'ql2', engineId: 'subtractive', clips: [clipA] }],
        scenes: [],
        globalQuantize: 'immediate',
      };
      const lp = emptyLanePlayState('ql2');
      lp.queued = clipA;
      lp.queuedBoundary = 5.0; // far in the future
      const laneStates = new Map([['ql2', lp]]);

      const fired: unknown[] = [];
      for (let t = 0; t < 4.0; t += TICK) {
        tickSession(laneStates, state, t, LOOK, BPM,
          () => fired.push(1),
          () => {},
        );
      }
      expect(fired).toHaveLength(0);
    });
  });

  describe('gate duration', () => {
    it('converts note.duration ticks to seconds correctly', () => {
      // At 120 BPM: secPerTick = (60/120)/24 = 0.020833... s
      const SEC_PER_TICK = (60 / BPM) / TICKS_PER_STEP;
      const noteDurTicks = 20;
      const expectedGate = noteDurTicks * SEC_PER_TICK;

      const clip: SessionClip = {
        id: 'g1', lengthBars: 1,
        notes: [{ midi: 55, start: 0, duration: noteDurTicks, velocity: 80 }],
      };
      const state: SessionState = {
        lanes: [{ id: 'gl', engineId: 'subtractive', clips: [clip] }],
        scenes: [],
        globalQuantize: 'immediate',
      };
      const lp: LanePlayState = { ...emptyLanePlayState('gl'), playing: clip, startTime: 0, loopStartedAt: 0 };
      const laneStates = new Map([['gl', lp]]);

      const gates: number[] = [];
      tickSession(laneStates, state, 0, LOOK, BPM,
        (_id, _midi, _t, gate) => gates.push(gate),
        () => {},
      );

      expect(gates).toHaveLength(1);
      expect(gates[0]).toBeCloseTo(expectedGate, 5);
    });

    it('clamps gate duration to at least 0.01 s for zero-duration notes', () => {
      const clip: SessionClip = {
        id: 'g2', lengthBars: 1,
        notes: [{ midi: 55, start: 0, duration: 0, velocity: 80 }],
      };
      const state: SessionState = {
        lanes: [{ id: 'gl2', engineId: 'subtractive', clips: [clip] }],
        scenes: [],
        globalQuantize: 'immediate',
      };
      const lp: LanePlayState = { ...emptyLanePlayState('gl2'), playing: clip, startTime: 0, loopStartedAt: 0 };
      const laneStates = new Map([['gl2', lp]]);

      const gates: number[] = [];
      tickSession(laneStates, state, 0, LOOK, BPM,
        (_id, _midi, _t, gate) => gates.push(gate),
        () => {},
      );

      expect(gates).toHaveLength(1);
      expect(gates[0]).toBeGreaterThanOrEqual(0.01);
    });
  });

  describe('TB-303 slide detection', () => {
    it('sets slidingIn=true when a prior note overlaps the current note start', () => {
      // Prior note starts at tick 0, ends at tick 26 (> tick 24+1 = slide threshold).
      // Current note starts at tick 24.  Their overlap signals slide INTO the second note.
      // The condition is (prior.start + prior.duration) > thisNote.start + 1
      //   = 0 + 26 > 24 + 1 = 26 > 25 → true.
      //
      // At 120 BPM with TICKS_PER_STEP=24:
      //   note at tick 0  → scheduleTime = 0.000 s
      //   note at tick 24 → scheduleTime = 0.500 s
      // These land in different 0.2 s windows, so we run enough ticks to catch both.
      const clip: SessionClip = {
        id: 'sl1', lengthBars: 1,
        notes: [
          { midi: 48, start: 0,  duration: 26, velocity: 80 }, // slide-out note (ends at tick 26 > 25)
          { midi: 50, start: 24, duration: 20, velocity: 80 }, // slide-in note
        ],
      };
      const state: SessionState = {
        lanes: [{ id: 'sl', engineId: 'tb303', clips: [clip] }],
        scenes: [],
        globalQuantize: 'immediate',
      };
      const lp: LanePlayState = { ...emptyLanePlayState('sl'), playing: clip, startTime: 0, loopStartedAt: 0 };
      const laneStates = new Map([['sl', lp]]);

      const results: Array<{ midi: number; slidingIn: boolean }> = [];
      // Run enough ticks to cover at least 0.6 s (tick 24 fires at 0.5 s, in window [0.4, 0.6))
      for (let t = 0; t < 0.6; t += TICK) {
        tickSession(laneStates, state, t, LOOK, BPM,
          (_id, midi, _t, _gate, _accent, slidingIn) => results.push({ midi, slidingIn }),
          () => {},
        );
      }

      const slideTarget = results.find((r) => r.midi === 50);
      expect(slideTarget).toBeDefined();
      expect(slideTarget!.slidingIn).toBe(true);

      const slideSource = results.find((r) => r.midi === 48);
      expect(slideSource).toBeDefined();
      expect(slideSource!.slidingIn).toBe(false);
    });

    it('does NOT set slidingIn for non-tb303 engines even when notes overlap', () => {
      const clip: SessionClip = {
        id: 'sl2', lengthBars: 1,
        notes: [
          { midi: 48, start: 0,  duration: 26, velocity: 80 },
          { midi: 50, start: 24, duration: 20, velocity: 80 },
        ],
      };
      const state: SessionState = {
        lanes: [{ id: 'sl2', engineId: 'subtractive', clips: [clip] }],
        scenes: [],
        globalQuantize: 'immediate',
      };
      const lp: LanePlayState = { ...emptyLanePlayState('sl2'), playing: clip, startTime: 0, loopStartedAt: 0 };
      const laneStates = new Map([['sl2', lp]]);

      const results: Array<{ midi: number; slidingIn: boolean }> = [];
      // Run enough ticks to capture both notes
      for (let t = 0; t < 0.6; t += TICK) {
        tickSession(laneStates, state, t, LOOK, BPM,
          (_id, midi, _t, _gate, _accent, slidingIn) => results.push({ midi, slidingIn }),
          () => {},
        );
      }

      for (const r of results) {
        expect(r.slidingIn).toBe(false);
      }
    });
  });

  describe('idle lanes', () => {
    it('does not fire when no clip is playing and none is queued', () => {
      const state: SessionState = {
        lanes: [{ id: 'idle', engineId: 'subtractive', clips: [] }],
        scenes: [],
        globalQuantize: 'immediate',
      };
      const laneStates = new Map([['idle', emptyLanePlayState('idle')]]);
      const fired: unknown[] = [];
      tickSession(laneStates, state, 0, LOOK, BPM,
        () => fired.push(1),
        () => {},
      );
      expect(fired).toHaveLength(0);
    });
  });

  describe('accent detection', () => {
    it('marks accent=true for notes with velocity >= 100', () => {
      const clip: SessionClip = {
        id: 'ac1', lengthBars: 1,
        notes: [
          { midi: 60, start: 0, duration: 20, velocity: 115 }, // accent
          { midi: 62, start: TICKS_PER_STEP, duration: 20, velocity: 80 }, // no accent
        ],
      };
      const state: SessionState = {
        lanes: [{ id: 'ac', engineId: 'subtractive', clips: [clip] }],
        scenes: [],
        globalQuantize: 'immediate',
      };
      const lp: LanePlayState = { ...emptyLanePlayState('ac'), playing: clip, startTime: 0, loopStartedAt: 0 };
      const laneStates = new Map([['ac', lp]]);

      const results: Array<{ midi: number; accent: boolean }> = [];
      // Run 2 ticks to capture both notes (note at step 1 = tick 24 might be just outside first window)
      for (let t = 0; t < 2 * LOOK; t += TICK) {
        tickSession(laneStates, state, t, LOOK, BPM,
          (_id, midi, _t, _gate, accent) => results.push({ midi, accent }),
          () => {},
        );
      }

      const accented = results.find((r) => r.midi === 60);
      const notAccented = results.find((r) => r.midi === 62);
      expect(accented).toBeDefined();
      expect(accented!.accent).toBe(true);
      expect(notAccented).toBeDefined();
      expect(notAccented!.accent).toBe(false);
    });
  });
});
