// src/app/warp-resync.test.ts
import { describe, it, expect } from 'vitest';
import { collectWarpJobs } from './warp-resync';
import type { SessionState } from '../session/session';

const meter = { num: 4, den: 4 } as const;

function stateWithWarpClip(): SessionState {
  return {
    lanes: [{ id: 'audio-1', engineId: 'audio', clips: [{
      id: 'c1', lengthBars: 2, notes: [],
      sample: { sampleId: 's1', mode: 'loop', warp: true, trimStart: 0, trimEnd: 4,
        warpMarkers: [{ srcSec: 0, beat: 0 }, { srcSec: 2, beat: 8 }] },
    }] }],
    scenes: [], globalQuantize: '1/1',
  } as unknown as SessionState;
}

describe('collectWarpJobs', () => {
  it('emits a job (sampleId, markers, gate) for a warp-marker clip; gate scales with bpm', () => {
    const s = stateWithWarpClip();
    const at120 = collectWarpJobs(s, 120, meter);
    expect(at120).toHaveLength(1);
    // 2 bars × 4 beats × (60/120)=0.5 s = 4 s
    expect(at120[0].gate).toBeCloseTo(4, 3);
    expect(at120[0].sampleId).toBe('s1');
    const at140 = collectWarpJobs(s, 140, meter);
    expect(at140[0].gate).toBeLessThan(at120[0].gate); // faster tempo → shorter gate
  });
  it('ignores clips without warpMarkers', () => {
    const s = stateWithWarpClip();
    s.lanes[0].clips[0]!.sample!.warpMarkers = undefined;
    expect(collectWarpJobs(s, 120, meter)).toHaveLength(0);
  });
});
