import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/setup';
import { LFOVoice } from './lfo-voice';
import { makeDefaultLFO, type ModulatorState } from './types';

// Regression test for the "LFO rate doesn't take effect" bug. The LFO's
// OscillatorNode is constructed once with the initial state.rateHz; changing
// state.rateHz afterwards leaves the audio oscillator stuck at the old rate
// even though the visual knob arc (which uses currentValue()) reflects the
// new value. Same problem for waveform and sync settings — they're read at
// construction time and frozen.
//
// Fix: a `syncFromState()` method that pushes the current state into the
// live OscillatorNode (frequency + type), called whenever the state mutates.

describe('LFOVoice.syncFromState — live state propagation', () => {
  let ctx: AudioContext;
  let state: ModulatorState;
  let lfo: LFOVoice;

  beforeEach(() => {
    ctx = new AudioContext();
    state = makeDefaultLFO('lfo1');
    state.rateHz = 4;
    state.waveform = 'sine';
    state.syncToBpm = false;
    lfo = new LFOVoice(ctx, state, () => 120);
  });

  it('updates osc.frequency to match state.rateHz', () => {
    const osc = (lfo as unknown as { osc: OscillatorNode }).osc;
    expect(osc.frequency.value).toBeCloseTo(4, 2);
    state.rateHz = 0.5;
    lfo.syncFromState();
    expect(osc.frequency.value).toBeCloseTo(0.5, 2);
  });

  it('updates osc.type to match state.waveform', () => {
    const osc = (lfo as unknown as { osc: OscillatorNode }).osc;
    expect(osc.type).toBe('sine');
    state.waveform = 'square';
    lfo.syncFromState();
    expect(osc.type).toBe('square');
  });

  it('respects syncToBpm + syncBars', () => {
    const osc = (lfo as unknown as { osc: OscillatorNode }).osc;
    state.syncToBpm = true;
    state.syncBars = 0.25;
    lfo.syncFromState();
    // 120 BPM, 0.25 bars/cycle = one quarter-note = 0.5s, so 1 cycle / 0.5s = 2 Hz.
    expect(osc.frequency.value).toBeCloseTo(2, 1);
  });

  it('currentValue() pulls fresh rate as a side-effect so audio tracks state changes during playback', () => {
    const osc = (lfo as unknown as { osc: OscillatorNode }).osc;
    state.rateHz = 7;
    // currentValue is called every rAF frame by the modulation tick.
    lfo.currentValue();
    expect(osc.frequency.value).toBeCloseTo(7, 2);
  });
});
