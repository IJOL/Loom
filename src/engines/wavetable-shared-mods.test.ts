import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('WavetableEngine — shared modulator voices', () => {
  it('createVoice reuses the same engineModVoices across calls', async () => {
    const { WavetableEngine } = await import('./wavetable');
    const engine = new WavetableEngine();
    const ctx = new AudioContext();
    setCurrentLaneForVoice('subtractive-2');
    engine.createVoice(ctx, ctx.destination);
    const first = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    engine.createVoice(ctx, ctx.destination);
    const second = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    setCurrentLaneForVoice(null);
    expect(first).toBeTruthy();
    expect(first).toBe(second);
  });
});
