// src/notefx/notefx-chain.test.ts
import { describe, it, expect } from 'vitest';
import { NoteFxChain } from './notefx-chain';
import type { NoteFxEvent } from './notefx-types';

const root = (): NoteFxEvent[] => [{ note: 60, time: 0, gate: 1.0, accent: true }];

describe('NoteFxChain', () => {
  it('empty chain is passthrough', () => {
    const chain = new NoteFxChain([]);
    expect(chain.process(root(), { bpm: 120 })).toEqual(root());
  });

  it('addNoteFx assigns kind-prefixed unique ids', () => {
    const chain = new NoteFxChain([]);
    const a = chain.addNoteFx('arp');
    const b = chain.addNoteFx('chord');
    const c = chain.addNoteFx('arp');
    expect([a.id, b.id, c.id]).toEqual(['arp1', 'chord1', 'arp2']);
  });

  it('applies in order of addition: chord then arp arpeggiates the chord', () => {
    const chain = new NoteFxChain([]);
    const chord = chain.addNoteFx('chord');     // maj triad by default
    chord.params = { chordType: 'maj', octave: 0 };
    const arp = chain.addNoteFx('arp');
    arp.params = { pattern: 'up', scale: 'chromatic', octaves: 1, rate: 'free', rateFreeHz: 10, gate: 0.5 };
    const out = chain.process(root(), { bpm: 120 });
    // chord makes 3 notes; arp expands each across the 1s gate → many notes
    expect(out.length).toBeGreaterThan(3);
  });

  it('disabled note-FX are skipped', () => {
    const chain = new NoteFxChain([]);
    const chord = chain.addNoteFx('chord');
    chord.enabled = false;
    expect(chain.process(root(), { bpm: 120 })).toEqual(root());
  });

  it('removeNoteFx drops by id; serialize/deserialize round-trips', () => {
    const chain = new NoteFxChain([]);
    chain.addNoteFx('arp');
    const chord = chain.addNoteFx('chord');
    chain.removeNoteFx('arp1');
    expect(chain.serialize().map((s) => s.id)).toEqual(['chord1']);
    const chain2 = new NoteFxChain([]);
    chain2.deserialize(chain.serialize());
    expect(chain2.serialize()).toEqual([{ ...chord }]);
  });
});
