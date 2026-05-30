import { describe, it, expect } from 'vitest';
import { applyInsertSlot, snapshotInsertSlot, type InsertSlot } from './insert-slot';
import type { FxInstance } from '../plugins/types';

function fakeInst(init: Record<string, number>): FxInstance {
  const v = { ...init };
  return {
    input: {} as any, output: {} as any,
    getAudioParams: () => new Map(),
    getBaseValue: (id) => v[id] ?? 0,
    setBaseValue: (id, x) => { v[id] = x; },
    applyPreset: () => {}, dispose: () => {},
  };
}

describe('insert-slot helpers', () => {
  it('snapshot reads via getBaseValue', () => {
    const inst = fakeInst({ freq: 1234, q: 2 });
    const slot: InsertSlot = { pluginId: 'multifilter', params: {}, bypass: false };
    const snap = snapshotInsertSlot(slot, inst, ['freq', 'q']);
    expect(snap.params).toEqual({ freq: 1234, q: 2 });
  });

  it('apply writes via setBaseValue', () => {
    const inst = fakeInst({});
    const slot: InsertSlot = { pluginId: 'multifilter', params: { freq: 800, q: 5 }, bypass: true };
    applyInsertSlot(slot, inst);
    expect(inst.getBaseValue('freq')).toBe(800);
    expect(inst.getBaseValue('q')).toBe(5);
  });
});
