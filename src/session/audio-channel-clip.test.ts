// src/session/audio-channel-clip.test.ts
import { describe, it, expect } from 'vitest';
import { audioChannelClip } from './session';

const METER = { num: 4, den: 4 } as const;

describe('audioChannelClip — anchor + warp', () => {
  it('default (warp omitted) stays loop+stretch — unchanged for the +Audio channel', () => {
    const c = audioChannelClip({ name: 'd', sampleId: 's', durationSec: 8, originalBpm: 120, projectMeter: METER });
    expect(c.sample!.mode).toBe('loop');
    expect(c.sample!.warp).toBe(true);
    expect(c.sample!.warpMode).toBe('stretch');
    expect(c.sample!.trimStart).toBe(0);
    expect(c.lengthBars).toBe(4); // 8 s @120 BPM (barSec 2) = 4 bars
  });

  it('warp:false → native song clip (no varispeed, no stretch)', () => {
    const c = audioChannelClip({ name: 'd', sampleId: 's', durationSec: 8, originalBpm: 120, projectMeter: METER, warp: false });
    expect(c.sample!.mode).toBe('song');
    expect(c.sample!.warp).toBe(false);
  });

  it('anchorSec sets trimStart and shortens lengthBars to the post-anchor whole bars', () => {
    // 8 s @120 (barSec 2). Anchor 2 s → 6 s left = 3 whole bars.
    const c = audioChannelClip({ name: 'd', sampleId: 's', durationSec: 8, originalBpm: 120, projectMeter: METER, warp: false, anchorSec: 2 });
    expect(c.sample!.trimStart).toBe(2);
    expect(c.sample!.trimEnd).toBe(8);
    expect(c.lengthBars).toBe(3);
  });
});
