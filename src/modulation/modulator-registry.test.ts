// src/modulation/modulator-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerModulator, getModulator, listModulators, __resetModulators,
} from './modulator-registry';

const stub = (id: string) => ({
  id, name: id.toUpperCase(), driver: 'time' as const,
  scopes: ['shared' as const, 'per-voice' as const],
  idPrefix: id,
  defaultState: (instanceId: string) => ({
    id: instanceId, kind: id, enabled: true, connections: [], scope: 'shared' as const,
  }),
  createVoice: () => { throw new Error('not used in this test'); },
});

describe('modulator registry', () => {
  beforeEach(() => __resetModulators());

  it('answers a registered component by id', () => {
    registerModulator(stub('sh'));
    expect(getModulator('sh')?.name).toBe('SH');
  });

  it('answers undefined for an unknown id instead of guessing', () => {
    expect(getModulator('nope')).toBeUndefined();
  });

  it('lists components in registration order', () => {
    registerModulator(stub('a'));
    registerModulator(stub('b'));
    expect(listModulators().map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('the first declared scope is the default — there is no defaultScope field', () => {
    registerModulator(stub('sh'));
    expect(getModulator('sh')!.scopes[0]).toBe('shared');
  });
});
