import { describe, it, expect } from 'vitest';
// makeDefaultLFO/makeDefaultADSR moved out of types.ts into the components
// that own them (Task 5) — importing either also registers 'lfo'/'adsr' with
// the modulator-registry as a side effect, which the third test below reads.
import { makeDefaultLFO } from '../plugins/modulators/lfo';
import { makeDefaultADSR } from '../plugins/modulators/adsr';
import { getModulator } from './modulator-registry';

describe('ModulatorScope defaults', () => {
  it('makeDefaultLFO has scope="shared"', () => {
    expect(makeDefaultLFO('lfo1').scope).toBe('shared');
  });

  it('makeDefaultADSR has scope="per-voice"', () => {
    expect(makeDefaultADSR('adsr1').scope).toBe('per-voice');
  });

  it('a modulator component\'s default scope is its FIRST declared scope (no separate defaultScopeFor)', () => {
    expect(getModulator('lfo')!.scopes[0]).toBe('shared');
    expect(getModulator('adsr')!.scopes[0]).toBe('per-voice');
  });
});
