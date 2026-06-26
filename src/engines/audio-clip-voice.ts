// src/engines/audio-clip-voice.ts
// Shared loop/song buffer playback PLAN — extracted so the Sampler and the
// dedicated `audio` engine resolve audio clips through ONE path. WSOLA-stretches
// warp:stretch loops (pitch preserved) via stretchCache, with a varispeed
// fallback that self-heals the cache for the next iteration.
//
// Phase 4 cutover: the legacy node-per-note playAudioClip (Web Audio) was
// deleted with the legacy AudioEngine/SamplerEngine voices; the worklet engines
// (AudioWorkletEngine / SamplerWorkletEngine) build a SampleSpawn from the
// resolved plan below and play it in the sampler worklet. resolveAudioClipPlayback
// + OUTPUT_TRIM stay because BOTH worklet engines import them.

import type { ClipSample } from '../session/session';
import { sampleCache } from '../samples/sample-cache';
import { stretchCache } from '../samples/stretch-cache';
import { stretchBuffer } from '../samples/timestretch';
import { warpCache } from '../samples/warp-cache';
import { warpStretch, warpKey } from '../samples/warp-stretch';
import { SAMPLE_OUTPUT_TRIM } from '../audio-dsp/gain-staging';

/** Headroom so a full-scale sample stays < 0 dBFS. Centralized in gain-staging.ts. */
export const OUTPUT_TRIM = SAMPLE_OUTPUT_TRIM;

/** A resolved audio-clip playback plan: which buffer to play, at what rate, from
 *  what offset, and at what flat gain. Computed entirely main-thread (warp/stretch
 *  caches, varispeed fallback). The worklet engines build a SampleSpawn from it.
 *
 *  `buffer` is the AudioBuffer to feed; `bufferId` is the worklet sample-bank key
 *  to transfer it under (the rendered warp/stretch key, or the raw sampleId). */
export interface ResolvedAudioClip {
  buffer: AudioBuffer;
  bufferId: string;
  rate: number;
  offset: number;   // seconds into `buffer` to start
  gain: number;     // masterGain × sample.gain × OUTPUT_TRIM
}

export function resolveAudioClipPlayback(opts: {
  ctx: AudioContext;
  sample: ClipSample;
  gateDuration: number;
  masterGain: number;
  /** Phase 3: when present, overrides the computed trim/warp offset so playback
   *  starts from an explicit buffer position (global seek/loop re-trigger). */
  offsetSec?: number;
}): ResolvedAudioClip | null {
  const { ctx, sample, gateDuration, masterGain } = opts;
  const buf = sampleCache.get(sample.sampleId);
  if (!buf) return null;

  const trimStart = Math.max(0, sample.trimStart);
  const trimEnd = sample.trimEnd > trimStart ? Math.min(sample.trimEnd, buf.duration) : buf.duration;
  const region = Math.max(0.001, trimEnd - trimStart);
  const gate = Math.max(0.001, gateDuration);

  const markers = sample.warpMarkers;
  const wantWarp = !!sample.warp && !!markers && markers.length >= 2;
  const wKey = wantWarp ? warpKey(sample.sampleId, markers!, gate) : '';
  const warped = wantWarp ? warpCache.get(wKey) : undefined;
  const wantStretch = sample.mode === 'loop' && sample.warp && sample.warpMode === 'stretch';
  const ratio = gate / region;
  const sKey = `${sample.sampleId}|stretch|${ratio.toFixed(3)}`;
  const stretched = !wantWarp && wantStretch ? stretchCache.get(sample.sampleId, ratio) : undefined;

  let buffer: AudioBuffer;
  let bufferId: string;
  let rate: number;
  let offset: number;
  const gain = masterGain * (sample.gain ?? 1) * OUTPUT_TRIM;

  if (warped) {
    // already grid-aligned, fills the gate, starts at 0.
    buffer = warped; bufferId = wKey; rate = 1; offset = 0;
  } else if (stretched) {
    buffer = stretched; bufferId = sKey; rate = 1; offset = 0;
  } else {
    buffer = buf; bufferId = sample.sampleId;
    if (wantWarp) {
      // Cache miss (markers/gate combo not warped yet). Render it for next time,
      // and for THIS pass fall back to the MARKED source span at varispeed: play
      // [markers[0].srcSec, markers[last].srcSec] stretched to fill the gate. That
      // is the right audio region (only off-pitch until the warp heals).
      const wStart = markers![0].srcSec;
      const wSpan = Math.max(1e-3, markers![markers!.length - 1].srcSec - wStart);
      rate = wSpan / gate;
      offset = wStart;
      void warpCache.ensure(wKey, () => warpStretch(ctx, buf, markers!, gate));
    } else {
      rate = sample.mode === 'loop' ? region / gate : 1;
      offset = trimStart;
      if (wantStretch) void stretchCache.ensure(sample.sampleId, ratio, () => stretchBuffer(ctx, buf, ratio));
    }
  }
  // Phase 3: an explicit offsetSec (e.g. from a global seek/loop re-trigger)
  // overrides the computed offset across ALL paths (plain, loop, warped, stretched).
  // When absent, behavior is byte-identical to before.
  const finalOffset = opts.offsetSec != null ? opts.offsetSec : offset;
  return { buffer, bufferId, rate, offset: finalOffset, gain };
}
