// src/session/stem-lane-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildStemAudioLane } from './stem-lane-builder';

const METER = { num: 4, den: 4 } as const;
const stem = { label: 'Drums', sampleId: 's1', durationSec: 8 };

describe('buildStemAudioLane', () => {
  it('creates an AUDIO lane (not sampler), with no keymap', () => {
    const lane = buildStemAudioLane(stem, 'audio-stem-1', { bpm: 120, meter: METER, anchorSec: 0 });
    expect(lane.engineId).toBe('audio');
    expect(lane.engineState?.sampler).toBeUndefined();
    expect(lane.name).toBe('Drums');
  });
  it('anchors the clip downbeat via trimStart and stays native (song, warp off)', () => {
    const lane = buildStemAudioLane(stem, 'audio-stem-1', { bpm: 120, meter: METER, anchorSec: 1.5 });
    const s = lane.clips[0]!.sample!;
    expect(s.trimStart).toBe(1.5);
    expect(s.mode).toBe('song');
    expect(s.warp).toBe(false);
  });
});
