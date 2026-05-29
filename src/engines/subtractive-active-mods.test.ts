import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { SubtractiveEngine } from './subtractive';
import { PolySynth } from '../polysynth/polysynth';
import {
  setCurrentLaneForVoice,
  getActiveModVoice,
} from '../modulation/active-mods';

// Regression: the rAF modulation tick uses getActiveModVoice(laneId, modId)
// to find the voice it should poll via currentValue() (which now also syncs
// the live OscillatorNode to state mutations as a side-effect). Before this
// fix, poly engines only recorded their PER-VOICE mods in active-mods —
// the engine-shared LFOVoice (the one that actually drives the audio for
// scope='shared' modulators) was invisible to the tick, so its osc.frequency
// never tracked rate-knob changes.

describe('SubtractiveEngine — shared modulators are registered in active-mods', () => {
  it('getActiveModVoice returns the engine-shared LFO after createVoice', () => {
    const engine = new SubtractiveEngine();
    const ctx = new AudioContext();
    engine.setPolySynth(new PolySynth(ctx, ctx.destination));
    setCurrentLaneForVoice('subtractive-1');
    engine.createVoice(ctx, ctx.destination);
    setCurrentLaneForVoice(null);
    // The default LFO lives in engineModVoices (scope='shared'). It must be
    // reachable via getActiveModVoice so the rAF tick can poll currentValue
    // and keep the audio oscillator in sync with state mutations.
    const lfo = getActiveModVoice('subtractive-1', 'lfo1');
    expect(lfo).toBeDefined();
  });
});
