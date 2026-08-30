// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { planDrop, ingestDroppedFile, type PerfIngestDeps } from './perf-ingest';
import { songBarSec } from '../core/song-position';
import { DEFAULT_METER } from '../core/meter';

const barSec = songBarSec(120, DEFAULT_METER); // 2s

describe('planDrop', () => {
  it('names the lane after the file (extension gone) and fits to bars', () => {
    const p = planDrop('amen_155.wav', 4 * barSec * 0.98, 120, DEFAULT_METER);
    expect(p.label).toBe('amen_155');
    expect(p.bars).toBe(4);
    // slightly short of 4 bars → the loop's own tempo is a touch above 120
    expect(p.originalBpm).toBeGreaterThan(120);
    expect(p.originalBpm).toBeLessThan(120 * 1.05);
  });
});

describe('ingestDroppedFile', () => {
  function makeDeps(): PerfIngestDeps & { bands: unknown[] } {
    const bands: unknown[] = [];
    return {
      bands,
      bpm: () => 120,
      meter: () => DEFAULT_METER,
      pxPerBar: () => 80,
      addLoopLane: vi.fn(() => ({ laneId: 'audio-1', clipId: 'clip-1' })),
      addBand: (laneId, clipId, atSec, durSec) => bands.push({ laneId, clipId, atSec, durSec }),
      importFile: vi.fn(),
      refresh: vi.fn(),
    };
  }

  it('creates the lane with the fitted originalBpm and lands the band at the drop bar', () => {
    const deps = makeDeps();
    ingestDroppedFile(deps, { name: 'loop.wav', sampleId: 's1', durationSec: 2 * barSec }, 4);
    expect(deps.addLoopLane).toHaveBeenCalledWith({
      label: 'loop', sampleId: 's1', durationSec: 2 * barSec, originalBpm: 120,
    });
    expect(deps.bands).toEqual([{ laneId: 'audio-1', clipId: 'clip-1', atSec: 4, durSec: 2 * barSec }]);
    expect(deps.refresh).toHaveBeenCalled();
  });

  it('a refused lane creates no band', () => {
    const deps = makeDeps();
    (deps.addLoopLane as ReturnType<typeof vi.fn>).mockReturnValue(null);
    ingestDroppedFile(deps, { name: 'x.wav', sampleId: 's1', durationSec: 1 }, 0);
    expect(deps.bands).toEqual([]);
  });
});
