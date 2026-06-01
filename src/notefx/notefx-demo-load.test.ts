// src/notefx/notefx-demo-load.test.ts
// Regression: the arp kept the first demo's configuration. Note-FX now live
// in lane.engineState and load per demo via loadNoteFxForLane.
import { describe, it, expect, beforeEach } from 'vitest';
import { getNoteFxChain, loadNoteFxForLane, _resetNoteFxRegistry } from './notefx-registry';
import type { NoteFxState } from './notefx-types';

const demoA: NoteFxState[] = [{ id: 'arp1', kind: 'arp', enabled: true, params: { octaves: 3 } }];
const demoB: NoteFxState[] = [{ id: 'chord1', kind: 'chord', enabled: true, params: { chordType: 'min7', octave: 0 } }];

describe('note-FX follow demo loads', () => {
  beforeEach(() => { _resetNoteFxRegistry(); });

  it('loading demo A then demo B replaces the chain (no stale config)', () => {
    loadNoteFxForLane('sub-1', demoA);
    expect(getNoteFxChain('sub-1').serialize()).toEqual(demoA);
    loadNoteFxForLane('sub-1', demoB);          // load a different demo
    expect(getNoteFxChain('sub-1').serialize()).toEqual(demoB);
  });

  it('loading a demo with no note-FX clears the lane (passthrough)', () => {
    loadNoteFxForLane('sub-1', demoA);
    loadNoteFxForLane('sub-1', undefined);
    expect(getNoteFxChain('sub-1').serialize()).toEqual([]);
  });
});
