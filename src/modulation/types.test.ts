import { describe, it, expect } from 'vitest';
import {
  makeDefaultLFO, makeDefaultADSR, normalizeModulator,
  defaultScopeFor, type ModulatorState,
} from './types';

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

  it('normalizeModulator fills in missing scope based on kind', () => {
    const oldLfo: ModulatorState = {
      id: 'lfo1', kind: 'lfo', enabled: true, connections: [], rateHz: 4,
    };
    expect(normalizeModulator(oldLfo).scope).toBe('shared');

    const oldAdsr: ModulatorState = {
      id: 'a1', kind: 'adsr', enabled: true, connections: [], attackSec: 0.01,
    };
    expect(normalizeModulator(oldAdsr).scope).toBe('per-voice');
  });

  it('normalizeModulator preserves explicit scope', () => {
    const m: ModulatorState = {
      id: 'lfo1', kind: 'lfo', enabled: true, connections: [], scope: 'per-voice',
    };
    expect(normalizeModulator(m).scope).toBe('per-voice');
  });
});
