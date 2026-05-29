import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { SubtractiveEngine } from './subtractive';
import { PolySynth } from '../polysynth/polysynth';
import {
  setCurrentLaneForVoice,
  getActiveModVoice,
} from '../modulation/active-mods';
import type { LFOVoice } from '../modulation/lfo-voice';

// Full-stack regression for "LFO rate knob doesn't change the audio":
//
// 1. SubtractiveEngine creates a voice → engineModVoices populated.
// 2. recordVoiceMods records BOTH engine-shared + per-voice mods in
//    active-mods, so the rAF tick can find the shared LFO via
//    getActiveModVoice('subtractive-1', 'lfo1').
// 3. The rAF tick calls voice.currentValue() on each connection — that's
//    the only place that, today, can push state mutations into the live
//    OscillatorNode (LFOVoice.currentValue() has a syncFromState side
//    effect).
// 4. Mutating mod.rateHz mid-flight must therefore propagate to the audio
//    on the next rAF tick.
//
// This test simulates step 3 explicitly by calling currentValue() ourselves;
// the browser does the same thing from inside automation-tick.

describe('SubtractiveEngine — LFO rate change propagates to audio', () => {
  it('mutating mod.rateHz changes osc.frequency on the next currentValue() poll', () => {
    const engine = new SubtractiveEngine();
    const ctx = new AudioContext();
    engine.setPolySynth(new PolySynth(ctx, ctx.destination));
    setCurrentLaneForVoice('subtractive-1');
    engine.createVoice(ctx, ctx.destination);
    setCurrentLaneForVoice(null);

    // Locate the shared LFO via active-mods (same path the rAF tick uses).
    const lfo = getActiveModVoice('subtractive-1', 'lfo1') as LFOVoice | undefined;
    expect(lfo).toBeDefined();

    const osc = (lfo as unknown as { osc: OscillatorNode }).osc;
    const initialRate = osc.frequency.value;

    // Mutate the underlying state — same thing the UI knob does on drag.
    const lfoState = engine.modulators.modulators.find((m) => m.id === 'lfo1')!;
    expect(lfoState.rateHz).toBe(initialRate);
    lfoState.rateHz = 0.5;

    // Simulate ONE rAF poll (what automation-tick does each frame).
    lfo!.currentValue();

    // After the poll, the live OscillatorNode must reflect the new rate.
    expect(osc.frequency.value).toBeCloseTo(0.5, 3);
  });

  it('switching LFO waveform propagates on the next poll', () => {
    const engine = new SubtractiveEngine();
    const ctx = new AudioContext();
    engine.setPolySynth(new PolySynth(ctx, ctx.destination));
    setCurrentLaneForVoice('subtractive-1');
    engine.createVoice(ctx, ctx.destination);
    setCurrentLaneForVoice(null);

    const lfo = getActiveModVoice('subtractive-1', 'lfo1') as LFOVoice;
    const osc = (lfo as unknown as { osc: OscillatorNode }).osc;
    const lfoState = engine.modulators.modulators.find((m) => m.id === 'lfo1')!;

    expect(osc.type).toBe('sine');
    lfoState.waveform = 'square';
    lfo.currentValue();
    expect(osc.type).toBe('square');
  });
});
