import { describe, it, expect } from 'vitest';
import { ModulationHostImpl } from './modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from './types';

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
});
