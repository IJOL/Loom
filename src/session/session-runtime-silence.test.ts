// src/session/session-runtime-silence.test.ts
// Every stop seam must BOTH clear scheduling state AND silence live voices.
// stopLane / stopAll take an optional silencer (the live-voice registry) and
// invoke it so the audio-channel clip stops the instant the user hits Stop.

import { describe, it, expect, vi } from 'vitest';
import {
  stopLane, stopAll, emptyLanePlayState, type LanePlayState,
} from './session-runtime';
import type { SessionClip } from './session';

function laneStatesWith(...laneIds: string[]): Map<string, LanePlayState> {
  const m = new Map<string, LanePlayState>();
  for (const id of laneIds) {
    const lp = emptyLanePlayState(id);
    lp.playing = { id: `clip-${id}`, lengthBars: 1, notes: [] } as SessionClip;
    m.set(id, lp);
  }
  return m;
}

describe('stopLane silences live voices', () => {
  it('clears scheduling state AND calls the silencer for that lane', () => {
    const laneStates = laneStatesWith('audio-1');
    const silenceLane = vi.fn();
    const lp = laneStates.get('audio-1')!;

    stopLane(laneStates, 'audio-1', { silence: { silenceLane }, nowCtx: 2.5 });

    expect(lp.playing).toBeNull();
    expect(lp.queued).toBeNull();
    expect(silenceLane).toHaveBeenCalledWith('audio-1', 2.5);
  });

  it('still works when no silencer is provided (back-compat)', () => {
    const laneStates = laneStatesWith('audio-1');
    expect(() => stopLane(laneStates, 'audio-1')).not.toThrow();
    expect(laneStates.get('audio-1')!.playing).toBeNull();
  });
});

describe('stopAll silences live voices', () => {
  it('clears every lane AND silences all live voices', () => {
    const laneStates = laneStatesWith('audio-1', 'sub-2');
    const silenceAll = vi.fn();

    stopAll(laneStates, { silenceAll }, 4);

    for (const lp of laneStates.values()) {
      expect(lp.playing).toBeNull();
      expect(lp.queued).toBeNull();
    }
    expect(silenceAll).toHaveBeenCalledWith(4);
  });

  it('still works when no silencer is provided (back-compat)', () => {
    const laneStates = laneStatesWith('audio-1');
    expect(() => stopAll(laneStates)).not.toThrow();
    expect(laneStates.get('audio-1')!.playing).toBeNull();
  });
});
