import { describe, it, expect } from 'vitest';
import { ModulationHostImpl } from './modulation-host';
import { registerModulator } from './modulator-registry';
import type { ModulatorComponent } from './modulator-registry';
import type { ModulatorState, ModulatorVoice } from './types';
// Side-effect only: registers the 'lfo'/'adsr' components. Vitest isolates
// modules per file, so this file must import them itself for addModulator/
// spawnVoiceFiltered (both registry-driven now) to see 'lfo'/'adsr' at all.
import { makeDefaultLFO } from '../plugins/modulators/lfo';
import { makeDefaultADSR } from '../plugins/modulators/adsr';

describe('ModulationHostImpl', () => {
  it('starts empty with no defaults', () => {
    const h = new ModulationHostImpl([]);
    expect(h.modulators).toEqual([]);
  });

  it('seeds from provided defaults', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1'), makeDefaultADSR('adsr1')]);
    expect(h.modulators).toHaveLength(2);
    expect(h.modulators[0].id).toBe('lfo1');
    expect(h.modulators[1].kind).toBe('adsr');
  });

  it('addModulator picks the next free id (lfo1 → lfo2 → lfo3)', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1')]);
    h.addModulator('lfo');
    h.addModulator('lfo');
    expect(h.modulators.map(m => m.id)).toEqual(['lfo1', 'lfo2', 'lfo3']);
  });

  it('addModulator assigns kind-specific defaults', () => {
    const h = new ModulationHostImpl([]);
    const lfo = h.addModulator('lfo');
    const adsr = h.addModulator('adsr');
    expect(lfo.rateHz).toBeDefined();
    expect(lfo.waveform).toBeDefined();
    expect(adsr.attackSec).toBeDefined();
    expect(adsr.releaseSec).toBeDefined();
  });

  it('removeModulator drops by id', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1'), makeDefaultLFO('lfo2')]);
    h.removeModulator('lfo1');
    expect(h.modulators.map(m => m.id)).toEqual(['lfo2']);
  });

  it('setConnection adds a new connection or replaces an existing one by id', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1')]);
    h.setConnection('lfo1', { id: 'c1', paramId: 'cutoff', depth: 0.5 });
    h.setConnection('lfo1', { id: 'c2', paramId: 'pitch',  depth: 0.1 });
    expect(h.modulators[0].connections).toHaveLength(2);
    h.setConnection('lfo1', { id: 'c1', paramId: 'cutoff', depth: 0.9 });
    expect(h.modulators[0].connections.find(c => c.id === 'c1')?.depth).toBe(0.9);
  });

  it('removeConnection drops by connection id', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1')]);
    h.setConnection('lfo1', { id: 'c1', paramId: 'cutoff', depth: 0.5 });
    h.setConnection('lfo1', { id: 'c2', paramId: 'pitch',  depth: 0.1 });
    h.removeConnection('lfo1', 'c1');
    expect(h.modulators[0].connections.map(c => c.id)).toEqual(['c2']);
  });

  it('serialize/deserialize round-trips', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1'), makeDefaultADSR('adsr1')]);
    h.setConnection('lfo1', { id: 'c1', paramId: 'cutoff', depth: 0.5 });
    const snapshot = h.serialize();
    const h2 = new ModulationHostImpl([]);
    h2.deserialize(snapshot);
    expect(h2.modulators).toEqual(snapshot);
  });

  // A fake THIRD kind, registered here (not at module scope) — vitest
  // isolates modules per file, so this file's registry already holds only
  // 'lfo'/'adsr' (from the side-effect imports above) plus whatever this
  // test file itself registers. Adding 'sh' does not disturb either real
  // component, so no teardown/reset is needed.
  const shStub: ModulatorComponent = {
    id: 'sh', name: 'S&H', driver: 'time', scopes: ['shared', 'per-voice'], idPrefix: 'sh',
    defaultState: (id): ModulatorState => ({ id, kind: 'sh', enabled: true, connections: [], scope: 'shared' }),
    createVoice: (): ModulatorVoice => ({
      output: {} as AudioNode, trigger: () => {}, release: () => {}, dispose: () => {}, currentValue: () => 0,
    }),
  };
  registerModulator(shStub);

  describe('addModulator reads the registry — any kind, not just lfo/adsr', () => {
    it('adds a modulator of any registered kind, not just lfo and adsr', () => {
      const host = new ModulationHostImpl([]);
      const fresh = host.addModulator('sh');
      expect(fresh.kind).toBe('sh');
      expect(fresh.id).toBe('sh1');
      expect(fresh.scope).toBe('shared');   // the first declared scope
    });

    it('refuses an unregistered kind instead of inventing an ADSR', () => {
      const host = new ModulationHostImpl([]);
      expect(() => host.addModulator('nope')).toThrow();
    });
  });

  describe('ModulationHostImpl.spawnVoiceFiltered', () => {
    it('only spawns modulators matching the predicate', () => {
      const host = new ModulationHostImpl([
        { id: 'lfo1',  kind: 'lfo',  enabled: true, connections: [], scope: 'shared'    },
        { id: 'adsr1', kind: 'adsr', enabled: true, connections: [], scope: 'per-voice' },
        { id: 'lfo2',  kind: 'lfo',  enabled: true, connections: [], scope: 'per-voice' },
      ]);
      const captured: string[] = [];
      const fakeCtx = {} as unknown as AudioContext;
      host.spawnVoiceFiltered(fakeCtx, () => 120, (m) => {
        captured.push(m.id);
        return false;  // returning false → no actual voices constructed
      });
      expect(captured).toEqual(['lfo1', 'adsr1', 'lfo2']);
    });
  });
});
