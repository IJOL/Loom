// src/session/session-runtime-scene.test.ts
import { describe, it, expect } from 'vitest';
import { launchScene, tickSession, emptyLanePlayState, type LanePlayState } from './session-runtime';
import type { SessionState, SessionClip, SessionLane, SessionScene } from './session';

const BPM = 120; // 1 bar = 2s

// Three lanes. Lane A: bass 2-bar (4s). Lane B: drums 1-bar (2s). Lane C: pad 16-bar (32s).
// Scene 0 (currently playing) = row 0 clips. Scene 1 = row 1 clips:
//   A has a row-1 clip, B has a row-1 clip, C has NO row-1 clip (orphan → must stop).
function setup() {
  const aOld: SessionClip = { id: 'a0', lengthBars: 2, notes: [] };
  const aNew: SessionClip = { id: 'a1', lengthBars: 2, notes: [] };
  const bOld: SessionClip = { id: 'b0', lengthBars: 1, notes: [] };
  const bNew: SessionClip = { id: 'b1', lengthBars: 1, notes: [] };
  const cOld: SessionClip = { id: 'c0', lengthBars: 16, notes: [] };

  const lanes: SessionLane[] = [
    { id: 'A', engineId: 'subtractive', clips: [aOld, aNew] },
    { id: 'B', engineId: 'subtractive', clips: [bOld, bNew] },
    { id: 'C', engineId: 'subtractive', clips: [cOld, null] },
  ];
  const scenes: SessionScene[] = [
    { id: 's0', clipPerLane: {} },
    { id: 's1', clipPerLane: {} }, // positional: row 1
  ];
  const state: SessionState = { lanes, scenes, globalQuantize: '1/1' };

  const laneStates = new Map<string, LanePlayState>([
    ['A', { ...emptyLanePlayState('A'), playing: aOld, loopStartedAt: 0 }],
    ['B', { ...emptyLanePlayState('B'), playing: bOld, loopStartedAt: 0 }],
    ['C', { ...emptyLanePlayState('C'), playing: cOld, loopStartedAt: 0 }],
  ]);
  return { state, scenes, laneStates, aNew, bNew };
}

describe('launchScene — atomic switch synced to governing loop end', () => {
  it('governs by the 4s bass loop (16s pad is an outlier → dropped); B,A queue, C stops, all at T', () => {
    const { state, scenes, laneStates, aNew, bNew } = setup();
    // lengths 4s,2s,32s → drop 32 (32>2·4); then 4>2·2? no → governs 4s.
    // aligned at 0, now=5 → next 4s end = 8s.
    launchScene(laneStates, state, scenes[1], 1, /*now=*/5, BPM);
    const A = laneStates.get('A')!, B = laneStates.get('B')!, C = laneStates.get('C')!;
    expect(A.queued).toBe(aNew); expect(A.queuedBoundary).toBeCloseTo(8, 9);
    expect(B.queued).toBe(bNew); expect(B.queuedBoundary).toBeCloseTo(8, 9);
    expect(C.queued).toBeNull(); expect(C.queuedStop).toBeCloseTo(8, 9); // orphan stops at T
  });

  it('a lane already playing the exact target clip is left running (no retrigger)', () => {
    const { state, scenes, laneStates } = setup();
    // Make scene 1 target for A be the SAME clip A is already playing (id a0 at row 1).
    state.lanes[0].clips[1] = state.lanes[0].clips[0]; // row1 of A === aOld
    launchScene(laneStates, state, scenes[1], 1, 5, BPM);
    const A = laneStates.get('A')!;
    expect(A.queued).toBeNull();        // not re-queued
    expect(A.queuedStop).toBeNull();    // not stopped
    expect(A.playing!.id).toBe('a0');   // still playing, same phase
  });
});

describe('tickSession applies queuedStop + silences at the boundary', () => {
  it('orphan lane is released at T and its live voices silenced', () => {
    const { state, laneStates } = setup();
    const C = laneStates.get('C')!;
    C.queuedStop = 8; // from launchScene
    const silenced: Array<{ laneId: string; at: number }> = [];
    const silence = { silenceLane: (laneId: string, at: number) => silenced.push({ laneId, at }) };
    // tick whose look-ahead window reaches T=8: now=7.9, look=0.2
    tickSession(laneStates, state, 7.9, 0.2, BPM, () => {}, () => {}, undefined, undefined, silence);
    expect(C.playing).toBeNull();
    expect(C.queuedStop).toBeNull();
    expect(silenced).toContainEqual({ laneId: 'C', at: 8 });
  });

  it('does not stop before the boundary is within look-ahead', () => {
    const { state, laneStates } = setup();
    const C = laneStates.get('C')!;
    C.queuedStop = 8;
    tickSession(laneStates, state, 5, 0.2, BPM, () => {}, () => {}, undefined, undefined,
      { silenceLane: () => {} });
    expect(C.playing).not.toBeNull(); // 5 + 0.2 < 8 → still playing
    expect(C.queuedStop).toBe(8);
  });
});
