import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { LFOVoice } from './lfo-voice';
import { makeDefaultLFO } from '../plugins/modulators/lfo';

// Regression test for the silent 'saw' bug (design §2.7). Assigning an
// invalid OscillatorNode.type value does NOT throw — it is ignored, so the
// oscillator keeps whatever shape it already had. Our waveform vocabulary
// says 'saw'; the Web Audio enum says 'sawtooth'. The old `as OscillatorType`
// cast let 'saw' reach osc.type verbatim, so choosing Saw produced a real
// sawtooth in the worklet but silently kept the PREVIOUS shape on this
// Web-Audio path (the one that modulates FX params) — never a sawtooth here.
//
// LFOVoice has TWO places that push a waveform into osc.type: the initial
// build (createOsc, at construction) and the live push (syncFromState, when
// a knob or preset changes state mid-playback). Either one missing the
// mapping reproduces the bug, so both are exercised here.
function oscTypeOf(voice: LFOVoice): OscillatorType {
  return (voice as unknown as { osc: OscillatorNode }).osc.type;
}

describe("LFOVoice — 'saw' maps onto the Web Audio 'sawtooth'", () => {
  it('createOsc: a voice built with waveform "saw" starts as a real sawtooth', () => {
    const ctx = new AudioContext();
    const state = makeDefaultLFO('lfo1');
    state.waveform = 'saw';
    const voice = new LFOVoice(ctx, state, () => 120);
    expect(oscTypeOf(voice)).toBe('sawtooth');
    voice.dispose();
  });

  it('syncFromState: switching a live voice to "saw" pushes a real sawtooth', () => {
    const ctx = new AudioContext();
    const state = makeDefaultLFO('lfo1');
    state.waveform = 'sine';
    const voice = new LFOVoice(ctx, state, () => 120);
    expect(oscTypeOf(voice)).toBe('sine');

    // If the mapping is missing here, the invalid 'saw' assignment is
    // ignored and osc.type silently stays 'sine' — the exact bug.
    state.waveform = 'saw';
    voice.syncFromState();
    expect(oscTypeOf(voice)).toBe('sawtooth');
    voice.dispose();
  });
});
