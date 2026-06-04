// src/export/scene-restart.test.ts
import { describe, it, expect } from 'vitest';
import { restartSoundingLanesForExport } from './scene-restart';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';

function clip(id: string): SessionClip {
  return { id, lengthBars: 2, notes: [] };
}

describe('restartSoundingLanesForExport', () => {
  it('queues each sounding lane to restart at startTime and returns their ids', () => {
    const states = new Map<string, LanePlayState>();
    const a = emptyLanePlayState('a'); a.playing = clip('ca');
    const b = emptyLanePlayState('b'); b.playing = clip('cb');
    const idle = emptyLanePlayState('idle'); // playing = null
    states.set('a', a); states.set('b', b); states.set('idle', idle);

    const sounding = restartSoundingLanesForExport(states, 12.5);

    expect(sounding.sort()).toEqual(['a', 'b']);
    expect(a.queued).toBe(a.playing);
    expect(a.queuedBoundary).toBe(12.5);
    expect(b.queued).toBe(b.playing);
    expect(b.queuedBoundary).toBe(12.5);
    // Idle lane untouched.
    expect(idle.queued).toBeNull();
  });

  it('returns an empty list when nothing is playing', () => {
    const states = new Map<string, LanePlayState>();
    states.set('a', emptyLanePlayState('a'));
    expect(restartSoundingLanesForExport(states, 5)).toEqual([]);
  });
});
