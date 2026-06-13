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
  const buf = sampleCache.get(sample.sampleId);
  if (!buf) return null;

  const trimStart = Math.max(0, sample.trimStart);
  const trimEnd = sample.trimEnd > trimStart ? Math.min(sample.trimEnd, buf.duration) : buf.duration;
  const region = Math.max(0.001, trimEnd - trimStart);
  const gate = Math.max(0.001, gateDuration);

  const src = ctx.createBufferSource();
  const markers = sample.warpMarkers;
  const wantWarp = !!sample.warp && !!markers && markers.length >= 2;
  const warped = wantWarp ? warpCache.get(warpKey(sample.sampleId, markers!, gate)) : undefined;
  const wantStretch = sample.mode === 'loop' && sample.warp && sample.warpMode === 'stretch';
  const ratio = gate / region;
  const stretched = !wantWarp && wantStretch ? stretchCache.get(sample.sampleId, ratio) : undefined;
  if (warped) {
    src.buffer = warped;          // already grid-aligned, fills the gate
    src.playbackRate.value = 1;
  } else if (stretched) {
    src.buffer = stretched;
    src.playbackRate.value = 1;
  } else {
    src.buffer = buf;
    src.playbackRate.value = sample.mode === 'loop' ? region / gate : 1;
    if (wantWarp) {
      // render the warped buffer for next time (markers present but not cached yet)
      void warpCache.ensure(warpKey(sample.sampleId, markers!, gate), () => warpStretch(ctx, buf, markers!, gate));
    } else if (wantStretch) {
      void stretchCache.ensure(sample.sampleId, ratio, () => stretchBuffer(ctx, buf, ratio));
    }
  }
  src.connect(dest);

  const peak = masterGain * (sample.gain ?? 1) * OUTPUT_TRIM;
  const fade = Math.min(0.005, gate / 4);
  const g = ampGain.gain;
  g.cancelScheduledValues(time);
  g.setValueAtTime(0, time);
  g.linearRampToValueAtTime(peak, time + fade);
  g.setValueAtTime(peak, Math.max(time + fade, time + gate - fade));
  g.linearRampToValueAtTime(0, time + gate);

  const endTime = time + gate + 0.01;
  src.start(time, (warped || stretched) ? 0 : trimStart);
  src.stop(endTime);
  return { src, endTime };
}
