import { describe, it, expect } from 'vitest';
import { analyzeLoopFor } from './loop-import';
import { DEFAULT_METER } from '../core/meter';

describe('analyzeLoopFor', () => {
  it('prefers embedded metadata (tempo + slices) over detection', () => {
    const r = analyzeLoopFor({
      durationSec: 4.0, projectMeter: DEFAULT_METER, gridResolution: '1/16',
      metadata: { originalBpm: 120, slicePointsSec: [0, 1, 2, 3] },
      detect: () => { throw new Error('should not run detection'); },
    });
    expect(r.originalBpm).toBe(120);
    expect(r.slices.length).toBe(4);
    expect(r.lengthBars).toBe(2);
  });

  it('falls back to detection when metadata lacks tempo', () => {
    const r = analyzeLoopFor({
      durationSec: 2.0, projectMeter: DEFAULT_METER, gridResolution: '1/16',
      metadata: null,
      detect: () => ({ originalBpm: 120, slicePointsSec: [0, 1], confidence: 0.5 }),
    });
    expect(r.originalBpm).toBe(120);
    expect(r.slices.length).toBe(2);
  });
});
