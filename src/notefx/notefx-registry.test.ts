// src/notefx/notefx-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getNoteFxChain, loadNoteFxForLane, _resetNoteFxRegistry } from './notefx-registry';

describe('notefx-registry', () => {
  beforeEach(() => { _resetNoteFxRegistry(); });

  it('getNoteFxChain returns the same instance per lane', () => {
    const a = getNoteFxChain('sub-1');
    const b = getNoteFxChain('sub-1');
    expect(a).toBe(b);
    expect(getNoteFxChain('sub-2')).not.toBe(a);
  });

  it('loadNoteFxForLane replaces the chain contents from saved state (the demo-load fix)', () => {
    const chain = getNoteFxChain('sub-1');
    chain.addNoteFx('arp');
    loadNoteFxForLane('sub-1', [{ id: 'chord1', kind: 'chord', enabled: true, params: { chordType: 'maj', octave: 0 } }]);
    expect(getNoteFxChain('sub-1').serialize().map((s) => s.id)).toEqual(['chord1']);
  });

  it('loadNoteFxForLane with undefined clears the chain (passthrough)', () => {
    const chain = getNoteFxChain('sub-1');
    chain.addNoteFx('arp');
    loadNoteFxForLane('sub-1', undefined);
    expect(getNoteFxChain('sub-1').serialize()).toEqual([]);
  });
});
