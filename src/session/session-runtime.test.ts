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
  seekSession,
  tickGlobalLoop,
  emptyLanePlayState,
  type LanePlayState,
} from './session-runtime';
import type { SessionState, SessionClip, SessionScene, ClipSample } from './session';
import { TICKS_PER_STEP, TICKS_PER_QUARTER } from '../core/notes';

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
    it('gates a one-beat note for exactly one beat (TICKS_PER_QUARTER grid)', () => {
      // Note durations live on the TICKS_PER_QUARTER (96) grid, same as note
      // starts (meter.ts). A one-beat note (96 ticks) must gate for one beat =
      // 60/bpm seconds. Asserting the musical intent — a beat — rather than the
      // implementation formula, so a tick→seconds unit regression is caught
      // (the old test mirrored the buggy /TICKS_PER_STEP divisor and so was
      // tautological: it produced a 4×-too-long gate yet still "passed").
      const oneBeatTicks = TICKS_PER_QUARTER;
      const expectedGate = 60 / BPM; // one beat in seconds

      const clip: SessionClip = {
        id: 'g1', lengthBars: 1,
        notes: [{ midi: 55, start: 0, duration: oneBeatTicks, velocity: 80 }],
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

    it('gates an audio-loop clip for its full length (round-trips through secPerTick)', () => {
      // The sample-clip path in tickLane encodes the clip's duration in ticks
      // specifically so it round-trips back to the full clip length through
      // secPerTick. This pins that coupling: the tick→seconds unit and the
      // sample-clip duration formula must change together or loops shorten.
      const BARS = 2;
      const sample: ClipSample = { sampleId: 'smp-1', mode: 'loop', trimStart: 0, trimEnd: 1 };
      const clip: SessionClip = { id: 'loopc', lengthBars: BARS, notes: [], sample };
      const state: SessionState = {
        lanes: [{ id: 'll', engineId: 'sampler', clips: [clip] }],
        scenes: [],
        globalQuantize: 'immediate',
      };
      const lp: LanePlayState = { ...emptyLanePlayState('ll'), playing: clip, startTime: 0, loopStartedAt: 0 };
      const laneStates = new Map([['ll', lp]]);

      const gates: number[] = [];
      tickSession(laneStates, state, 0, LOOK, BPM,
        (_id, _midi, _t, gate) => gates.push(gate),
        () => {},
      );

      expect(gates).toHaveLength(1);
      expect(gates[0]).toBeCloseTo(BARS * SEC_PER_BAR, 5);
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

describe('tickSession — swing', () => {
  /** One lane, one on-beat + one off-beat 16th, driven at the given swing. */
  function run(swing: number | undefined): Array<{ midi: number; at: number }> {
    const clip: SessionClip = {
      id: 'sw', lengthBars: 1,
      notes: [
        { midi: 60, start: 0,              duration: TICKS_PER_STEP, velocity: 80 },
        { midi: 62, start: TICKS_PER_STEP, duration: TICKS_PER_STEP, velocity: 80 },
      ],
    };
    const state: SessionState = {
      lanes: [{ id: 'l', engineId: 'subtractive', clips: [clip] }],
      scenes: [], globalQuantize: 'immediate',
    };
    const laneStates = new Map<string, LanePlayState>([
      ['l', { ...emptyLanePlayState('l'), playing: clip, startTime: 0, loopStartedAt: 0 }],
    ]);
    const fired: Array<{ midi: number; at: number }> = [];
    for (let t = 0; t < SEC_PER_BAR; t += TICK) {
      tickSession(
        laneStates, state, t, LOOK, BPM,
        (_id, midi, scheduleTime) => fired.push({ midi, at: scheduleTime }),
        () => {},
        undefined, undefined, undefined, undefined, swing,
      );
    }
    return fired;
  }
  const timeOf = (fired: Array<{ midi: number; at: number }>, midi: number) =>
    fired.find((f) => f.midi === midi)!.at;

  it('carries the transport swing down to the lane scheduler', () => {
    const straight = run(0);
    const swung = run(0.5);
    expect(timeOf(swung, 60)).toBe(timeOf(straight, 60));            // on-beat: fixed
    expect(timeOf(swung, 62)).toBeGreaterThan(timeOf(straight, 62)); // off-beat: delayed
  });

  it('swing 0 fires exactly what the transport fires today', () => {
    expect(run(0)).toEqual(run(undefined));
  });
});

describe('seekSession', () => {
  function clip(lengthBars: number): SessionClip {
    return { id: 'c', lengthBars, notes: [] } as SessionClip;
  }

  it('re-anchors a playing lane to the target phase and resets lastScheduledAt', () => {
    const lp = emptyLanePlayState('lane1');
    lp.playing = clip(1);            // 1 bar @120bpm 4/4 = 2s loop
    lp.loopStartedAt = 0; lp.startTime = 0; lp.lastScheduledAt = 12345;
    const states = new Map([['lane1', lp]]);
    // seek to song-second 5 → phase = 5 mod 2 = 1 → anchor = now(100) - 1 = 99
    seekSession(states, 5, 100, 120);
    expect(lp.loopStartedAt).toBeCloseTo(99, 6);
    expect(lp.startTime).toBeCloseTo(99, 6);
    expect(lp.lastScheduledAt).toBe(-Infinity);
  });

  it('leaves idle lanes untouched', () => {
    const lp = emptyLanePlayState('lane1');
    lp.playing = null; lp.loopStartedAt = 42;
    const states = new Map([['lane1', lp]]);
    seekSession(states, 5, 100, 120);
    expect(lp.loopStartedAt).toBe(42);
  });

  it('calls silence.silenceAll(now) once', () => {
    const lp = emptyLanePlayState('lane1'); lp.playing = clip(2);
    const states = new Map([['lane1', lp]]);
    let called = -1;
    seekSession(states, 5, 100, 120, undefined, { silenceAll: (t) => { called = t; } });
    expect(called).toBe(100);
  });
});

describe('seekSession onAudioRetrigger', () => {
  // At BPM=120, 4/4: 1 bar = 2s, 2 bars = 4s
  const CLIP_DUR_SEC = 2; // 1-bar clip

  it('fires onAudioRetrigger for an audio lane (clip with sample) with correct phaseSec and time', () => {
    const sample: ClipSample = { sampleId: 's1', mode: 'loop', trimStart: 0, trimEnd: 1 };
    const lp = emptyLanePlayState('audio-lane');
    lp.playing = { id: 'ac', lengthBars: 1, notes: [], sample } as SessionClip;
    lp.loopStartedAt = 0; lp.startTime = 0; lp.lastScheduledAt = 0;
    const states = new Map([['audio-lane', lp]]);

    // seek to targetSongSec = 3.0: phase = ((3 % 2) + 2) % 2 = 1.0; now = 100
    const calls: Array<{ laneId: string; phaseSec: number; sample: ClipSample; time: number }> = [];
    seekSession(states, 3.0, 100, BPM, undefined, undefined,
      (laneId, phaseSec, s, time) => calls.push({ laneId, phaseSec, sample: s, time }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].laneId).toBe('audio-lane');
    expect(calls[0].phaseSec).toBeCloseTo(((3.0 % CLIP_DUR_SEC) + CLIP_DUR_SEC) % CLIP_DUR_SEC, 6);
    expect(calls[0].sample).toBe(sample);
    // Fix 2: time arg must equal `now` for the seek case
    expect(calls[0].time).toBe(100);
  });

  it('does NOT fire onAudioRetrigger for a note lane (clip without sample)', () => {
    const lp = emptyLanePlayState('note-lane');
    lp.playing = { id: 'nc', lengthBars: 1, notes: [] } as SessionClip;
    lp.loopStartedAt = 0; lp.startTime = 0; lp.lastScheduledAt = 0;
    const states = new Map([['note-lane', lp]]);

    const calls: unknown[] = [];
    seekSession(states, 3.0, 100, BPM, undefined, undefined,
      () => calls.push(1),
    );

    expect(calls).toHaveLength(0);
  });

  it('does NOT fire for idle lanes', () => {
    const lp = emptyLanePlayState('idle-lane');
    lp.playing = null;
    const states = new Map([['idle-lane', lp]]);

    const calls: unknown[] = [];
    seekSession(states, 3.0, 100, BPM, undefined, undefined,
      () => calls.push(1),
    );

    expect(calls).toHaveLength(0);
  });
});

describe('seekSession silence-before-retrigger ordering (Fix 1)', () => {
  it('calls silenceAll BEFORE onAudioRetrigger', () => {
    const sample: ClipSample = { sampleId: 'ord', mode: 'loop', trimStart: 0, trimEnd: 1 };
    const lp = emptyLanePlayState('ord-lane');
    lp.playing = { id: 'oc', lengthBars: 1, notes: [], sample } as SessionClip;
    lp.loopStartedAt = 0; lp.startTime = 0; lp.lastScheduledAt = 0;
    const states = new Map([['ord-lane', lp]]);

    const order: string[] = [];
    seekSession(
      states, 1.0, 50, BPM, undefined,
      { silenceAll: (_t) => order.push('silence') },
      (_laneId, _phaseSec, _s, _time) => order.push('retrigger'),
    );

    expect(order).toEqual(['silence', 'retrigger']);
  });
});

describe('tickGlobalLoop', () => {
  function lane(lengthBars: number, loopStartedAt: number) {
    const lp = emptyLanePlayState('L');
    lp.playing = { id: 'c', lengthBars, notes: [] } as any;
    lp.loopStartedAt = loopStartedAt; lp.startTime = loopStartedAt; lp.lastScheduledAt = 999;
    return lp;
  }
  const scene = { globalLoopEnabled: true, globalLoopStartBar: 0, globalLoopEndBar: 2 }; // 2 bars = 4s @120

  it('re-anchors all lanes to bar A when a new global iteration begins', () => {
    const lp = lane(4, 0);
    const states = new Map([['L', lp]]);
    const gl = { anchorSec: 0, lastIter: 0 };
    // now=4.0 → iter 1 begins at 4.0; re-anchor lane to A(=0): anchor = 4 - (0 mod clipDur)
    tickGlobalLoop(states, scene, gl, 4.0, 0.2, 120);
    expect(gl.lastIter).toBe(1);
    expect(lp.loopStartedAt).toBeCloseTo(4.0, 6);  // A=0 → phase 0 → anchor = iterStart
    expect(lp.lastScheduledAt).toBe(-Infinity);
  });

  it('does nothing within the same iteration', () => {
    const lp = lane(4, 0);
    const states = new Map([['L', lp]]);
    const gl = { anchorSec: 0, lastIter: 0 };
    tickGlobalLoop(states, scene, gl, 1.0, 0.2, 120); // still iter 0
    expect(gl.lastIter).toBe(0);
    expect(lp.loopStartedAt).toBe(0); // untouched
  });

  it('is a no-op when the scene loop is disabled', () => {
    const lp = lane(4, 7);
    const states = new Map([['L', lp]]);
    const gl = { anchorSec: 0, lastIter: 0 };
    tickGlobalLoop(states, { }, gl, 100, 0.2, 120);
    expect(lp.loopStartedAt).toBe(7);
  });

  // ── Bug regression: old setGlobalLoop reset anchor to `now` + lastIter=0 ──
  // After a mid-playback region edit the loop clock must re-anchor within one
  // loop length, not stall forever.  The bug was: resetting glState to
  // { anchorSec: now, lastIter: 0 } means iter = floor((now - now)/lenSec) = 0,
  // so the guard `iter <= lastIter` (0 <= 0) fires on EVERY tick until a full
  // loop length elapses from the reset point — effectively the new region is
  // never applied mid-loop.
  //
  // The fix: setGlobalLoop no longer touches glState at all; instead a separate
  // applyGlobalLoopNow() call (on commit / toggle-ON) uses seekToBar to re-phase
  // glState correctly, so the next tickGlobalLoop sees iter > lastIter immediately.
  describe('glState phasing: stale reset vs correct phase', () => {
    // Scenario: loop [A=2, B=4] (2 bars = 4 s @120 BPM), playback is well into
    // bar 3 (now = 7 s).  The user edits the region; we want the next tick to
    // re-anchor.
    const editScene = { globalLoopEnabled: true, globalLoopStartBar: 2, globalLoopEndBar: 4 };
    // @120 BPM, 4/4: 1 bar = 2 s, loop len = 4 s, A = 4 s
    const BPM_TEST = 120;
    const BAR_SEC = 2;
    const LOOP_LEN = 4; // (endBar - startBar) * barSec

    it('stalls when glState is reset to { anchorSec: now, lastIter: 0 } (old bug)', () => {
      // Simulate what the old setGlobalLoop did: reset at the moment of the edit.
      const now = 7.0;
      // OLD buggy reset — anchor = now, lastIter = 0
      const gl = { anchorSec: now, lastIter: 0 };
      const lp = lane(4, 0);
      const states = new Map([['L', lp]]);
      const origLoopStartedAt = lp.loopStartedAt;

      // Tick at "now + small lookahead": iter = floor((7.2 - 7.0) / 4) = 0
      // iter(0) <= lastIter(0) → STALLS, no re-anchor
      tickGlobalLoop(states, editScene, gl, now, 0.2, BPM_TEST);
      // Expect: nothing changed (stalled)
      expect(gl.lastIter).toBe(0);
      expect(lp.loopStartedAt).toBe(origLoopStartedAt);
    });

    it('re-anchors immediately when glState is correctly phased (new behaviour)', () => {
      // Correct phasing: seekToBar(startBar=2) sets
      //   glState.anchorSec = songAnchorSec + startBar * barSec
      // and lastIter = current iter at that moment.
      // Concretely: songAnchorSec=0, startBar=2, so anchor = 0 + 2*2 = 4.
      // At now=7.0: iter = floor((7.0 - 4.0) / 4.0) = floor(0.75) = 0.
      // lastIter is also set to 0 by seekToBar at that moment.
      // Next tick at now=4.0+4.0=8.0 (iter 1): iter(1) > lastIter(0) → fires.
      //
      // But more immediately: if the seek happens RIGHT at a boundary the tick
      // fires on the very next call.  Let's use now = A + LOOP_LEN = 4+4 = 8:
      const songAnchorSec = 0;
      const startBar = 2;
      const anchorSec = songAnchorSec + startBar * BAR_SEC; // = 4
      // Compute iter at the time of the seek (now=7): floor((7-4)/4)=0
      const iterAtSeek = Math.floor((7.0 - anchorSec) / LOOP_LEN); // = 0
      const gl = { anchorSec, lastIter: iterAtSeek };

      const lp = lane(4, 0);
      const states = new Map([['L', lp]]);

      // Tick at now=8.0 (= anchor + 1*LOOP_LEN): iter = floor((8-4)/4) = 1 > 0 → fires
      tickGlobalLoop(states, editScene, gl, 8.0, 0.2, BPM_TEST);
      expect(gl.lastIter).toBe(1);
      // Lane was re-anchored (loopStartedAt changed from original 0)
      expect(lp.loopStartedAt).not.toBe(0);
      expect(lp.lastScheduledAt).toBe(-Infinity);
    });
  });
});

// ── Global-loop uniform per-clip region (new behaviour) ────────────────────
// These tests pin the FIX: when a scene has globalLoopEnabled, every lane
// should start at bar A and loop [A,B) — regardless of local loop settings.

describe('global-loop uniform per-clip region', () => {
  // @120 BPM 4/4: 1 bar = 2s, 1 tick_per_bar = 384 ticks (TICKS_PER_QUARTER=96, 4/4)
  // A=2, B=4 → global region [2 bars, 4 bars) → [768ticks, 1536ticks) → 2 bars = 4s
  const BPM_GL = 120;
  const LOOK_GL = 0.2;
  const TICK_GL = LOOK_GL;
  const SEC_PER_BAR_GL = (60 / BPM_GL) * 4; // 2s

  // A 4-bar clip with ONE note at bar 2 (tick 768) and one at bar 0 (tick 0)
  // When global loop [2,4] is active, only the note at bar 2 should fire,
  // and it should fire at the launch boundary (not 2 bars after boundary).
  function makeGlobalLoopScene() {
    // Two lanes:
    // Lane A: 4-bar clip, no local loop, note at tick 0 (bar 0) and tick 768 (bar 2)
    // Lane B: 4-bar clip, local loop at [0, 384) (bar 0–1), note at tick 0
    // With globalLoop [2,4]: both should use region [768,1536), note at tick 0 is
    // outside → doesn't fire; note at tick 768 fires at launch boundary.
    const TICKS_PER_BAR = 384; // TICKS_PER_QUARTER(96) * 4 beats = 384
    const noteAtBar0 = { midi: 60, start: 0, duration: 23, velocity: 80 };
    const noteAtBar2 = { midi: 62, start: TICKS_PER_BAR * 2, duration: 23, velocity: 80 };
    const clipA: SessionClip = {
      id: 'gl-a', lengthBars: 4,
      notes: [noteAtBar0, noteAtBar2],
      // no local loop
    };
    const clipB: SessionClip = {
      id: 'gl-b', lengthBars: 4,
      notes: [noteAtBar0],
      // local loop at bar [0,1) — global loop MUST override this
      loopEnabled: true,
      loopStartTick: 0,
      loopEndTick: TICKS_PER_BAR, // bar 0-1 only
    };
    const scene: SessionScene = {
      id: 's1', name: 'Test', clipPerLane: {},
      globalLoopEnabled: true,
      globalLoopStartBar: 2,
      globalLoopEndBar: 4,
    };
    const state: SessionState = {
      lanes: [
        { id: 'gl-lane-a', engineId: 'subtractive', clips: [clipA] },
        { id: 'gl-lane-b', engineId: 'subtractive', clips: [clipB] },
      ],
      scenes: [scene],
      globalQuantize: 'immediate',
    };
    const boundary = 10; // arbitrary launch boundary
    const laneStates = new Map<string, LanePlayState>([
      ['gl-lane-a', {
        ...emptyLanePlayState('gl-lane-a'),
        playing: clipA,
        startTime: boundary,
        loopStartedAt: boundary,
        lastScheduledAt: -Infinity,
      }],
      ['gl-lane-b', {
        ...emptyLanePlayState('gl-lane-b'),
        playing: clipB,
        startTime: boundary,
        loopStartedAt: boundary,
        lastScheduledAt: -Infinity,
      }],
    ]);
    return { state, laneStates, clipA, clipB, scene, boundary };
  }

  it('lane with NO local loop: first note fires at bar A (boundary), not bar 0 (regression test)', () => {
    // TODAY: clipA has notes at tick 0 and tick 768.
    // Without globalLoop fix, effectiveClipLoop returns [0, 1536), so note at tick 0
    // fires at boundary (t=10). With globalLoop [2,4], ONLY note at tick 768 should
    // fire, and it fires at boundary+0 = 10 (since 768 is the START of the [768,1536) region).
    const { state, laneStates, boundary } = makeGlobalLoopScene();
    const scene = state.scenes[0];
    const fired: Array<{ laneId: string; midi: number; scheduleTime: number }> = [];

    // Run one loop period = 4s (2 bars at [A=2,B=4]) after the boundary
    for (let t = boundary; t < boundary + 4 * SEC_PER_BAR_GL + TICK_GL; t += TICK_GL) {
      tickSession(
        laneStates, state, t, LOOK_GL, BPM_GL,
        (laneId, midi, scheduleTime) => fired.push({ laneId, midi, scheduleTime }),
        () => {},
        undefined, undefined, undefined,
        scene,
      );
    }

    const laneAFires = fired.filter((f) => f.laneId === 'gl-lane-a');
    // Only midi=62 (at bar 2 = tick 768) should fire.
    // midi=60 (tick 0, bar 0) is OUTSIDE [A=2,B=4) and must NOT fire.
    const bar0Fires = laneAFires.filter((f) => f.midi === 60);
    const bar2Fires = laneAFires.filter((f) => f.midi === 62);
    expect(bar0Fires).toHaveLength(0); // tick 0 is outside global region [A=2,B=4)
    // bar2 note fires at the launch boundary (it's at the START of the region)
    expect(bar2Fires.length).toBeGreaterThan(0);
    expect(bar2Fires[0].scheduleTime).toBeCloseTo(boundary, 5);
  });

  it('lane with LOCAL loop [0,1bar]: global loop [2,4] overrides it — note at bar 0 must NOT fire', () => {
    // Lane B has a local loop [0,384) but the global loop [2,4] = [768,1536) overrides.
    // The only note in clipB is at tick 0 (bar 0), which is outside [768,1536).
    // So NO notes should fire for lane B when the global loop is active.
    const { state, laneStates, boundary } = makeGlobalLoopScene();
    const scene = state.scenes[0];
    const fired: Array<{ laneId: string; midi: number; scheduleTime: number }> = [];

    for (let t = boundary; t < boundary + 4 * SEC_PER_BAR_GL + TICK_GL; t += TICK_GL) {
      tickSession(
        laneStates, state, t, LOOK_GL, BPM_GL,
        (laneId, midi, scheduleTime) => fired.push({ laneId, midi, scheduleTime }),
        () => {},
        undefined, undefined, undefined,
        scene,
      );
    }

    const laneBFires = fired.filter((f) => f.laneId === 'gl-lane-b');
    // tick 0 is outside [768,1536); no notes should fire
    expect(laneBFires).toHaveLength(0);
  });

  it('regression: NO global loop → laneLoopRegion === effectiveClipLoop, both lanes start at bar 0', () => {
    // Lane A with no local loop → whole clip [0,4bar)
    // Lane B with local loop [0,1bar)
    // NO globalLoop → behaviour identical to before
    const TICKS_PER_BAR = 384;
    const clipA: SessionClip = {
      id: 'reg-a', lengthBars: 4,
      notes: [{ midi: 60, start: 0, duration: 23, velocity: 80 }],
    };
    const clipB: SessionClip = {
      id: 'reg-b', lengthBars: 4,
      notes: [{ midi: 62, start: 0, duration: 23, velocity: 80 }],
      loopEnabled: true,
      loopStartTick: 0,
      loopEndTick: TICKS_PER_BAR, // 1 bar
    };
    const state: SessionState = {
      lanes: [
        { id: 'reg-lane-a', engineId: 'subtractive', clips: [clipA] },
        { id: 'reg-lane-b', engineId: 'subtractive', clips: [clipB] },
      ],
      scenes: [], // no scene = no global loop
      globalQuantize: 'immediate',
    };
    const boundary = 0;
    const laneStates = new Map<string, LanePlayState>([
      ['reg-lane-a', {
        ...emptyLanePlayState('reg-lane-a'),
        playing: clipA, startTime: boundary, loopStartedAt: boundary, lastScheduledAt: -Infinity,
      }],
      ['reg-lane-b', {
        ...emptyLanePlayState('reg-lane-b'),
        playing: clipB, startTime: boundary, loopStartedAt: boundary, lastScheduledAt: -Infinity,
      }],
    ]);
    const fired: Array<{ laneId: string; midi: number; scheduleTime: number }> = [];
    // Run just under 4 bars = 8s: laneA fires once (4-bar clip at t=0 only),
    // laneB fires 4× in 8s (1-bar local loop, wrapping).
    // Using 4 bars * 2s/bar = 8s total, stop just before to avoid catching t=8.
    const runSec = 4 * SEC_PER_BAR_GL - TICK_GL; // 7.8s
    for (let t = 0; t < runSec; t += TICK_GL) {
      tickSession(
        laneStates, state, t, LOOK_GL, BPM_GL,
        (laneId, midi, scheduleTime) => fired.push({ laneId, midi, scheduleTime }),
        () => {},
        // No scene passed — no global loop
      );
    }
    const laneAFires = fired.filter((f) => f.laneId === 'reg-lane-a');
    const laneBFires = fired.filter((f) => f.laneId === 'reg-lane-b');
    // No global loop: laneA uses whole clip [0,4bar) = 8s → fires once at t=0
    expect(laneAFires).toHaveLength(1);
    expect(laneAFires[0].scheduleTime).toBeCloseTo(0, 5);
    // laneB uses local loop [0,1bar) = 2s → fires 4× in 7.8s (t=0,2,4,6)
    expect(laneBFires).toHaveLength(4);
  });
})
