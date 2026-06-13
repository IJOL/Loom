// src/session/clip-editors/audio-clip-warp.test.ts
import { describe, it, expect } from 'vitest';
import { setAudioClipWarp } from './audio-clip-warp';
import type { ClipSample } from '../session';

const sample = (): ClipSample => ({ sampleId: 'x', mode: 'song', warp: false, warpMode: 'stretch', trimStart: 0, trimEnd: 4 });

describe('setAudioClipWarp', () => {
  it('ON → loop + warp + stretch (WSOLA lock to grid)', () => {
    const s = sample(); setAudioClipWarp(s, true);
    expect(s.mode).toBe('loop'); expect(s.warp).toBe(true); expect(s.warpMode).toBe('stretch');
  });
  it('OFF → song + warp false (native playback)', () => {
    const s = sample(); setAudioClipWarp(s, true); setAudioClipWarp(s, false);
    expect(s.mode).toBe('song'); expect(s.warp).toBe(false);
  });
});
