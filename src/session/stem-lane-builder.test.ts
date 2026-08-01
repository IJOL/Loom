// src/session/stem-lane-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildStemAudioLane } from './stem-lane-builder';
import { isAudioEngine } from '../plugins/capabilities';
// Side-effect import: registers the built-in 'audio' engine's capabilities.
// Without it, isAudioEngine('audio') would fall back to the "unknown engine"
// default (false) and this test would pass for the wrong reason.
import '../engines/audio';

const METER = { num: 4, den: 4 } as const;
const stem = { label: 'Drums', sampleId: 's1', durationSec: 8 };

describe('buildStemAudioLane', () => {
  it('creates an AUDIO lane (not sampler), with no keymap', () => {
    const lane = buildStemAudioLane(stem, 'audio-stem-1', { bpm: 120, meter: METER, anchorSec: 0 });
    expect(lane.engineId).toBe('audio');
    expect(lane.engineState?.sampler).toBeUndefined();
    expect(lane.name).toBe('Drums');
  });

  // Guards the exact regression named in the plugins-capabilities slice: a stem
  // lane's clip must still be recognised as an audio clip through the
  // CAPABILITY door (isAudioEngine), not through some caller comparing
  // `lane.engineId === 'audio'` by hand. onAddStemLanes (session-host-callbacks)
  // and the clip editor router both depend on this classification staying true.
  it('is classified as an audio clip through the capability door, not an id switch', () => {
    const lane = buildStemAudioLane(stem, 'audio-stem-1', { bpm: 120, meter: METER, anchorSec: 0 });
    expect(isAudioEngine(lane.engineId)).toBe(true);
  });
  it('anchors the clip downbeat via trimStart and stays native (song, warp off)', () => {
    const lane = buildStemAudioLane(stem, 'audio-stem-1', { bpm: 120, meter: METER, anchorSec: 1.5 });
    const s = lane.clips[0]!.sample!;
    expect(s.trimStart).toBe(1.5);
    expect(s.mode).toBe('song');
    expect(s.warp).toBe(false);
  });

  it('forwards warpGroupId + warpRef onto the clip sample', () => {
    const lane = buildStemAudioLane(stem, 'audio-stem-1', {
      bpm: 120, meter: METER, anchorSec: 0,
      warpMarkers: [{ srcSec: 0, beat: 0 }, { srcSec: 4, beat: 16 }],
      warpGroupId: 'grp-x', warpRef: true,
    });
    const s = lane.clips[0]!.sample!;
    expect(s.warpGroupId).toBe('grp-x');
    expect(s.warpRef).toBe(true);
    expect(s.warpMarkers).toHaveLength(2);
  });
});
