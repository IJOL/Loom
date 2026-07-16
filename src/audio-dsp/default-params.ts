import type { SubParams } from './types';

/** Default subtractive parameter snapshot. Used by both loom-node (main thread)
 *  and loom-processor (AudioWorklet) — lives here so neither imports the other. */
export function defaultSubParams(): SubParams {
  return {
    masterTune: 0,
    // 1 voice ⇒ the stack is a single oscillator at unity gain, so the detune
    // spread below is inert and every existing preset is untouched.
    unisonVoices: 1, unisonDetune: 25, unisonDrift: 0,
    osc1Wave: 0, osc1Level: 0.6, osc1Detune: 0, osc1Pw: 0.5,
    osc2Wave: 1, osc2Level: 0.4, osc2Detune: 7, osc2Pw: 0.5,
    subLevel: 0.3, noiseLevel: 0, noiseColor: 0.6,
    filterModel: 0, filterType: 0, filterCutoff: 0.55, filterResonance: 0.25, filterEnvAmount: 0.45,
    filterDrive: 0, filterKeyTrack: 0, filterBuiltinEnv: 1,
    filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0.4, filterRelease: 0.35,
    ampBuiltinEnv: 1, ampAttack: 0.01, ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.3,
  };
}
