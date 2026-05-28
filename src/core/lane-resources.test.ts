import { describe, it, expect } from 'vitest';
import { LaneResourceMap } from './lane-resources';

describe('LaneResourceMap', () => {
  it('allocates and retrieves resources by laneId', () => {
    const m = new LaneResourceMap();
    const stripStub = { dispose: () => {} } as unknown as import('./fx').ChannelStrip;
    const engineStub = { dispose: () => {} } as unknown as import('../engines/engine-types').SynthEngine;
    m.set('subtractive-1', { strip: stripStub, engine: engineStub });
    expect(m.get('subtractive-1')?.engine).toBe(engineStub);
  });

  it('dispose() tears down strip and engine', () => {
    const m = new LaneResourceMap();
    let stripDisposed = false;
    let engineDisposed = false;
    m.set('a', {
      strip:  { dispose: () => { stripDisposed = true; } } as unknown as import('./fx').ChannelStrip,
      engine: { dispose: () => { engineDisposed = true; } } as unknown as import('../engines/engine-types').SynthEngine,
    });
    m.dispose('a');
    expect(stripDisposed).toBe(true);
    expect(engineDisposed).toBe(true);
    expect(m.get('a')).toBeUndefined();
  });
});
