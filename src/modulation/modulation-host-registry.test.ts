import { describe, it, expect, afterEach } from 'vitest';
import '../../test/setup';
import { ModulationHostImpl } from './modulation-host';
import { makeDefaultLFO } from './types';
import { LFOVoice } from './lfo-voice';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { lfoPlugin } from '../plugins/modulators/lfo';

// Regression for "LFO rate/on-off do nothing in the app, but work in tests":
//
// In the browser the plugin registry IS bootstrapped, so spawnVoiceFiltered
// took the registry path and wrapped the instance in a stateless stub
// (currentValue: () => 0, no osc, no state, no syncFromState). That stub:
//   - never reflects mod.rateHz / waveform edits (its LFOVoice used a
//     throwaway 'lfo-tmp' state), and
//   - makes the rAF tick read 0, so the knob ring froze.
// In unit tests the registry is empty, so it fell back to `new LFOVoice(ctx, m)`
// (correct) and the bug was invisible. This test registers the real plugin —
// matching the app — and asserts the spawned voice is wired to the live state.

describe('ModulationHostImpl.spawnVoice with the LFO plugin registered (app parity)', () => {
  afterEach(() => { _resetRegistry(); });

  it('spawns a state-connected LFOVoice (rate edits reach the oscillator)', () => {
    registerPlugin(lfoPlugin); // app bootstraps this; tests normally don't

    const state = makeDefaultLFO('lfo1');
    state.scope = 'shared';
    state.rateHz = 7;
    const host = new ModulationHostImpl([state]);

    const ctx = new AudioContext();
    const voices = host.spawnVoice(ctx, () => 120);
    const voice = voices.get('lfo1');
    expect(voice).toBeDefined();

    // The voice must be the real LFOVoice bound to `state`, not the stub.
    expect(voice).toBeInstanceOf(LFOVoice);

    const osc = (voice as unknown as { osc: OscillatorNode }).osc;
    expect(osc).toBeDefined();
    // Constructed from the live state's rate (7 Hz), not the plugin's
    // throwaway default (4 Hz).
    expect(osc.frequency.value).toBeCloseTo(7, 3);

    // Mutating the state and polling (what the rAF tick does) must propagate.
    state.rateHz = 0.5;
    voice!.currentValue();
    expect(osc.frequency.value).toBeCloseTo(0.5, 3);
  });
});
