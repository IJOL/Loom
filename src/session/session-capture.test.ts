import { describe, it, expect } from 'vitest';
import type { SessionState } from './session';
import { buildSceneFromPlaying, emptyLanePlayState } from './session-runtime';

function fixture(): SessionState {
  return {
    lanes: [
      { id: 'tb-303-1', engineId: 'tb303', clips: [
        { id: 'clipA', lengthBars: 1, notes: [] },
        null,
        { id: 'clipB', lengthBars: 2, notes: [] },
      ] },
      { id: 'drums-1', engineId: 'drums-machine', clips: [{ id: 'd1', lengthBars: 1, notes: [] }] },
    ],
    scenes: [],
    globalQuantize: '1/1',
  };
}

describe('buildSceneFromPlaying', () => {
  it('captures each playing clip row index and marks idle lanes as explicit null', () => {
    const s = fixture();
    const ls = new Map<string, ReturnType<typeof emptyLanePlayState>>();
    const lp = emptyLanePlayState('tb-303-1');
    lp.playing = s.lanes[0].clips[2]; // clipB at row 2
    ls.set('tb-303-1', lp);
    ls.set('drums-1', emptyLanePlayState('drums-1')); // idle
    const sc = buildSceneFromPlaying(s, ls);
    expect(sc).not.toBeNull();
    expect(sc!.clipPerLane['tb-303-1']).toBe(2);
    expect(sc!.clipPerLane['drums-1']).toBeNull();
    expect(sc!.name).toBe('Scene 1');
  });

  it('returns null when nothing is playing', () => {
    const s = fixture();
    const ls = new Map<string, ReturnType<typeof emptyLanePlayState>>();
    ls.set('tb-303-1', emptyLanePlayState('tb-303-1'));
    ls.set('drums-1', emptyLanePlayState('drums-1'));
    expect(buildSceneFromPlaying(s, ls)).toBeNull();
  });
});
