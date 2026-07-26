// @vitest-environment jsdom
//
// 9360d29 removed the take's cached METER but left its bpm copied, naming
// `arrangement.bpm || seq.bpm` as the guard that covers a missing one. That
// guard was written in performance-feature.ts (the tick tempo, the playhead's
// bar) and nowhere else: arrangement-ops.ts sizes a bar from `s.bpm` raw, and so
// every helper built on it — effectiveDurationSec, arrangementLoopWindowSec,
// setArrangementLengthBars, addAutomationCurve — measured a different bar than
// the playhead the moment the field went falsy. Two sites guarded, five did not
// (onMoveBand/onResizeBand in the guarding file among them).
//
// A falsy bpm makes a bar Infinity seconds long, which collapses the A-B window
// to `active: false` (end <= start), so Play ignores the loop and starts at the
// top while the automation sampler still runs at seq.bpm. The take is restored
// through `setArrangement`, which is the same door the save loader knocks on
// (saved-state-v3 → deps.setArrangement) and the undo stack's restore path.
//
// NOTE on reachability: a save that simply OMITS bpm does NOT land here —
// setArrangement's Object.assign leaves the live value in place. It takes an
// explicit falsy bpm in the JSON, which parseSavedStateV3 does not validate.
//
// Assertions are ratios against the core global-loop helper, never absolute
// seconds — the same seam performance-meter-live.test.ts measures against.

import { describe, it, expect, vi } from 'vitest';
import { createPerformanceFeature, type PerformanceFeature } from './performance-feature';
import { globalLoopIteration } from '../core/global-loop';
import { arrangementLoopWindowSec } from '../performance/arrangement-ops';
import type { TimeSignature } from '../core/meter';
import type { ArrangementState } from '../performance/performance';

const LOOP = { enabled: true, startBar: 2, endBar: 6 };

function makePf() {
  const ctx = { currentTime: 0 };
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

/** A take as a save hands it back: long enough to contain the A-B window, with
 *  whatever tempo the file carried. */
function restoreTake(pf: PerformanceFeature, bpm: number): void {
  pf.setArrangement({
    bpm, durationSec: 32, lengthBars: 8, lanes: [], globalAutomation: [],
    loopEnabled: LOOP.enabled, loopStartBar: LOOP.startBar, loopEndBar: LOOP.endBar,
  } as ArrangementState);
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

describe('a restored take with no usable tempo still measures one bar', () => {
  it('plays the A-B window it carries instead of collapsing it', () => {
    const { pf, ctx, seq } = makePf();
    pf.setMode('performance');
    restoreTake(pf, 0);                       // the file carried a falsy bpm

    const perf = perfWindowSec(pf, ctx);
    const session = globalLoopIteration(0, 0, LOOP, seq.bpm, seq.meter);

    expect(perf.aSec / session.aSec, 'A lands on the same second').toBeCloseTo(1, 6);
    expect(perf.lenSec / session.lenSec, 'the window is the same length').toBeCloseTo(1, 6);
  });

  it('sizes a bar the same way for the pure helpers as for the playhead', () => {
    // The disagreement itself: arrangement-ops sizes the window from the stored
    // bpm, the playhead and the tick sized it from the guarded one. Same take,
    // same meter — the two must land on the same window.
    const { pf, ctx, seq } = makePf();
    pf.setMode('performance');
    restoreTake(pf, 0);

    const ops = arrangementLoopWindowSec(pf.arrangement, seq.meter);
    const perf = perfWindowSec(pf, ctx);

    expect(ops.active, 'the window is a real one').toBe(true);
    expect(ops.startSec / perf.aSec).toBeCloseTo(1, 6);
    expect((ops.endSec - ops.startSec) / perf.lenSec).toBeCloseTo(1, 6);
  });

  it('keeps the tempo the take was recorded at when it has one (negative control)', () => {
    // The take's own bpm is NOT derived from the sequencer: an automation curve
    // is stored per step, so its seconds belong to the tempo it was recorded at.
    // Restoring a 90-BPM take into a 120-BPM session must leave it at 90.
    const { pf, seq } = makePf();
    restoreTake(pf, seq.bpm * 0.75);

    expect(pf.arrangement.bpm / seq.bpm).toBeCloseTo(0.75, 6);
  });
});
