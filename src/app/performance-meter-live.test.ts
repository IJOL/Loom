// @vitest-environment jsdom
//
// The Meter selector lives in the ALWAYS-VISIBLE transport row, so it can be
// used while the user is sitting in Performance. Its handler (main.ts) writes
// seq.meter and nothing else — no view switch, so nothing that COPIES the meter
// ever gets told. A copy on the arrangement kept decoding the A-B bars in 4/4
// while sessionHost.setGlobalLoop handed the very same bar numbers to the
// session, which decoded them in 3/4: A at 4s against A at 3s, an 8s window
// against a 6s one, on the one region both views are supposed to share.
//
// Assertions are ratios against the core global-loop helper (the session side of
// the seam), never absolute seconds.

import { describe, it, expect, vi } from 'vitest';
import { createPerformanceFeature, type PerformanceFeature } from './performance-feature';
import { globalLoopIteration } from '../core/global-loop';
import type { TimeSignature } from '../core/meter';

const LOOP = { enabled: true, startBar: 2, endBar: 6 };

function makePf() {
  const ctx = { currentTime: 0 };
  // The one meter owner, exactly as main.ts sees it: the selector's handler
  // assigns seq.meter on this very object.
  const seq = {
    bpm: 120, meter: { num: 4, den: 4 } as TimeSignature,
    isPlaying: () => false, stop: vi.fn(), start: vi.fn(),
  };
  const sessionHost = {
    state: { lanes: [] }, laneStates: new Map(), deps: {},
    songAnchorSec: 0,
    setSongAnchor(sec: number) { this.songAnchorSec = sec; },
    globalLoopForUI() { return { enabled: false, startBar: 0, endBar: 0 }; },
    setGlobalLoop() { /* no active scene in this fixture */ },
  };
  const pf = createPerformanceFeature({
    ctx, seq, sessionHost,
    automationRegistry: new Map(),
    onRegisterKnob: () => { /* no-op */ },
  } as unknown as Parameters<typeof createPerformanceFeature>[0]);
  return { pf, ctx, seq };
}

/** Seed a take long enough to contain the A-B window under either meter. */
function seedTake(pf: PerformanceFeature): void {
  pf.setArrangement({
    bpm: 120, durationSec: 32, lengthBars: 8, lanes: [], globalAutomation: [],
    loopEnabled: LOOP.enabled, loopStartBar: LOOP.startBar, loopEndBar: LOOP.endBar,
  });
}

/** A (seconds into the song) and the window length, read back out of the REAL
 *  Performance playback path: Play seeks the clock to A, and the loop wrap
 *  advances the same clock by exactly one window. */
function perfWindowSec(pf: PerformanceFeature, ctx: { currentTime: number }) {
  ctx.currentTime = 0;
  pf.onPlay();
  const aSec = ctx.currentTime - pf.arrangementPlayState.startedAtCtx;
  const beforeWrap = pf.arrangementPlayState.startedAtCtx;
  ctx.currentTime = 1000;                    // far past B: the next tick wraps once
  pf.onLookahead(ctx.currentTime, 0.1);
  return { aSec, lenSec: pf.arrangementPlayState.startedAtCtx - beforeWrap };
}

describe('the Performance A-B window follows a meter change made from the transport', () => {
  it('measures the same seconds as the session global loop after the meter changes', () => {
    const { pf, ctx, seq } = makePf();
    pf.setMode('performance');               // the user is IN Performance
    seedTake(pf);

    // The transport's Meter selector fires: main.ts writes seq.meter, and that
    // is all it writes. No view switch, no re-entry into Performance.
    seq.meter = { num: 3, den: 4 };

    const perf = perfWindowSec(pf, ctx);
    const session = globalLoopIteration(0, 0, LOOP, seq.bpm, seq.meter);

    expect(perf.aSec / session.aSec, 'A lands on the same second').toBeCloseTo(1, 6);
    expect(perf.lenSec / session.lenSec, 'the window is the same length').toBeCloseTo(1, 6);
  });

  it('still agrees when the meter never changes (negative control)', () => {
    const { pf, ctx, seq } = makePf();
    pf.setMode('performance');
    seedTake(pf);

    const perf = perfWindowSec(pf, ctx);
    const session = globalLoopIteration(0, 0, LOOP, seq.bpm, seq.meter);

    expect(perf.aSec / session.aSec).toBeCloseTo(1, 6);
    expect(perf.lenSec / session.lenSec).toBeCloseTo(1, 6);
  });
});
