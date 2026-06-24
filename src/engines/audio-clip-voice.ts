// src/engines/audio-clip-voice.ts
// Shared loop/song buffer playback — extracted from SamplerVoice.triggerSample so
// the Sampler and the dedicated `audio` engine play audio clips through ONE path.
// WSOLA-stretches warp:stretch loops (pitch preserved) via stretchCache, with a
// varispeed fallback that self-heals the cache for the next iteration. Flat gain
// with ~5 ms anti-click fades — no ADSR.

import type { ClipSample } from '../session/session';
import { sampleCache } from '../samples/sample-cache';
import { stretchCache } from '../samples/stretch-cache';
import { stretchBuffer } from '../samples/timestretch';
import { warpCache } from '../samples/warp-cache';
import { warpStretch, warpKey } from '../samples/warp-stretch';

/** Headroom so a full-scale sample stays < 0 dBFS. */
export const OUTPUT_TRIM = 0.7;

export interface AudioClipPlayback { src: AudioBufferSourceNode; endTime: number; }

/** A resolved audio-clip playback plan: which buffer to play, at what rate, from
 *  what offset, and at what flat gain. Computed entirely main-thread (warp/stretch
 *  caches, varispeed fallback). Both `playAudioClip` (Web Audio, legacy) and the
 *  worklet engines (AudioWorklet, posts a SampleSpawn) build from this — DRY so
 *  the two paths can never drift on rate/offset/warp logic.
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
  return { buffer, bufferId, rate, offset, gain };
}

export function playAudioClip(opts: {
  ctx: AudioContext;
  sample: ClipSample;
  time: number;
  gateDuration: number;
  dest: AudioNode;     // where the source connects (e.g. a filter or amp input)
  ampGain: GainNode;   // gain node the flat envelope is scheduled on
  masterGain: number;  // engine 'gain' global
}): AudioClipPlayback | null {
  const { ctx, sample, time, gateDuration, dest, ampGain, masterGain } = opts;
  const resolved = resolveAudioClipPlayback({ ctx, sample, gateDuration, masterGain });
  if (!resolved) return null;
  const gate = Math.max(0.001, gateDuration);

  const src = ctx.createBufferSource();
  src.buffer = resolved.buffer;
  src.playbackRate.value = resolved.rate;
  src.connect(dest);

  const peak = resolved.gain;
  const fade = Math.min(0.005, gate / 4);
  const g = ampGain.gain;
  g.cancelScheduledValues(time);
  g.setValueAtTime(0, time);
  g.linearRampToValueAtTime(peak, time + fade);
  g.setValueAtTime(peak, Math.max(time + fade, time + gate - fade));
  g.linearRampToValueAtTime(0, time + gate);

  const endTime = time + gate + 0.01;
  // Warped/stretched buffers already start at 0; the varispeed fallback starts at
  // the marked-region source start; else at the clip trim — all folded into offset.
  src.start(time, resolved.offset);
  src.stop(endTime);
  return { src, endTime };
}
