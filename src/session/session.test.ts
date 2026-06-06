import { describe, it, expect } from 'vitest';
import {
  audioClip, cloneSessionState,
  deleteClipAt, deleteLane, laneHasContent, sceneHasContent, deleteScene,
  type SessionState, type SessionLane, type SessionClip,
} from './session';

describe('audioClip', () => {
  it('carries clip.sample, empty notes, and derives lengthBars from duration/bpm', () => {
    // 4s at 120bpm: a bar = 4*60/120 = 2s → 4s ≈ 2 bars.
    const c = audioClip({ name: 'amen', sampleId: 'smp-1', durationSec: 4, bpm: 120 });
    expect(c.lengthBars).toBe(2);
    expect(c.notes).toEqual([]);
    expect(c.sample).toEqual({ sampleId: 'smp-1', mode: 'loop', trimStart: 0, trimEnd: 4 });
    expect(c.name).toBe('amen');
  });

  it('clamps lengthBars to at least 1 for short samples and honors mode', () => {
    const c = audioClip({ name: 'stab', sampleId: 'smp-2', durationSec: 0.2, bpm: 120, mode: 'song' });
    expect(c.lengthBars).toBe(1);
    expect(c.sample?.mode).toBe('song');
  });
});

describe('engineState.kitMode persistence', () => {
  it('round-trips kitMode through cloneSessionState', () => {
    const state = {
      lanes: [{ id: 'drums-1', engineId: 'drums-machine', clips: [], engineState: { kitMode: 'sample' as const } }],
      scenes: [],
      globalQuantize: 'immediate' as const,
    };
    const clone = cloneSessionState(state);
    expect(clone.lanes[0].engineState?.kitMode).toBe('sample');
  });
});

describe('deletion helpers (front A)', () => {
  const mkClip = (id: string): SessionClip => ({ id, lengthBars: 1, notes: [] });
  const mkLane = (id: string, clips: (SessionClip | null)[]): SessionLane =>
    ({ id, engineId: 'subtractive', clips });
  const mkState = (lanes: SessionLane[], scenes: SessionState['scenes']): SessionState =>
    ({ lanes, scenes, globalQuantize: '1/1' });

  it('deleteClipAt nulls the cell without splicing (idempotent)', () => {
    const lane = mkLane('L', [mkClip('A'), mkClip('B'), mkClip('C')]);
    deleteClipAt(lane, 1);
    expect(lane.clips[1]).toBeNull();
    expect(lane.clips[0]?.id).toBe('A');
    expect(lane.clips[2]?.id).toBe('C');
    expect(lane.clips.length).toBe(3);
    deleteClipAt(lane, 1);
    expect(lane.clips[1]).toBeNull();
  });

  it('deleteLane removes the lane and its clipPerLane references', () => {
    const state = mkState(
      [mkLane('L1', []), mkLane('L2', [])],
      [{ id: 's', name: 'S', clipPerLane: { L1: 0, L2: 1 } }],
    );
    deleteLane(state, 'L2');
    expect(state.lanes.map((l) => l.id)).toEqual(['L1']);
    expect(state.scenes[0].clipPerLane).toEqual({ L1: 0 });
    deleteLane(state, 'nope');
    expect(state.lanes.length).toBe(1);
  });

  it('laneHasContent reflects presence of any clip', () => {
    expect(laneHasContent(mkLane('a', []))).toBe(false);
    expect(laneHasContent(mkLane('a', [null, null]))).toBe(false);
    expect(laneHasContent(mkLane('a', [null, mkClip('X')]))).toBe(true);
  });

  it('sceneHasContent: direct clips AND explicit clipPerLane mappings', () => {
    const direct = mkState(
      [mkLane('L', [null, mkClip('B')])],
      [{ id: 's0', name: 'A', clipPerLane: {} }, { id: 's1', name: 'B', clipPerLane: {} }],
    );
    expect(sceneHasContent(direct, 1)).toBe(true);
    expect(sceneHasContent(direct, 0)).toBe(false);
    const indirect = mkState(
      [mkLane('L', [mkClip('A')])],
      [{ id: 's0', name: 'A', clipPerLane: {} }, { id: 's1', name: 'B', clipPerLane: { L: 0 } }],
    );
    expect(sceneHasContent(indirect, 0)).toBe(true);
  });

  it('deleteScene compacts clip rows and reindexes clipPerLane', () => {
    const state = mkState(
      [mkLane('L', [mkClip('A'), mkClip('B'), mkClip('C')])],
      [
        { id: 's0', name: '1', clipPerLane: { L: 0 } },
        { id: 's1', name: '2', clipPerLane: {} },
        { id: 's2', name: '3', clipPerLane: { L: 2 } },
      ],
    );
    deleteScene(state, 1);
    expect(state.scenes.length).toBe(2);
    expect(state.lanes[0].clips.map((c) => c?.id)).toEqual(['A', 'C']);
    expect(state.scenes[0].clipPerLane).toEqual({ L: 0 });
    expect(state.scenes[1].clipPerLane).toEqual({ L: 1 });
    deleteScene(state, 99);
    expect(state.scenes.length).toBe(2);
  });
});
