import { describe, it, expect } from 'vitest';
import { makeDefaultLFO, makeDefaultADSR, defaultScopeFor } from './types';

describe('ModulatorScope defaults', () => {
  it('makeDefaultLFO has scope="shared"', () => {
    expect(makeDefaultLFO('lfo1').scope).toBe('shared');
  });

  it('makeDefaultADSR has scope="per-voice"', () => {
    expect(makeDefaultADSR('adsr1').scope).toBe('per-voice');
  });

  it('defaultScopeFor maps kind → default scope', () => {
    expect(defaultScopeFor('lfo')).toBe('shared');
    expect(defaultScopeFor('adsr')).toBe('per-voice');
  });
});
