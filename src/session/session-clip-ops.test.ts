import { describe, it, expect } from 'vitest';
import {
  canDropClip, emptySessionState, emptyLane, emptyClip, moveClip, copyClip,
  type SessionState, type ClipSlot,
} from './session';
import type { NoteEvent } from '../core/notes';

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

function clipWithEnvelopes(envelopes: { paramId: string; values: number[]; enabled?: boolean }[]) {
  const c = emptyClip(1);
  c.envelopes = envelopes;
  c.notes = [{ start: 0, duration: 1, midi: 60, velocity: 100 } as NoteEvent];
  return c;
}

describe('moveClip — intra-lane', () => {
  it('moves the clip and leaves the source slot null', () => {
    const s = stateWithClip();
    const clip = s.lanes[0].clips[0]!;
    const out = moveClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-a', clipIdx: 1 },
      new Set(),
    );
    expect(out.lanes[0].clips[0]).toBe(null);
    expect(out.lanes[0].clips[1]).toEqual(clip);
  });

  it('preserves the clip id and color', () => {
    const s = stateWithClip();
    s.lanes[0].clips[0]!.color = '#deadbe';
    const id = s.lanes[0].clips[0]!.id;
    const out = moveClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-a', clipIdx: 1 },
      new Set(),
    );
    expect(out.lanes[0].clips[1]!.id).toBe(id);
    expect(out.lanes[0].clips[1]!.color).toBe('#deadbe');
  });

  it('throws on invalid drop (occupied destination)', () => {
    const s = stateWithClip();
    s.lanes[0].clips[1] = emptyClip(1);
    expect(() => moveClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-a', clipIdx: 1 },
      new Set(),
    )).toThrow();
  });
});

describe('moveClip — cross-lane envelopes', () => {
  it('keeps every envelope enabled when destination engine exposes every paramId', () => {
    const s = stateWithClip();
    s.lanes[0].clips[0] = clipWithEnvelopes([
      { paramId: 'filter.cutoff', values: [0.3, 0.4] },
      { paramId: 'amp.gain',      values: [0.5, 0.5] },
    ]);
    const out = moveClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-b', clipIdx: 0 },
      new Set(['filter.cutoff', 'amp.gain']),
    );
    const moved = out.lanes[1].clips[0]!;
    expect(moved.envelopes![0].enabled).toBe(true);
    expect(moved.envelopes![1].enabled).toBe(true);
    expect(moved.envelopes![0].values).toEqual([0.3, 0.4]);
  });

  it('flips enabled=false for envelopes whose paramId is unknown to the destination engine', () => {
    const s = stateWithClip();
    s.lanes[0].clips[0] = clipWithEnvelopes([
      { paramId: 'filter.cutoff', values: [0.3, 0.4] },
      { paramId: 'tb303.envMod',  values: [0.6, 0.6] },
    ]);
    const out = moveClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-b', clipIdx: 0 },
      new Set(['filter.cutoff']),
    );
    const moved = out.lanes[1].clips[0]!;
    expect(moved.envelopes![0].enabled).toBe(true);
    expect(moved.envelopes![1].enabled).toBe(false);
    expect(moved.envelopes![1].values).toEqual([0.6, 0.6]);
  });

  it('does not touch envelope enabled flags when intra-lane (same engine)', () => {
    const s = stateWithClip();
    s.lanes[0].clips[0] = clipWithEnvelopes([
      { paramId: 'filter.cutoff', values: [0.3, 0.4], enabled: false },
    ]);
    const out = moveClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-a', clipIdx: 1 },
      new Set(),
    );
    expect(out.lanes[0].clips[1]!.envelopes![0].enabled).toBe(false);
  });

  it('pads sparse destination lane with nulls', () => {
    const s = stateWithClip();
    const out = moveClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-b', clipIdx: 3 },
      new Set(),
    );
    expect(out.lanes[1].clips.length).toBeGreaterThanOrEqual(4);
    expect(out.lanes[1].clips[3]).toBeTruthy();
    expect(out.lanes[1].clips[0]).toBeFalsy();
  });
});

describe('copyClip', () => {
  it('leaves the source slot intact', () => {
    const s = stateWithClip();
    const out = copyClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-a', clipIdx: 1 },
      new Set(),
    );
    expect(out.lanes[0].clips[0]).toBeTruthy();
    expect(out.lanes[0].clips[1]).toBeTruthy();
  });

  it('assigns the copy a fresh id but preserves color', () => {
    const s = stateWithClip();
    s.lanes[0].clips[0]!.color = '#cafefe';
    const srcId = s.lanes[0].clips[0]!.id;
    const out = copyClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-a', clipIdx: 1 },
      new Set(),
    );
    const copy = out.lanes[0].clips[1]!;
    expect(copy.id).not.toBe(srcId);
    expect(copy.color).toBe('#cafefe');
  });

  it('deep-clones notes and envelopes (copy edits do not affect source)', () => {
    const s = stateWithClip();
    s.lanes[0].clips[0] = clipWithEnvelopes([
      { paramId: 'filter.cutoff', values: [0.5] },
    ]);
    const out = copyClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-a', clipIdx: 1 },
      new Set(['filter.cutoff']),
    );
    out.lanes[0].clips[1]!.envelopes![0].values[0] = 0.9;
    expect(out.lanes[0].clips[0]!.envelopes![0].values[0]).toBe(0.5);
  });

  it('re-evaluates envelopes on cross-lane copy', () => {
    const s = stateWithClip();
    s.lanes[0].clips[0] = clipWithEnvelopes([
      { paramId: 'tb303.envMod', values: [0.7] },
    ]);
    const out = copyClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-b', clipIdx: 0 },
      new Set(['filter.cutoff']),
    );
    expect(out.lanes[1].clips[0]!.envelopes![0].enabled).toBe(false);
  });

  it('throws on invalid drop (occupied destination)', () => {
    const s = stateWithClip();
    s.lanes[0].clips[1] = emptyClip(1);
    expect(() => copyClip(
      s,
      { laneId: 'lane-a', clipIdx: 0 },
      { laneId: 'lane-a', clipIdx: 1 },
      new Set(),
    )).toThrow();
  });
});
