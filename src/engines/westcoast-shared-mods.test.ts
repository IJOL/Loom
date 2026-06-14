// src/engines/westcoast-shared-mods.test.ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { WestEngine } from './westcoast';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('WestEngine — shared modulators + modBus', () => {
  it('createVoice reuses the same engineModVoices across calls', () => {
    const engine = new WestEngine();
    const ctx = new AudioContext();
    setCurrentLaneForVoice('westcoast-1');
    engine.createVoice(ctx, ctx.destination);
    const first = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    engine.createVoice(ctx, ctx.destination);
    const second = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    setCurrentLaneForVoice(null);
    expect(first).toBe(second);
    expect(first).toBeDefined();
  });

  it('getSharedAudioParams returns the modBus offsets after first createVoice', () => {
    const engine = new WestEngine();
    const ctx = new AudioContext();
    engine.createVoice(ctx, ctx.destination);
    const shared = engine.getSharedAudioParams?.(ctx) ?? new Map();
    expect(shared.get('lpg.cutoff')).toBeDefined();
    expect(shared.get('lpg.resonance')).toBeDefined();
    expect(shared.get('amp.gain')).toBeDefined();
    expect(shared.get('timbre.fold')).toBeDefined();
  });

  it('a voice exposes the modulatable AudioParams', () => {
    const engine = new WestEngine();
    const ctx = new AudioContext();
    const voice = engine.createVoice(ctx, ctx.destination);
    const params = voice.getAudioParams();
    for (const id of ['amp.gain', 'lpg.cutoff', 'lpg.resonance', 'timbre.fold', 'osc.fmIndex']) {
      expect(params.get(id), `missing ${id}`).toBeDefined();
    }
  });
});
