import { describe, it, expect } from 'vitest';
import { tickLane, noteTrigger, type SchedulerContext } from './lane-scheduler';
import type { SessionClip } from '../session/session';
import { TICKS_PER_STEP, TICKS_PER_QUARTER } from './notes';
import { ticksPerBar, DEFAULT_METER } from './meter';

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

  it('a 7/8 clip loops at 7/8 the duration of a 4/4 clip (120 bpm)', () => {
    const clip: SessionClip = {
      id: '78', lengthBars: 1,
      notes: [{ start: 0, duration: TICKS_PER_STEP, midi: 60, velocity: 100 }],
    };
    const fires: number[] = [];
    let loopStart = 0;
    for (let now = 0; now < 4.0; now += 0.2) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: loopStart,
        meter: { num: 7, den: 8 },
        onTrigger: (_n, t) => fires.push(t),
        onAutomation: () => {},
      });
    }
    // 1 bar of 7/8 at 120 bpm = 7 eighth-notes; an eighth = (60/120)/2 = 0.25 s
    // → 1.75 s per loop (vs 2.0 s in 4/4).
    expect(fires[1] - fires[0]).toBeCloseTo(1.75, 2);
  });
});

describe('lane-scheduler tickLane — audio (loop/song) clips', () => {
  it('a loop clip fires exactly one trigger per iteration carrying the sample', () => {
    const clip: SessionClip = {
      id: 'c1', lengthBars: 1, notes: [],
      sample: { sampleId: 's1', mode: 'loop', trimStart: 0, trimEnd: 1 },
    };
    const fires: Array<{ time: number; sampleId?: string; duration: number; midi: number }> = [];
    let loopStart = 0;
    for (let now = 0; now < 8.0; now += 0.2) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: loopStart,
        onTrigger: (n, t) => fires.push({ time: t, sampleId: n.sample?.sampleId, duration: n.duration, midi: n.midi }),
        onAutomation: () => {},
      });
    }
    // 1-bar clip = 2s at 120bpm → 4 iterations in 8s, one trigger each.
    expect(fires).toHaveLength(4);
    for (const f of fires) {
      expect(f.sampleId).toBe('s1');
      expect(f.midi).toBe(60);
      // The synthetic buffer trigger is gated to the FULL clip length, encoded
      // in TICKS_PER_QUARTER ticks (= lengthBars × ticksPerBar) so it round-
      // trips back to clipDurSec through the runtime's secPerTick.
      expect(f.duration).toBe(ticksPerBar(DEFAULT_METER) * clip.lengthBars);
    }
    expect(fires[0].time).toBeCloseTo(0, 5);
    expect(fires[1].time).toBeCloseTo(2, 5);
  });

  it('a clip with a sample ignores its notes (only the synthetic buffer trigger fires)', () => {
    const clip: SessionClip = {
      id: 'c2', lengthBars: 1,
      notes: [
        { start: 0, duration: TICKS_PER_STEP, midi: 64, velocity: 80 },
        { start: TICKS_PER_STEP, duration: TICKS_PER_STEP, midi: 67, velocity: 80 },
      ],
      sample: { sampleId: 's2', mode: 'song', trimStart: 0, trimEnd: 1 },
    };
    const midis: number[] = [];
    let loopStart = 0;
    for (let now = 0; now < 2.0; now += 0.2) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: loopStart,
        onTrigger: (n) => midis.push(n.midi),
        onAutomation: () => {},
      });
    }
    // Never fires the 64/67 notes — only the synthetic sample trigger (midi 60).
    expect(midis.length).toBeGreaterThan(0);
    expect(midis.every((m) => m === 60)).toBe(true);
  });
});

describe('noteTrigger — velocity', () => {
  it('noteTrigger carries the note velocity through', () => {
    const clip = { lengthBars: 1, notes: [] } as never;
    const t = noteTrigger('poly', clip, { midi: 60, duration: 24, velocity: 73 }, 0, 0, 120, undefined);
    expect(t.velocity).toBe(73);
    expect(t.accent).toBe(false); // 73 < 100
  });
});

describe('lane-scheduler tickLane — clip loop sub-region', () => {
  const bar = ticksPerBar(DEFAULT_METER); // 384

  it('loops only bars 2-3 of a 4-bar clip; period = 2 bars; outside notes never fire', () => {
    const clip: SessionClip = {
      id: 'sub', lengthBars: 4,
      loopEnabled: true, loopStartTick: bar, loopEndTick: 3 * bar,
      notes: [
        { start: 0,        duration: 10, midi: 36, velocity: 100 }, // bar 1 — outside
        { start: bar,      duration: 10, midi: 48, velocity: 100 }, // bar 2 — inside (at region start)
        { start: 2 * bar,  duration: 10, midi: 50, velocity: 100 }, // bar 3 — inside
        { start: 3 * bar,  duration: 10, midi: 60, velocity: 100 }, // bar 4 — outside
      ],
    };
    const fires: Array<{ midi: number; time: number }> = [];
    let loopStart = 0, last = -Infinity;
    // 2 bars at 120 bpm = 4 sec. Run 8 sec ⇒ 2 full iterations.
    for (let now = 0; now < 8.0; now += 0.025) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.12, now, loopStartedAt: loopStart, lastScheduledAt: last,
        onTrigger: (n, t) => { fires.push({ midi: n.midi, time: t }); if (t > last) last = t; },
        onAutomation: () => {},
      });
    }
    expect(fires.some((f) => f.midi === 36 || f.midi === 60)).toBe(false); // outside never fires
    const midis = fires.map((f) => f.midi);
    // Midi 48 fires at t=0, t=4, and t=8 (lookahead from last tick peeks into 3rd iteration start).
    // Midi 50 fires at t=2 and t=6 only (t=10 is beyond the 8-sec window).
    expect(midis.filter((m) => m === 48).length).toBe(3);
    expect(midis.filter((m) => m === 50).length).toBe(2);
    // region-start note is repositioned to the iteration start (t≈0, 4, 8)
    const m48 = fires.filter((f) => f.midi === 48).map((f) => f.time);
    expect(m48[0]).toBeCloseTo(0, 5);
    expect(m48[1]).toBeCloseTo(4, 5);
  });

  it('loop off is byte-for-byte the current behaviour (no regression)', () => {
    const clip: SessionClip = { id: 'whole', lengthBars: 1, notes: [{ start: 0, duration: TICKS_PER_STEP, midi: 60, velocity: 100 }] };
    const fires: number[] = [];
    let loopStart = 0;
    for (let now = 0; now < 8.0; now += 0.2) {
      loopStart = tickLane(clip, { bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: loopStart, onTrigger: (_n, t) => fires.push(t), onAutomation: () => {} });
    }
    expect(fires).toHaveLength(4); // identical to the existing 1-bar test
  });
});

describe('noteTrigger', () => {
  // Note durations live on the TICKS_PER_QUARTER (96) grid:
  //   1 quarter = 96 ticks = 60/bpm seconds at given bpm.
  // At 120 bpm: secPerTick = (60/120)/96 = 0.0052083...
  // note[0] start=0   ticks → scheduleTime = 0
  // note[1] start=24  ticks → scheduleTime = 24 * secPerTick = 0.125 s
  const BPM = 120;
  const SEC_PER_TICK = (60 / BPM) / TICKS_PER_QUARTER; // (60/120)/96
  const clip: SessionClip = {
    id: 'c', lengthBars: 1,
    notes: [
      { start: 0, duration: 48, midi: 36, velocity: 80 },
      { start: 24, duration: 12, midi: 38, velocity: 110 },
    ],
  };
  const note1Time = 24 * SEC_PER_TICK; // scheduleTime for note[1]

  it('marks accent when velocity >= 100', () => {
    const a = noteTrigger('tb303', clip, clip.notes[0], 0, 0, BPM, undefined);
    const b = noteTrigger('tb303', clip, clip.notes[1], note1Time, 0, BPM, undefined);
    expect(a.accent).toBe(false);
    expect(b.accent).toBe(true);
  });

  it('gateSec = duration * secPerTick(bpm) on TICKS_PER_QUARTER grid, floored at 0.01', () => {
    const a = noteTrigger('tb303', clip, clip.notes[0], 0, 0, BPM, undefined);
    expect(a.gateSec).toBeCloseTo(48 * SEC_PER_TICK, 6);
  });

  it('slidingIn only for tb303 when a prior note overlaps this start', () => {
    const bTb = noteTrigger('tb303', clip, clip.notes[1], note1Time, 0, BPM, undefined);
    const bSub = noteTrigger('subtractive', clip, clip.notes[1], note1Time, 0, BPM, undefined);
    expect(bTb.slidingIn).toBe(true);
    expect(bSub.slidingIn).toBe(false);
  });
});
