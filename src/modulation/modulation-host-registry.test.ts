import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { ModulationHostImpl } from './modulation-host';
import { makeDefaultLFO } from '../plugins/modulators/lfo';

// Regression for "LFO rate/on-off do nothing in the app, but work in tests":
//
// Before Task 5, spawnVoiceFiltered special-cased 'lfo'/'adsr' with `new
// LFOVoice(ctx, m, bpm)` (correct, state-connected) and fell back to the
// OLD plugin SPI (plugins/registry.ts's createInstance) for anything else —
// a stateless stub whose currentValue() always read 0 and never reflected a
// rate/waveform edit. In the browser the plugin registry WAS bootstrapped
// (registerPlugin(lfoPlugin) ran at boot), so a real LFO modulator took that
// dead-stub path there while unit tests (empty plugin registry) took the
// correct one — invisible in the suite, dead knobs in the app.
//
// Since Task 5, spawnVoiceFiltered ALWAYS asks the modulator-registry
// component (getModulator(m.kind).createVoice(ctx, { state: m, bpm })) —
// there is no second, stub-producing path left to fall into, for 'lfo' or
// any other kind. This test pins that: the registry-driven voice is
// constructed from the host's LIVE state object, so an edit to it reaches
// the running oscillator.
describe('ModulationHostImpl.spawnVoice via the modulator-registry component', () => {
  it('spawns a state-connected LFOVoice (rate edits reach the oscillator)', () => {
    const state = makeDefaultLFO('lfo1');
    state.scope = 'shared';
    state.rateHz = 7;
    const host = new ModulationHostImpl([state]);

    const ctx = new AudioContext();
    const voices = host.spawnVoice(ctx, () => 120);
    const voice = voices.get('lfo1');
    expect(voice).toBeDefined();

    // Assert the BEHAVIOURAL contract, not `instanceof` (brittle here: Vitest
    // can load lfo-voice.ts twice across the serial test process, so the
    // constructor identity differs even for a genuine LFOVoice).
    const v = voice as unknown as { osc?: OscillatorNode; syncFromState?: () => void };
    expect(typeof v.syncFromState).toBe('function');   // real LFOVoice, not a stub
    expect(v.osc).toBeDefined();
    // Constructed from the live state's rate (7 Hz), not some throwaway default.
    expect(v.osc!.frequency.value).toBeCloseTo(7, 3);

    // Mutating the modulator the host owns (what the rate knob does) and
    // polling (what the rAF tick does) must propagate to the oscillator.
    // Note: the host clones its defaults, so the live modulator is
    // host.modulators[0], not the `state` object passed to the constructor.
    host.modulators[0].rateHz = 0.5;
    voice!.currentValue();
    expect(v.osc!.frequency.value).toBeCloseTo(0.5, 3);
  });
});
