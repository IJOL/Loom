import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { SubtractiveEngine } from './subtractive';
import { PolySynth } from '../polysynth/polysynth';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('SubtractiveEngine — shared modulator voices', () => {
  it('createVoice reuses the same engineModVoices across calls', () => {
    const engine = new SubtractiveEngine();
    const ctx = new AudioContext();
    engine.setPolySynth(new PolySynth(ctx, ctx.destination));
    setCurrentLaneForVoice('subtractive-1');
    engine.createVoice(ctx, ctx.destination);
    const first = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    engine.createVoice(ctx, ctx.destination);
    const second = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    setCurrentLaneForVoice(null);
    expect(first).toBe(second);
    expect(first).toBeDefined();
  });

  it('getSharedAudioParams returns the PolySynth modBus offsets', () => {
    const engine = new SubtractiveEngine();
    const ctx = new AudioContext();
    const ps = new PolySynth(ctx, ctx.destination);
    engine.setPolySynth(ps);
    const shared = engine.getSharedAudioParams?.(ctx) ?? new Map();
    expect(shared.get('filter.cutoff')).toBe(ps.modBus['filter.cutoff'].offset);
    expect(shared.get('filter.resonance')).toBe(ps.modBus['filter.resonance'].offset);
    expect(shared.get('amp.gain')).toBe(ps.modBus['amp.gain'].offset);
  });
});
