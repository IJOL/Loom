import { describe, it, expect, vi } from 'vitest';
import { LaneResourceMap } from './lane-resources';
import type { InsertChain } from '../plugins/fx/insert-chain';

describe('LaneResourceMap', () => {
  it('allocates and retrieves resources by laneId', () => {
    const m = new LaneResourceMap();
    const stripStub = { dispose: () => {} } as unknown as import('./fx').ChannelStrip;
    const engineStub = { dispose: () => {} } as unknown as import('../engines/engine-types').SynthEngine;
    const insertsStub = { dispose: () => {} } as unknown as InsertChain;
    m.set('subtractive-1', { strip: stripStub, engine: engineStub, inserts: insertsStub });
    expect(m.get('subtractive-1')?.engine).toBe(engineStub);
  });

  it('dispose() tears down strip and engine', () => {
    const m = new LaneResourceMap();
    let stripDisposed = false;
    let engineDisposed = false;
    m.set('a', {
      strip:  { dispose: () => { stripDisposed = true; } } as unknown as import('./fx').ChannelStrip,
      engine: { dispose: () => { engineDisposed = true; } } as unknown as import('../engines/engine-types').SynthEngine,
      inserts: { dispose: () => {} } as unknown as InsertChain,
    });
    m.dispose('a');
    expect(stripDisposed).toBe(true);
    expect(engineDisposed).toBe(true);
    expect(m.get('a')).toBeUndefined();
  });

  it('LaneResourceMap.dispose(id) calls inserts.dispose() in addition to strip/engine', () => {
    const m = new LaneResourceMap();
    const stripDispose  = vi.fn();
    const engineDispose = vi.fn();
    const insertsDispose = vi.fn();
    const fakeInserts = { dispose: insertsDispose } as unknown as InsertChain;
    m.set('lane-1', {
      strip:   { dispose: stripDispose }  as unknown as import('./fx').ChannelStrip,
      engine:  { dispose: engineDispose } as unknown as import('../engines/engine-types').SynthEngine,
      inserts: fakeInserts,
    });
    m.dispose('lane-1');
    expect(stripDispose).toHaveBeenCalledOnce();
    expect(engineDispose).toHaveBeenCalledOnce();
    expect(insertsDispose).toHaveBeenCalledOnce();
  });
});
