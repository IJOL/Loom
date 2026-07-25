// src/export/scene-duration.test.ts
import { describe, it, expect } from 'vitest';
import { clipDurationSec, soundingSceneDurationSec } from './scene-duration';
import { clipLoopSec } from '../core/launch-timing';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER, ticksPerBar, type TimeSignature } from '../core/meter';

function clip(lengthBars: number): SessionClip {
  return { color: '#f4c8a8', gridResolution: '1/16', id: `c${lengthBars}`, lengthBars, notes: [] };
}

/** A clip whose loop sub-region spans the first `loopBars` bars. */
function loopClip(lengthBars: number, loopBars: number): SessionClip {
  return { color: '#f4e0a8', gridResolution: '1/16',
    id: `loop${lengthBars}-${loopBars}`,
    lengthBars,
    notes: [],
    loopEnabled: true,
    loopStartTick: 0,
    loopEndTick: loopBars * ticksPerBar(DEFAULT_METER),
  };
}

function playing(laneId: string, c: SessionClip): LanePlayState {
  const lp = emptyLanePlayState(laneId);
  lp.playing = c;
  return lp;
}

describe('clipDurationSec', () => {
  it('is lengthBars * quartersPerBar * 60/bpm (4/4 @120 → 2s per bar)', () => {
    // 4/4: quartersPerBar = 4; 60/120 = 0.5s/beat; 1 bar = 4*0.5 = 2s.
    expect(clipDurationSec(clip(1), DEFAULT_METER, 120)).toBeCloseTo(2, 6);
    expect(clipDurationSec(clip(2), DEFAULT_METER, 120)).toBeCloseTo(4, 6);
  });

  it('scales inversely with bpm', () => {
    const slow = clipDurationSec(clip(1), DEFAULT_METER, 60);
    const fast = clipDurationSec(clip(1), DEFAULT_METER, 120);
    expect(slow).toBeCloseTo(fast * 2, 6);
  });

  it('respects an active loop sub-region instead of the whole clip', () => {
    // A long audio clip (8 bars) looping only its first 2 bars must report the
    // LOOP length (2 bars = 4s @120 4/4), not the whole-clip length (8 bars =
    // 16s) — otherwise the offline render window blows up to the full buffer
    // and hangs the browser.
    expect(clipDurationSec(loopClip(8, 2), DEFAULT_METER, 120)).toBeCloseTo(4, 6);
  });

  it('a tempo-mapped clip reports a longer window than its constant-bpm length', () => {
    // An imported MIDI that halves its tempo half way. The export renders two
    // cycles and returns the second, so this window IS the period the scheduler
    // loops on — a constant-bpm answer makes the "second cycle" not a cycle, and
    // the WAV starts mid-phrase.
    const BAR = ticksPerBar(DEFAULT_METER);
    const mapped: SessionClip = { ...clip(4), id: 'tm',
      tempoMap: [{ tick: 0, bpm: 120 }, { tick: 2 * BAR, bpm: 60 }] };
    const ratio = clipDurationSec(mapped, DEFAULT_METER, 120)
      / clipDurationSec(clip(4), DEFAULT_METER, 120);
    expect(ratio).toBeGreaterThan(1);
  });

  it('agrees with clipLoopSec, the owner it delegates to', () => {
    // The two take bpm and meter in OPPOSITE order, so the delegation is one
    // swap away from plausible-looking wrong seconds. Pinned with a meter that
    // is not 4/4 and a bpm that is not 120, where a swap changes the answer.
    const meter: TimeSignature = { num: 7, den: 8 };
    expect(clipDurationSec(clip(3), meter, 90) / clipLoopSec(clip(3), 90, meter)).toBeCloseTo(1, 9);
  });
});

describe('soundingSceneDurationSec', () => {
  it('returns 0 when nothing is playing', () => {
    const states = new Map<string, LanePlayState>();
    states.set('a', emptyLanePlayState('a')); // playing = null
    expect(soundingSceneDurationSec(states, DEFAULT_METER, 120)).toBe(0);
  });

  it('returns the longest sounding clip duration', () => {
    const states = new Map<string, LanePlayState>();
    states.set('drums', playing('drums', clip(2)));
    states.set('bass', playing('bass', clip(4)));
    states.set('idle', emptyLanePlayState('idle'));
    // longest = 4 bars @120 4/4 = 8s.
    expect(soundingSceneDurationSec(states, DEFAULT_METER, 120)).toBeCloseTo(8, 6);
  });

  it('the LONGEST EFFECTIVE LOOP drives the window, not a long clip buffer', () => {
    // A very long audio clip (100 bars) that loops only its first 4 bars must
    // contribute its LOOP length (4 bars = 8s), so it does not balloon the
    // render window to 200s and hang. A shorter 2-bar clip just loops to fill.
    const states = new Map<string, LanePlayState>();
    states.set('audio', playing('audio', loopClip(100, 4)));
    states.set('bass', playing('bass', clip(2)));
    expect(soundingSceneDurationSec(states, DEFAULT_METER, 120)).toBeCloseTo(8, 6);
  });
});
