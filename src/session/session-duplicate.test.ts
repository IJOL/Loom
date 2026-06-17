import { describe, it, expect } from 'vitest';
import { duplicateLane, duplicateScene, type SessionState } from './session';

function fixture(): SessionState {
  return {
    lanes: [
      {
        id: 'tb-303-1', engineId: 'tb303', name: 'Bass',
        enginePresetName: 'factory:Acid',
        engineState: { params: { cutoff: 0.4 } },
        clips: [
          { id: 'clipA', lengthBars: 1, notes: [] },
          null,
          { id: 'clipB', lengthBars: 2, notes: [] },
        ],
      },
      { id: 'drums-1', engineId: 'drums-machine', clips: [{ id: 'd1', lengthBars: 1, notes: [] }] },
    ],
    scenes: [
      { id: 's1', name: 'A', clipPerLane: { 'tb-303-1': 0, 'drums-1': 0 } },
      { id: 's2', name: 'B', clipPerLane: {} },
    ],
    globalQuantize: '1/1',
  };
}

describe('duplicateLane', () => {
  it('inserts the clone immediately to the right of the source', () => {
    const s = fixture();
    const clone = duplicateLane(s, 'tb-303-1', 'tb-303-2');
    expect(s.lanes.map((l) => l.id)).toEqual(['tb-303-1', 'tb-303-2', 'drums-1']);
    expect(clone.id).toBe('tb-303-2');
    expect(clone.engineId).toBe('tb303');
    expect(clone.name).toBe('Bass copy');
  });

  it('gives every cloned clip a fresh unique id and preserves null holes', () => {
    const s = fixture();
    const clone = duplicateLane(s, 'tb-303-1', 'tb-303-2');
    expect(clone.clips[1]).toBeNull();
    const ids = [clone.clips[0]!.id, clone.clips[2]!.id];
    expect(ids[0]).not.toBe('clipA');
    expect(ids[1]).not.toBe('clipB');
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('deep-clones engineState and clips (mutating the clone leaves the source intact)', () => {
    const s = fixture();
    const clone = duplicateLane(s, 'tb-303-1', 'tb-303-2');
    clone.engineState!.params!.cutoff = 0.9;
    clone.clips[0]!.notes.push({ note: 60, start: 0, dur: 1, vel: 1 } as never);
    expect(s.lanes[0].engineState!.params!.cutoff).toBe(0.4);
    expect(s.lanes[0].clips[0]!.notes).toHaveLength(0);
  });

  it('mirrors explicit clipPerLane entries to the new lane, leaving fallback scenes untouched', () => {
    const s = fixture();
    duplicateLane(s, 'tb-303-1', 'tb-303-2');
    expect(s.scenes[0].clipPerLane['tb-303-2']).toBe(0);
    expect('tb-303-2' in s.scenes[1].clipPerLane).toBe(false);
  });
});

describe('duplicateScene', () => {
  it('appends a clone resolving explicit entries for all lanes', () => {
    const s = fixture();
    const sc = duplicateScene(s, 0);
    expect(s.scenes).toHaveLength(3);
    expect(s.scenes[2]).toBe(sc);
    expect(sc!.clipPerLane).toEqual({ 'tb-303-1': 0, 'drums-1': 0 });
    expect(sc!.name).toBe('A copy');
  });

  it('resolves row-index fallback to the source index for lanes with no explicit entry', () => {
    const s = fixture();
    const sc = duplicateScene(s, 1); // s2 has empty clipPerLane
    expect(sc!.clipPerLane).toEqual({ 'tb-303-1': 1, 'drums-1': 1 });
    expect(sc!.name).toBe('B copy');
  });

  it('returns null and mutates nothing when sceneIdx is out of range', () => {
    const s = fixture();
    expect(duplicateScene(s, 9)).toBeNull();
    expect(s.scenes).toHaveLength(2);
  });
});
