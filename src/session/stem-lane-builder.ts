// src/session/stem-lane-builder.ts
// Builds one AUDIO-engine lane carrying a whole stem as a native (warp-off) audio
// clip, downbeat-trimmed to `anchorSec` so it lands on bar 1. No sampler keymap —
// the `audio` engine plays clip.sample directly and shows the waveform-only editor.
import { emptyLane, audioChannelClip, type SessionLane } from './session';
import type { TimeSignature } from '../core/meter';

export function buildStemAudioLane(
  stem: { label: string; sampleId: string; durationSec: number },
  id: string,
  opts: { bpm: number; meter: TimeSignature; anchorSec: number; warpMarkers?: import('./session').WarpMarker[]; warpGroupId?: string; warpRef?: boolean },
): SessionLane {
  const lane = emptyLane(id, 'audio');
  lane.name = stem.label;
  const hasWarp = !!opts.warpMarkers && opts.warpMarkers.length >= 2;
  lane.clips = [audioChannelClip({
    name: stem.label,
    sampleId: stem.sampleId,
    durationSec: stem.durationSec,
    originalBpm: opts.bpm,
    projectMeter: opts.meter,
    anchorSec: opts.anchorSec,
    warp: hasWarp,            // auto-warp ON when we have markers
    warpMarkers: opts.warpMarkers,
    warpGroupId: opts.warpGroupId,
    warpRef: opts.warpRef,
  })];
  return lane;
}
