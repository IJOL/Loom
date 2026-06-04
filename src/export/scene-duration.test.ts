// src/export/scene-duration.test.ts
import { describe, it, expect } from 'vitest';
import { clipDurationSec, soundingSceneDurationSec } from './scene-duration';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from '../core/meter';

function clip(lengthBars: number): SessionClip {
  return { id: `c${lengthBars}`, lengthBars, notes: [] };
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
});
