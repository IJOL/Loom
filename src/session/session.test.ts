import { describe, it, expect } from 'vitest';
import { emptyScene, audioClip, type SessionScene } from './session';

describe('SessionScene.presetPerLane', () => {
  it('is undefined by default on an empty scene', () => {
    const s = emptyScene('Scene 1');
    expect(s.presetPerLane).toBeUndefined();
  });

  it('accepts a laneId → preset-name map when set', () => {
    const s: SessionScene = {
      ...emptyScene('Scene 1'),
      presetPerLane: { 'subtractive-1': 'factory:PAD Warm' },
    };
    expect(s.presetPerLane?.['subtractive-1']).toBe('factory:PAD Warm');
  });
});

describe('audioClip', () => {
  it('carries clip.sample, empty notes, and derives lengthBars from duration/bpm', () => {
    // 4s at 120bpm: a bar = 4*60/120 = 2s → 4s ≈ 2 bars.
    const c = audioClip({ name: 'amen', sampleId: 'smp-1', durationSec: 4, bpm: 120 });
    expect(c.lengthBars).toBe(2);
    expect(c.notes).toEqual([]);
    expect(c.sample).toEqual({ sampleId: 'smp-1', mode: 'loop', trimStart: 0, trimEnd: 4 });
    expect(c.name).toBe('amen');
  });

  it('clamps lengthBars to at least 1 for short samples and honors mode', () => {
    const c = audioClip({ name: 'stab', sampleId: 'smp-2', durationSec: 0.2, bpm: 120, mode: 'song' });
    expect(c.lengthBars).toBe(1);
    expect(c.sample?.mode).toBe('song');
  });
});
