import { describe, it, expect } from 'vitest';
import { audioChannelClip } from './session';
import { DEFAULT_METER } from '../core/meter';

describe('audioChannelClip', () => {
  it('builds a warp:stretch loop clip with bar-count length and no notes', () => {
    // 120 BPM, 4/4 → one bar = 2s. A 4s loop = 2 bars.
    const clip = audioChannelClip({
      name: 'beat', sampleId: 'smp-x', durationSec: 4, originalBpm: 120, projectMeter: DEFAULT_METER,
    });
    expect(clip.notes).toEqual([]);
    expect(clip.lengthBars).toBe(2);
    expect(clip.sample?.mode).toBe('loop');
    expect(clip.sample?.warp).toBe(true);
    expect(clip.sample?.warpMode).toBe('stretch');
    expect(clip.sample?.originalBpm).toBe(120);
    expect(clip.sample?.trimStart).toBe(0);
    expect(clip.sample?.trimEnd).toBe(4);
  });
});
