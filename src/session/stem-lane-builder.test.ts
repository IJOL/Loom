// src/session/stem-lane-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildStemAudioLane } from './stem-lane-builder';
import { isAudioClip, classifyClip } from './clip-editors/clip-editor-router';
// Side-effect import: registers the built-in 'audio' engine's capabilities.
// Without it, isAudioClip('audio', …) would fall back to the "unknown engine"
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

  // Guards the exact regression named in the plugins-capabilities slice:
  // onAddStemLanes (session-host-callbacks.ts) builds its lanes through this
  // factory, and the CLIP that lands in that lane must still be recognised as
  // audio by the REAL downstream consumer — isAudioClip/classifyClip in
  // clip-editor-router.ts, the thing that actually decides which editor opens
  // and whether the edit-row toggle shows. Exercising isAudioEngine alone (the
  // earlier version of this test) only re-asserted capabilities.test.ts and
  // never reached a consumer; this reaches the one that matters.
  it('is classified as an audio clip by the real router consumer (isAudioClip/classifyClip)', () => {
    const lane = buildStemAudioLane(stem, 'audio-stem-1', { bpm: 120, meter: METER, anchorSec: 0 });
    const clip = lane.clips[0]!;
    expect(clip.sample).toBeDefined();
    expect(clip.notes ?? []).toHaveLength(0);
    expect(isAudioClip(lane, clip)).toBe(true);
    expect(classifyClip(lane, clip, 'piano-roll')).toBe('audio');
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
