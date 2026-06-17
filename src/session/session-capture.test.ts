import { describe, it, expect } from 'vitest';
import type { SessionState } from './session';
import { captureSceneFromPlaying, emptyLanePlayState } from './session-runtime';

// tb-303-1 has clips on rows 0 and 2; drums-1 has one clip on row 0.
// Three scenes are aligned with the three clip rows (clipRowCount === 3).
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
    scenes: [
      { id: 's0', clipPerLane: {} },
      { id: 's1', clipPerLane: {} },
      { id: 's2', clipPerLane: {} },
    ],
    globalQuantize: '1/1',
  };
}

describe('captureSceneFromPlaying', () => {
  it('clones each playing clip into a NEW bottom row and adds a launchable scene', () => {
    const s = fixture();
    const ls = new Map<string, ReturnType<typeof emptyLanePlayState>>();
    const lp = emptyLanePlayState('tb-303-1');
    lp.playing = s.lanes[0].clips[2]; // clipB at row 2
    ls.set('tb-303-1', lp);
    ls.set('drums-1', emptyLanePlayState('drums-1')); // idle

    const sc = captureSceneFromPlaying(s, ls);

    // a new scene row (index 3) was added
    expect(s.scenes).toHaveLength(4);
    expect(sc).toBe(s.scenes[3]);
    expect(sc!.name).toBe('Scene 4');
    // the playing clip is CLONED into the new row with a fresh id
    const clone = s.lanes[0].clips[3];
    expect(clone).toBeTruthy();
    expect(clone!.id).not.toBe('clipB');
    expect(clone!.lengthBars).toBe(2);
    // the source clip is untouched
    expect(s.lanes[0].clips[2]!.id).toBe('clipB');
    // the idle lane gets no clip in the new row
    expect(s.lanes[1].clips[3] ?? null).toBeNull();
    // empty clipPerLane → launch falls back to the new row, where the clones live
    expect(sc!.clipPerLane).toEqual({});
  });

  it('clones the playing clip on every sounding lane into the same new row', () => {
    const s = fixture();
    const ls = new Map<string, ReturnType<typeof emptyLanePlayState>>();
    const a = emptyLanePlayState('tb-303-1'); a.playing = s.lanes[0].clips[0]; // clipA row 0
    const b = emptyLanePlayState('drums-1'); b.playing = s.lanes[1].clips[0]; // d1 row 0
    ls.set('tb-303-1', a);
    ls.set('drums-1', b);

    captureSceneFromPlaying(s, ls);

    expect(s.lanes[0].clips[3]!.id).not.toBe('clipA');
    expect(s.lanes[0].clips[3]!.lengthBars).toBe(1);
    expect(s.lanes[1].clips[3]!.id).not.toBe('d1');
    expect(s.lanes[1].clips[3]!.lengthBars).toBe(1);
  });

  it('returns null and mutates nothing when nothing is playing', () => {
    const s = fixture();
    const ls = new Map<string, ReturnType<typeof emptyLanePlayState>>();
    ls.set('tb-303-1', emptyLanePlayState('tb-303-1'));
    ls.set('drums-1', emptyLanePlayState('drums-1'));

    expect(captureSceneFromPlaying(s, ls)).toBeNull();
    expect(s.scenes).toHaveLength(3);
    expect(s.lanes[0].clips).toHaveLength(3);
    expect(s.lanes[1].clips).toHaveLength(1);
  });
});
