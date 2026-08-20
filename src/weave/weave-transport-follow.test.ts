// Play has to start a FOLLOWING lane, not just a weaving one.
//
// It did not, and the symptom was pure friction: you set the accompaniment up
// in the panel, pressed Play, and heard nothing — because choosing a leader
// clears the lane's weave, so the lane stopped matching "has a weave selection"
// and dropped out of the launch. The only way to hear it was to leave the panel
// for the session grid and launch a scene by hand. Reported, accurately, as
// "resulta rarísimo que tengamos que ir a weave y terminemos pulsando escena 2".

import { describe, it, expect } from 'vitest';
import { launchWeavingLanes } from './weave-transport';
import { defaultWeaveState, defaultLaneSelection } from './weave-state';
import type { SessionClip } from '../session/session';

const clip = (id: string): SessionClip => ({
  id, name: id, color: '#fff', lengthBars: 2, gridResolution: '1/16', notes: [],
});

function launched(lanes: Parameters<typeof launchWeavingLanes>[1]['lanes'], weaving: string[] = []) {
  const state = defaultWeaveState();
  for (const id of weaving) {
    state.lanes[id] = { ...defaultLaneSelection(), weave: { kind: 'ab', a: 'x', b: 'y', x: 0 } as never };
  }
  const out: { laneId: string; row: number }[] = [];
  launchWeavingLanes(state, {
    lanes, activeSceneIdx: 0, launchClipAt: (laneId, row) => out.push({ laneId, row }),
  });
  return out;
}

describe('Play launches every lane the panel drives', () => {
  it('starts a following lane', () => {
    const out = launched([
      { id: 'lead', clips: [clip('c1')] },
      { id: 'chords', clips: [clip('c2')], follow: { leaderId: 'lead' } },
    ]);
    expect(out.map((l) => l.laneId)).toEqual(['chords']);
  });

  it('starts a weaving lane and a following one together', () => {
    const out = launched([
      { id: 'woven', clips: [clip('c1')] },
      { id: 'chords', clips: [clip('c2')], follow: { leaderId: 'woven' } },
    ], ['woven']);
    expect(out.map((l) => l.laneId)).toEqual(['woven', 'chords']);
  });

  it('leaves a lane that neither weaves nor follows alone', () => {
    // The whole feature stays additive: an untouched session launches exactly
    // as it did, and Play does not reach for lanes the panel has no say over.
    expect(launched([{ id: 'plain', clips: [clip('c1')] }])).toEqual([]);
  });

  it('skips a follower with no clip at all rather than inventing one', () => {
    // Derived notes replace what a playing clip CONTAINS, not the clip itself.
    const out = launched([
      { id: 'lead', clips: [clip('c1')] },
      { id: 'chords', clips: [], follow: { leaderId: 'lead' } },
    ]);
    expect(out).toEqual([]);
  });

  it('launches an EMPTY carrier clip — that is all a follower needs', () => {
    const out = launched([
      { id: 'chords', clips: [null, clip('c2')], follow: { leaderId: 'lead' } },
    ]);
    // Row 0 is empty, so it falls to the first row that has one.
    expect(out).toEqual([{ laneId: 'chords', row: 1 }]);
  });
});
