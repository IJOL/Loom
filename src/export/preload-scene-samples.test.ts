// src/export/preload-scene-samples.test.ts
import { describe, it, expect } from 'vitest';
import { collectSampleIds } from './preload-scene-samples';
import type { SessionLane } from '../session/session';

describe('collectSampleIds', () => {
  it('gathers keymap sampleIds and clip-sample ids from the given lanes', () => {
    const lanes: SessionLane[] = [
      {
        id: 'samp', engineId: 'sampler', clips: [
          { id: 'c1', lengthBars: 1, notes: [], sample: { sampleId: 'loopA', mode: 'loop', trimStart: 0, trimEnd: 1 } },
        ],
        engineState: { sampler: { keymap: [
          { sampleId: 'kick', rootNote: 60, loNote: 60, hiNote: 60 },
          { sampleId: 'snare', rootNote: 62, loNote: 62, hiNote: 62 },
        ] } },
      },
    ];
    const ids = collectSampleIds(lanes);
    expect([...ids].sort()).toEqual(['kick', 'loopA', 'snare']);
  });

  it('returns empty for a pure-synth lane', () => {
    const lanes: SessionLane[] = [{ id: 'b', engineId: 'tb303', clips: [{ id: 'c', lengthBars: 1, notes: [] }] }];
    expect(collectSampleIds(lanes).size).toBe(0);
  });

  it('includes clip.sample and clip.waveformRef sampleIds', () => {
    const lanes = [{
      id: 'a', engineId: 'audio', clips: [
        { id: 'c1', lengthBars: 1, notes: [], sample: { sampleId: 'smp-clip', mode: 'loop', trimStart: 0, trimEnd: 1 } },
        { id: 'c2', lengthBars: 1, notes: [], waveformRef: { sampleId: 'smp-wave' } },
      ],
    }] as unknown as import('../session/session').SessionLane[];
    const ids = collectSampleIds(lanes);
    expect(ids.has('smp-clip')).toBe(true);
    expect(ids.has('smp-wave')).toBe(true);
  });
});
