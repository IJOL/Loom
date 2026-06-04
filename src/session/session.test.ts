import { describe, it, expect } from 'vitest';
import { audioClip, cloneSessionState } from './session';

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

describe('engineState.kitMode persistence', () => {
  it('round-trips kitMode through cloneSessionState', () => {
    const state = {
      lanes: [{ id: 'drums-1', engineId: 'drums-machine', clips: [], engineState: { kitMode: 'sample' as const } }],
      scenes: [],
      globalQuantize: 'immediate' as const,
    };
    const clone = cloneSessionState(state);
    expect(clone.lanes[0].engineState?.kitMode).toBe('sample');
  });
});
