// src/core/scene-countdown.test.ts
import { describe, it, expect } from 'vitest';
import { sceneCountdown } from './scene-countdown';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from './meter';

// 120 bpm in 4/4 → one bar = 2 s. Every expectation below is derived from
// that, never from a bare magnitude.
const BPM = 120;
const BAR = 2;

function clip(id: string, lengthBars: number): SessionClip {
  return { color: '#a8c8e8', gridResolution: '1/16', id, lengthBars, notes: [] };
}

/** A lane playing a `bars`-long clip since `loopStartedAt`, optionally with a
 *  clip queued to land at `queuedAt`. */
function lane(
  id: string,
  opts: { playingBars?: number; loopStartedAt?: number; queuedAt?: number },
): LanePlayState {
  const lp: LanePlayState = { ...emptyLanePlayState(id) };
  if (opts.playingBars != null) {
    lp.playing = clip(`${id}-playing`, opts.playingBars);
    lp.loopStartedAt = opts.loopStartedAt ?? 0;
  }
  if (opts.queuedAt != null) {
    lp.queued = clip(`${id}-queued`, 1);
    lp.queuedBoundary = opts.queuedAt;
  }
  return lp;
}

function states(...lps: LanePlayState[]): Map<string, LanePlayState> {
  return new Map(lps.map((lp) => [lp.laneId, lp]));
}

const at = (m: Map<string, LanePlayState>, now: number) =>
  sceneCountdown(m, now, BPM, DEFAULT_METER);

describe('sceneCountdown', () => {
  it('reports silent when no lane is playing and nothing is queued', () => {
    const r = at(states(lane('A', {})), 0);
    expect(r.state).toBe('silent');
    expect(r.secsLeft).toBeNull();
    expect(r.centerText).toBe('');
  });

  it('idle: frac is the elapsed phase of the governing loop', () => {
    // 4-bar clip = 8 s, started at 0. At now = 2 s a quarter has elapsed.
    const m = states(lane('A', { playingBars: 4, loopStartedAt: 0 }));
    const r = at(m, 1 * BAR);
    expect(r.state).toBe('idle');
    expect(r.secsLeft).toBeNull();
    expect(r.bars).toBeCloseTo(4, 9);
    expect(r.frac).toBeCloseTo(0.25, 9);
    expect(r.centerText).toBe('2'); // second bar of four
  });

  it('idle: frac grows monotonically across the loop', () => {
    const m = states(lane('A', { playingBars: 4, loopStartedAt: 0 }));
    expect(at(m, 1 * BAR).frac).toBeLessThan(at(m, 3 * BAR).frac);
  });

  it('armed: two lanes queued to the same boundary count down together', () => {
    // Both lanes play a 4-bar loop from 0; the switch lands at 8 s.
    const m = states(
      lane('A', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }),
      lane('B', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }),
    );
    const early = at(m, 1 * BAR);
    const late = at(m, 3 * BAR);
    expect(early.state).toBe('armed');
    expect(early.secsLeft).toBeCloseTo(3 * BAR, 9);
    expect(late.frac).toBeLessThan(early.frac); // drains, not fills
    expect(early.centerText).toBe('3'); // three bars left
  });

  it('armed: a lone queued clip drives the ring just like a scene', () => {
    const m = states(
      lane('A', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }),
      lane('B', { playingBars: 4, loopStartedAt: 0 }),
    );
    const r = at(m, 1 * BAR);
    expect(r.state).toBe('armed');
    expect(r.secsLeft).toBeCloseTo(3 * BAR, 9);
  });

  it('armed: with several boundaries pending it reports the nearest', () => {
    const m = states(
      lane('A', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }),
      lane('B', { playingBars: 2, loopStartedAt: 0, queuedAt: 2 * BAR }),
    );
    expect(at(m, 1 * BAR).secsLeft).toBeCloseTo(1 * BAR, 9);
  });

  it('a lone long clip does not govern (the outlier rule holds)', () => {
    // 4, 4 and 32 bars playing: 32 > 2×4, so 4 bars governs.
    const m = states(
      lane('A', { playingBars: 4, loopStartedAt: 0 }),
      lane('B', { playingBars: 4, loopStartedAt: 0 }),
      lane('C', { playingBars: 32, loopStartedAt: 0 }),
    );
    expect(at(m, 1 * BAR).bars).toBeCloseTo(4, 9);
  });

  it('imminent: inside the last bar before the switch', () => {
    const m = states(lane('A', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }));
    const r = at(m, 3.5 * BAR); // 1 s left = half a bar
    expect(r.state).toBe('imminent');
    expect(r.centerText).toBe('2'); // half a bar = 2 beats in 4/4
  });

  it('cold start: queued with nothing playing spans one bar', () => {
    const m = states(lane('A', { queuedAt: 1 * BAR }));
    const r = at(m, 0.5 * BAR);
    expect(r.state).toBe('imminent'); // under a bar away
    expect(r.bars).toBeCloseTo(1, 9);
    expect(r.frac).toBeCloseTo(0.5, 9);
  });

  it('after the boundary is crossed the ring returns to idle', () => {
    // The scheduler promotes queued → playing and clears `queued`.
    const lp = lane('A', { playingBars: 4, loopStartedAt: 4 * BAR });
    const r = at(states(lp), 4 * BAR + 0.1);
    expect(r.state).toBe('idle');
    expect(r.secsLeft).toBeNull();
  });
});
