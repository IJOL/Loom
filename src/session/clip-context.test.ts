import { describe, it, expect } from 'vitest';
import { resolveClipContext, type SessionState } from './session';

function makeState(): SessionState {
  return { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
    lanes: [
      { inserts: [], id: 'bass', engineId: 'tb303', name: 'BASS', clips: [
        { color: '#a8e0d8', gridResolution: '1/16', id: 'c0', lengthBars: 1, notes: [] },
        { color: '#a8c8e8', gridResolution: '1/16', id: 'c1', name: 'Acid line', lengthBars: 1, notes: [] },
      ] },
      { inserts: [], id: 'lead', engineId: 'subtractive', clips: [] },
    ],
    scenes: [
      { id: 's0', name: 'Intro', clipPerLane: {} },
      { id: 's1', clipPerLane: {} }, // unnamed → falls back to "Scene 2"
    ],
    globalQuantize: '1/1',
  };
}

describe('resolveClipContext', () => {
  it('resolves track name, scene fallback, row number, and clip name', () => {
    const ctx = resolveClipContext(makeState(), 'bass', 1)!;
    expect(ctx.trackName).toBe('BASS');
    expect(ctx.sceneName).toBe('Scene 2');
    expect(ctx.rowNumber).toBe(2);
    expect(ctx.clipName).toBe('Acid line');
  });

  it('falls back: track→ID upper-cased, clip→"Clip N"; named scene kept', () => {
    const st = makeState();
    st.lanes[1].clips = [{ color: '#b8b8e8', gridResolution: '1/16', id: 'lc0', lengthBars: 1, notes: [] }];
    const ctx = resolveClipContext(st, 'lead', 0)!;
    expect(ctx.trackName).toBe('LEAD');
    expect(ctx.clipName).toBe('Clip 1');
    expect(ctx.sceneName).toBe('Intro');
  });

  it('returns null when the lane or clip is missing', () => {
    expect(resolveClipContext(makeState(), 'nope', 0)).toBeNull();
    expect(resolveClipContext(makeState(), 'lead', 0)).toBeNull(); // lane exists, no clip
  });
});
