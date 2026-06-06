// src/core/scene-ensure.test.ts
import { describe, it, expect } from 'vitest';
import { ensureScenesForRows } from './scene-ensure';
import { emptySessionState, emptyClip } from '../session/session';

describe('ensureScenesForRows', () => {
  it('appends scenes so every clip row has one (returns true when it added)', () => {
    const s = emptySessionState();
    s.lanes[0].clips = [emptyClip(1), emptyClip(1), emptyClip(1)]; // 3 rows, 0 scenes
    expect(s.scenes.length).toBe(0);
    const added = ensureScenesForRows(s);
    expect(added).toBe(true);
    expect(s.scenes.length).toBe(3);
  });

  it('is a no-op when scenes already cover every row (returns false)', () => {
    const s = emptySessionState();
    s.lanes[0].clips = [emptyClip(1)];
    ensureScenesForRows(s);
    const added = ensureScenesForRows(s);
    expect(added).toBe(false);
    expect(s.scenes.length).toBe(1);
  });

  it('does not remove existing extra scenes', () => {
    const s = emptySessionState();
    s.scenes = [{ id: 'x', name: 'A', clipPerLane: {} }, { id: 'y', name: 'B', clipPerLane: {} }];
    s.lanes[0].clips = [emptyClip(1)]; // only 1 clip row, but 2 scenes exist
    const added = ensureScenesForRows(s);
    expect(added).toBe(false);
    expect(s.scenes.length).toBe(2);
  });

  it('seeds at least one scene when every lane is empty (no clips)', () => {
    const s = emptySessionState();
    for (const l of s.lanes) l.clips = [];
    s.scenes = [];
    ensureScenesForRows(s);
    expect(s.scenes.length).toBeGreaterThanOrEqual(1);
  });

  it('does not invent scenes when there are no lanes at all', () => {
    const s = emptySessionState();
    s.lanes = [];
    s.scenes = [];
    const added = ensureScenesForRows(s);
    expect(added).toBe(false);
    expect(s.scenes.length).toBe(0);
  });
});
