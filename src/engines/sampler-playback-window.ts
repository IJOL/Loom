// src/engines/sampler-playback-window.ts
// Pure: resolve the AudioBufferSourceNode playback window from per-pad params.
// All *fraction* fields are 0..1 of the buffer duration.

import type { PadParams } from './sampler-pad-params';

export interface PlaybackWindow {
  offset: number;          // seconds into the buffer to start
  duration: number | null; // one-shot seconds, or null = play until stopped (loop)
  loop: boolean;
  loopStart: number;       // seconds
  loopEnd: number;         // seconds
}

export function samplePlaybackWindow(pad: PadParams, durationSec: number): PlaybackWindow {
  const dur = Math.max(0, durationSec);
  const s = Math.min(Math.max(pad.sampleStart, 0), 1);
  const e = Math.min(Math.max(pad.sampleEnd, 0), 1);
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  const loop = pad.loop > 0.5;
  const ls = Math.min(Math.max(pad.loopStart, lo), hi);
  const le = Math.min(Math.max(pad.loopEnd, lo), hi);
  return {
    offset: lo * dur,
    // offset/duration are buffer-time (independent of playbackRate — the Web Audio
    // start() API takes buffer seconds, not wall-clock seconds; do NOT divide by rate).
    duration: loop ? null : Math.max(0, (hi - lo) * dur),
    loop,
    loopStart: Math.min(ls, le) * dur,
    loopEnd: Math.max(ls, le) * dur,
  };
}
