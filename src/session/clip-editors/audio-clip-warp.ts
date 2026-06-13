// src/session/clip-editors/audio-clip-warp.ts
// One source of truth for the audio-clip Warp toggle. Native (song) plays at the
// recorded tempo (playbackRate 1); warped (loop+stretch) WSOLA-fits the trimmed
// region to the clip's grid length, pitch preserved.
import type { ClipSample } from '../session';

export function setAudioClipWarp(sample: ClipSample, on: boolean): void {
  sample.warp = on;
  sample.mode = on ? 'loop' : 'song';
  if (on) sample.warpMode = 'stretch';
}
