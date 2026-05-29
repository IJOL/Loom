import { describe, it, expect } from 'vitest';
import {
  canDropClip, emptySessionState, emptyLane, emptyClip,
  type SessionState, type ClipSlot,
} from './session';

function stateWithClip(): SessionState {
  const s = emptySessionState();
  s.lanes = [emptyLane('lane-a', 'tb303'), emptyLane('lane-b', 'drums-machine')];
  s.lanes[0].clips = [emptyClip(1), null];   // clip at row 0, empty at row 1
  return s;
}

describe('canDropClip', () => {
  it('returns true for an empty destination in another row of the same lane', () => {
    const s = stateWithClip();
    const from: ClipSlot = { laneId: 'lane-a', clipIdx: 0 };
    const to:   ClipSlot = { laneId: 'lane-a', clipIdx: 1 };
    expect(canDropClip(s, from, to)).toBe(true);
  });

  it('returns true for an empty destination in another lane', () => {
    const s = stateWithClip();
    const from: ClipSlot = { laneId: 'lane-a', clipIdx: 0 };
    const to:   ClipSlot = { laneId: 'lane-b', clipIdx: 0 };
    expect(canDropClip(s, from, to)).toBe(true);
  });

  it('returns true for a fresh row past the current length of the destination lane', () => {
    const s = stateWithClip();
    const from: ClipSlot = { laneId: 'lane-a', clipIdx: 0 };
    const to:   ClipSlot = { laneId: 'lane-b', clipIdx: 4 };
    expect(canDropClip(s, from, to)).toBe(true);
  });

  it('returns false when the source slot is empty', () => {
    const s = stateWithClip();
    const from: ClipSlot = { laneId: 'lane-a', clipIdx: 1 };
    const to:   ClipSlot = { laneId: 'lane-b', clipIdx: 0 };
    expect(canDropClip(s, from, to)).toBe(false);
  });

  it('returns false when the destination is occupied', () => {
    const s = stateWithClip();
    s.lanes[1].clips = [emptyClip(1)];
    const from: ClipSlot = { laneId: 'lane-a', clipIdx: 0 };
    const to:   ClipSlot = { laneId: 'lane-b', clipIdx: 0 };
    expect(canDropClip(s, from, to)).toBe(false);
  });

  it('returns false when from === to', () => {
    const s = stateWithClip();
    const slot: ClipSlot = { laneId: 'lane-a', clipIdx: 0 };
    expect(canDropClip(s, slot, slot)).toBe(false);
  });
});
