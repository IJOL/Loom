import { describe, it, expect } from 'vitest';
import { moveMarker, addMarker, deleteMarker, propagateWarp, propagateLoop } from './warp-marker-edit';
import type { SessionState, WarpMarker } from './session';

const m = (): WarpMarker[] => [
  { srcSec: 0, beat: 0 }, { srcSec: 4, beat: 16 }, { srcSec: 8, beat: 32 },
];

describe('warp-marker-edit', () => {
  it('moveMarker clamps between neighbors', () => {
    expect(moveMarker(m(), 1, 99)[1].srcSec).toBeLessThan(8);   // clamped below next
    expect(moveMarker(m(), 1, -99)[1].srcSec).toBeGreaterThan(0); // clamped above prev
  });

  it('addMarker inserts sorted and dedupes', () => {
    const out = addMarker(m(), 6, 24);
    expect(out.map((x) => x.srcSec)).toEqual([0, 4, 6, 8]);
    expect(addMarker(m(), 4, 16)).toHaveLength(3); // duplicate beat → no-op
  });

  it('deleteMarker protects the endpoints', () => {
    expect(deleteMarker(m(), 1)).toHaveLength(2);  // interior removable
    expect(deleteMarker(m(), 0)).toHaveLength(3);  // first protected
    expect(deleteMarker(m(), 2)).toHaveLength(3);  // last protected
  });

  it('propagateWarp writes markers+warp to every clip in the group', () => {
    const mk = m();
    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [
        { inserts: [], id: 'a', engineId: 'audio', clips: [{ color: '#d8e8a8', gridResolution: '1/16', id: 'c1', lengthBars: 4, notes: [], sample: { sampleId: 's1', mode: 'loop', trimStart: 0, trimEnd: 8, warpGroupId: 'g1' } }] },
        { inserts: [], id: 'b', engineId: 'audio', clips: [{ color: '#a8e8b8', gridResolution: '1/16', id: 'c2', lengthBars: 4, notes: [], sample: { sampleId: 's2', mode: 'loop', trimStart: 0, trimEnd: 8, warpGroupId: 'g1' } }] },
        { inserts: [], id: 'c', engineId: 'audio', clips: [{ color: '#a8e0d8', gridResolution: '1/16', id: 'c3', lengthBars: 4, notes: [], sample: { sampleId: 's3', mode: 'loop', trimStart: 0, trimEnd: 8, warpGroupId: 'OTHER' } }] },
      ],
      scenes: [], globalQuantize: '1/1',
    };
    const ids = propagateWarp(state, 'g1', mk, true);
    expect(ids.sort()).toEqual(['s1', 's2']);
    expect(state.lanes[0].clips[0]!.sample!.warpMarkers).toHaveLength(3);
    expect(state.lanes[0].clips[0]!.sample!.warp).toBe(true);
    expect(state.lanes[2].clips[0]!.sample!.warpMarkers).toBeUndefined(); // other group untouched
  });

  it('propagateLoop applies the loop sub-region to every clip in the group', () => {
    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [
        { inserts: [], id: 'a', engineId: 'audio', clips: [{ color: '#a8c8e8', gridResolution: '1/16', id: 'c1', lengthBars: 4, notes: [], sample: { sampleId: 's1', mode: 'loop', trimStart: 0, trimEnd: 8, warpGroupId: 'g1' } }] },
        { inserts: [], id: 'b', engineId: 'audio', clips: [{ color: '#b8b8e8', gridResolution: '1/16', id: 'c2', lengthBars: 4, notes: [], sample: { sampleId: 's2', mode: 'loop', trimStart: 0, trimEnd: 8, warpGroupId: 'g1' } }] },
        { inserts: [], id: 'c', engineId: 'audio', clips: [{ color: '#c8a8e0', gridResolution: '1/16', id: 'c3', lengthBars: 4, notes: [], sample: { sampleId: 's3', mode: 'loop', trimStart: 0, trimEnd: 8, warpGroupId: 'OTHER' } }] },
      ],
      scenes: [], globalQuantize: '1/1',
    };
    const ids = propagateLoop(state, 'g1', true, 0, 192);
    expect(ids.sort()).toEqual(['s1', 's2']);
    expect(state.lanes[0].clips[0]!.loopEnabled).toBe(true);
    expect(state.lanes[0].clips[0]!.loopStartTick).toBe(0);
    expect(state.lanes[0].clips[0]!.loopEndTick).toBe(192);
    expect(state.lanes[1].clips[0]!.loopEndTick).toBe(192);
    expect(state.lanes[2].clips[0]!.loopEnabled).toBeUndefined(); // other group untouched
  });
});
