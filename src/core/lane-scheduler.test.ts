import { describe, it, expect } from 'vitest';
import { tickLane, type SchedulerContext } from './lane-scheduler';
import type { SessionClip } from '../session/session';
import { TICKS_PER_STEP } from './notes';

describe('lane-scheduler tickLane regression: overlapping windows', () => {
  it('a single note fires EXACTLY ONCE per loop iteration when tick=25ms, lookahead=120ms', () => {
    // Real app uses 25ms tick + 120ms lookahead → each tick's window
    // overlaps the previous by ~95ms. Without per-tick dedupe, every note
    // inside the overlap region fires once per overlapping window — i.e.
    // ~4-5× per loop iteration, which sounds like audio choppy / stuttering.
    const clip: SessionClip = {
      id: 'c1',
      lengthBars: 1,
      notes: [{ start: 0, duration: TICKS_PER_STEP, midi: 60, velocity: 100 }],
    };
    const triggered: Array<{ time: number }> = [];
    let loopStart = 0;
    let lastScheduledAt = -Infinity;
    for (let now = 0; now < 4.0; now += 0.025) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.12, now, loopStartedAt: loopStart,
        lastScheduledAt,
        onTrigger: (_n, t) => {
          triggered.push({ time: t });
          if (t > lastScheduledAt) lastScheduledAt = t;
        },
        onAutomation: () => {},
      });
    }
    // 4 sec at 120 bpm with a 1-bar clip → 2 iterations within, plus the
    // 3rd iteration's note at t=4.0 is scheduled by the 120ms lookahead
    // from the last tick. So exactly 3 fires. Without the dedupe this is
    // ~11 fires (one per overlapping window). Times must be strictly
    // increasing and aligned to loop boundaries.
    expect(triggered).toHaveLength(3);
    expect(triggered[0].time).toBeCloseTo(0, 5);
    expect(triggered[1].time).toBeCloseTo(2, 5);
    expect(triggered[2].time).toBeCloseTo(4, 5);
  });
});

describe('lane-scheduler tickLane', () => {
  it('a 1-bar clip with one note fires 4 times across 4 bars (120 bpm)', () => {
    const clip: SessionClip = {
      id: 'c1',
      lengthBars: 1,
      notes: [{ start: 0, duration: TICKS_PER_STEP, midi: 60, velocity: 100 }],
    };
    const triggered: Array<{ midi: number; time: number }> = [];
    let loopStart = 0;
    for (let now = 0; now < 8.0; now += 0.2) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: loopStart,
        onTrigger: (n, t) => triggered.push({ midi: n.midi, time: t }),
        onAutomation: () => {},
      });
    }
    // 1 bar = 2 sec at 120 bpm → 4 loop iterations in 8 sec.
    expect(triggered).toHaveLength(4);
    expect(triggered[1].time - triggered[0].time).toBeCloseTo(2.0, 1);
  });

  it('two clips with lengths 1 and 4 loop independently', () => {
    const oneBar: SessionClip  = { id: 'a', lengthBars: 1, notes: [{ start: 0, duration: 10, midi: 60, velocity: 100 }] };
    const fourBar: SessionClip = { id: 'b', lengthBars: 4, notes: [{ start: 0, duration: 10, midi: 48, velocity: 100 }] };
    const fires: Array<{ midi: number }> = [];
    let lsA = 0, lsB = 0;
    for (let now = 0; now < 8.0; now += 0.2) {
      lsA = tickLane(oneBar,  { bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: lsA, onTrigger: (n) => fires.push({ midi: n.midi }), onAutomation: () => {} });
      lsB = tickLane(fourBar, { bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: lsB, onTrigger: (n) => fires.push({ midi: n.midi }), onAutomation: () => {} });
    }
    expect(fires.filter((f) => f.midi === 60).length).toBe(4);
    expect(fires.filter((f) => f.midi === 48).length).toBe(1);
  });

  it('a clip with multiple notes within one bar fires them all in order', () => {
    const clip: SessionClip = {
      id: 'multi',
      lengthBars: 1,
      notes: [
        { start: 0,                  duration: TICKS_PER_STEP / 2, midi: 60, velocity: 100 },
        { start: TICKS_PER_STEP * 4, duration: TICKS_PER_STEP / 2, midi: 64, velocity: 100 },
        { start: TICKS_PER_STEP * 8, duration: TICKS_PER_STEP / 2, midi: 67, velocity: 100 },
      ],
    };
    const fires: Array<{ midi: number; time: number }> = [];
    let loopStart = 0;
    for (let now = 0; now < 2.5; now += 0.2) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.25, now, loopStartedAt: loopStart,
        onTrigger: (n, t) => fires.push({ midi: n.midi, time: t }),
        onAutomation: () => {},
      });
    }
    expect(fires.length).toBeGreaterThanOrEqual(3);
    // First 3 fires should be 60 → 64 → 67 (the notes within the first bar).
    expect(fires.slice(0, 3).map((f) => f.midi)).toEqual([60, 64, 67]);
  });

  it('returns updated loopStartedAt after a loop iteration completes', () => {
    const clip: SessionClip = { id: 'l', lengthBars: 1, notes: [] };
    // After 2.5 seconds at 120 bpm (1 bar = 2 sec), one full iteration has completed,
    // so loopStartedAt should advance by 2.0 sec.
    const next = tickLane(clip, {
      bpm: 120, lookaheadSec: 0.2, now: 2.5, loopStartedAt: 0,
      onTrigger: () => {}, onAutomation: () => {},
    });
    expect(next).toBeCloseTo(2.0, 1);
  });

  it('does not fire notes outside the look-ahead window', () => {
    const clip: SessionClip = {
      id: 'gap',
      lengthBars: 1,
      notes: [
        { start: 0,                  duration: 10, midi: 60, velocity: 100 },
        { start: TICKS_PER_STEP * 8, duration: 10, midi: 64, velocity: 100 }, // middle of bar
      ],
    };
    const fires: Array<{ midi: number }> = [];
    // Tick ONCE at now=0 with a small look-ahead. Should fire only the first note.
    tickLane(clip, {
      bpm: 120, lookaheadSec: 0.05, now: 0, loopStartedAt: 0,
      onTrigger: (n) => fires.push({ midi: n.midi }), onAutomation: () => {},
    });
    expect(fires).toEqual([{ midi: 60 }]);
  });
});
