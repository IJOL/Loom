import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('KarplusEngine — shared modulator voices', () => {
  it('createVoice reuses the same engineModVoices across calls', async () => {
    const { KarplusEngine } = await import('./karplus');
    const engine = new KarplusEngine();
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
