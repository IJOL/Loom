import { describe, it, expect } from 'vitest';
import { collectStretchJobs } from './stretch-resync';
import type { SessionState } from '../session/session';
import { DEFAULT_METER } from '../core/meter';

function state(): SessionState {
  return {
    lanes: [{
      id: 'L1', engineId: 'sampler', clips: [
        { id: 'a', lengthBars: 2, notes: [], sample: { sampleId: 'smp-1', mode: 'loop', warp: true, warpMode: 'stretch', trimStart: 0, trimEnd: 4 } },
        { id: 'b', lengthBars: 1, notes: [], sample: { sampleId: 'smp-2', mode: 'loop', warp: false, warpMode: 'stretch', trimStart: 0, trimEnd: 2 } },
        { id: 'c', lengthBars: 1, notes: [], sample: { sampleId: 'smp-3', mode: 'loop', warp: true, trimStart: 0, trimEnd: 1 } }, // warp on but no stretch mode → skipped
      ],
    }],
    scenes: [], globalQuantize: '1/1',
  };
}

describe('collectStretchJobs', () => {
  it('enumerates only warp-on stretch clips with their target ratio', () => {
    const jobs = collectStretchJobs(state(), 120, DEFAULT_METER); // clip a: region 4s, gate 4s → ratio 1.0
    expect(jobs.length).toBe(1);
    expect(jobs[0].sampleId).toBe('smp-1');
    expect(jobs[0].ratio).toBeCloseTo(1.0, 3);
    expect(jobs[0].trimEnd).toBe(4);
  });
  it('ratio scales with bpm (slower bpm → longer gate → larger ratio)', () => {
    const jobs = collectStretchJobs(state(), 60, DEFAULT_METER); // gate doubles → ratio 2.0
    expect(jobs[0].ratio).toBeCloseTo(2.0, 3);
  });
});
