// Clip-envelope automation must land WITHOUT requestAnimationFrame.
//
// The browser stops rAF dead when the tab is hidden or the window is covered.
// The sequencer's clock is a Worker precisely so playback survives that, and
// the LFOs live in the worklet — but envelope landing ran on the rAF loop, so
// losing focus froze every automated knob at its last value and let it jump
// on return. The envelopes ride the sequencer's tick now; rAF only paints.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Sequencer } from '../core/sequencer';
import { emptyClip } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';
import { startAutomationTick, type AutomationTickDeps } from './automation-tick';

const fakeCtx = () =>
  ({ currentTime: 0, state: 'running', resume: () => Promise.resolve() } as unknown as AudioContext);

/** A lane playing one clip whose envelope holds `value` everywhere. */
function playingLane(paramId: string, value: number): LanePlayState {
  const clip = emptyClip(1);
  clip.envelopes = [{ paramId, values: Array.from({ length: 64 }, () => value), enabled: true, stepped: false }];
  return {
    laneId: 'lane1', playing: clip, queued: null, queuedBoundary: 0, queuedStop: null,
    startTime: 0, nextStepIdx: 0, loopCount: 0,
  } as unknown as LanePlayState;
}

describe('automation tick: envelopes land off the sequencer clock, not rAF', () => {
  let rafCalls = 0;
  let stop: (() => void) | undefined;
  const savedRaf = globalThis.requestAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCalls = 0;
    // A hidden tab: rAF is requested and never fires.
    globalThis.requestAnimationFrame = (() => { rafCalls++; return 0; }) as typeof requestAnimationFrame;
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    globalThis.requestAnimationFrame = savedRaf;
  });

  it('a playing clip envelope reaches its target while rAF never fires', () => {
    const seq = new Sequencer(fakeCtx(), 32);
    seq.sessionTick = () => { /* no note scheduling needed */ };
    const landed: Array<[string, number]> = [];
    const deps: AutomationTickDeps = {
      seq,
      automationRegistry: new Map(),     // nothing mounted ⇒ the unmounted path
      getLaneStates: () => new Map([['lane1', playingLane('lane1.filter.cutoff', 0.8)]]),
      applyUnmounted: (id, v) => landed.push([id, v]),
      getTargetRanges: () => new Map([['lane1.filter.cutoff', { min: 0, max: 1 }]]),
    };
    stop = startAutomationTick(deps);
    seq.start();
    vi.advanceTimersByTime(100);   // ~4 sequencer ticks
    seq.stop();

    expect(rafCalls).toBeGreaterThan(0);   // the ring painter still asked for frames…
    expect(landed.length).toBeGreaterThan(0);   // …and the envelope landed regardless
    for (const [id, v] of landed) {
      expect(id).toBe('lane1.filter.cutoff');
      expect(v).toBeCloseTo(0.8);
    }
  });

  it('nothing lands while the transport is stopped', () => {
    const seq = new Sequencer(fakeCtx(), 32);
    const landed: number[] = [];
    stop = startAutomationTick({
      seq, automationRegistry: new Map(),
      getLaneStates: () => new Map([['lane1', playingLane('lane1.x', 0.2)]]),
      applyUnmounted: (_id, v) => landed.push(v),
      getTargetRanges: () => new Map([['lane1.x', { min: 0, max: 1 }]]),
    });
    vi.advanceTimersByTime(100);
    expect(landed).toEqual([]);
  });
});
