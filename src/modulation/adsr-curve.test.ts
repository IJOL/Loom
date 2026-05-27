import { describe, it, expect } from 'vitest';
import { computeAdsrAt } from './adsr-curve';
import type { ModulatorState } from './types';

function adsr(partial: Partial<ModulatorState>): ModulatorState {
  return {
    id: 'adsr1', kind: 'adsr', enabled: true, connections: [],
    attackSec: 0.1, decaySec: 0.2, sustain: 0.5, releaseSec: 0.3,
    ...partial,
  };
}

describe('computeAdsrAt — long gate (gate >= attack+decay)', () => {
  const env = adsr({});
  const gate = 1.0;

  it('t=0 → 0 (start of attack)', () => {
    expect(computeAdsrAt(0, env, gate)).toBeCloseTo(0, 5);
  });
  it('t=attack/2 → 0.5 (mid-attack, linear)', () => {
    expect(computeAdsrAt(0.05, env, gate)).toBeCloseTo(0.5, 5);
  });
  it('t=attack → 1 (peak)', () => {
    expect(computeAdsrAt(0.1, env, gate)).toBeCloseTo(1, 5);
  });
  it('t=attack+decay/2 → between 1 and sustain', () => {
    expect(computeAdsrAt(0.2, env, gate)).toBeCloseTo(0.75, 5);
  });
  it('t=attack+decay → sustain (0.5)', () => {
    expect(computeAdsrAt(0.3, env, gate)).toBeCloseTo(0.5, 5);
  });
  it('t=sustain mid-hold → sustain', () => {
    expect(computeAdsrAt(0.7, env, gate)).toBeCloseTo(0.5, 5);
  });
  it('t=gate (release start) → sustain', () => {
    expect(computeAdsrAt(1.0, env, gate)).toBeCloseTo(0.5, 5);
  });
  it('t=gate+release/2 → between sustain and 0', () => {
    expect(computeAdsrAt(1.15, env, gate)).toBeCloseTo(0.25, 5);
  });
  it('t >> gate+release → 0', () => {
    expect(computeAdsrAt(5, env, gate)).toBe(0);
  });
});

describe('computeAdsrAt — short gate (gate < attack+decay)', () => {
  it('release starts at attack+decay even if gate is shorter', () => {
    const env = adsr({ attackSec: 0.1, decaySec: 0.2, sustain: 0.5, releaseSec: 0.1 });
    const gate = 0.05;
    expect(computeAdsrAt(0.3, env, gate)).toBeCloseTo(0.5, 5);
    expect(computeAdsrAt(0.35, env, gate)).toBeCloseTo(0.25, 5);
  });
});
