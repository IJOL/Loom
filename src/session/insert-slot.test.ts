import { describe, it, expect, beforeEach } from 'vitest';
import { applyInsertSlot, snapshotInsertSlot, rehydrateInsertChain, type InsertSlot } from './insert-slot';
import { InsertChain } from '../plugins/fx/insert-chain';
import { createInstance, registerPlugin, _resetRegistry } from '../plugins/registry';
import { multifilterPlugin } from '../plugins/fx/multifilter';
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

describe('insert-slot rehydration', () => {
  beforeEach(() => {
    _resetRegistry();
    registerPlugin(multifilterPlugin);
  });

  it('round-trips a multifilter slot through snapshot and rehydrate', () => {
    const ctx = new AudioContext();
    const sourceChain = new InsertChain(ctx.createGain(), ctx.createGain());
    const inst = createInstance('fx', 'multifilter', ctx)!;
    inst.setBaseValue('freq', 800);
    inst.setBaseValue('q', 5);
    sourceChain.insert(inst, 'a');

    // Build the slot manually since snapshotInsertSlot expects a fresh slot shape
    const slot: InsertSlot = { id: 'a', pluginId: 'multifilter', params: {}, bypass: false };
    const captured = snapshotInsertSlot(slot, inst, ['freq', 'q']);

    const freshChain = new InsertChain(ctx.createGain(), ctx.createGain());
    rehydrateInsertChain(ctx, freshChain, [captured]);

    expect(freshChain.size()).toBe(1);
    const restored = freshChain.list()[0];
    expect(restored.fx.getBaseValue('freq')).toBe(800);
    expect(restored.fx.getBaseValue('q')).toBe(5);
    expect(restored.bypass).toBe(false);
  });
});

describe('insert-slot helpers', () => {
  it('snapshot reads via getBaseValue', () => {
    const inst = fakeInst({ freq: 1234, q: 2 });
    const slot: InsertSlot = { id: 'a', pluginId: 'multifilter', params: {}, bypass: false };
    const snap = snapshotInsertSlot(slot, inst, ['freq', 'q']);
    expect(snap.params).toEqual({ freq: 1234, q: 2 });
  });

  it('apply writes via setBaseValue', () => {
    const inst = fakeInst({});
    const slot: InsertSlot = { id: 'a', pluginId: 'multifilter', params: { freq: 800, q: 5 }, bypass: true };
    applyInsertSlot(slot, inst);
    expect(inst.getBaseValue('freq')).toBe(800);
    expect(inst.getBaseValue('q')).toBe(5);
  });
});

import { newInsertId } from './insert-slot';

describe('stable insert ids', () => {
  beforeEach(() => {
    _resetRegistry();
    registerPlugin(multifilterPlugin);
  });

  it('mints distinct ids', () => {
    expect(newInsertId()).not.toBe(newInsertId());
  });

  it('carries the slot id onto the live chain slot', () => {
    const ctx = new AudioContext();
    const chain = new InsertChain(ctx.createGain(), ctx.createGain());
    // pluginId must be one registered in this file (multifilter, via
    // beforeEach) — 'delay' isn't, and rehydrateInsertChain silently skips
    // slots with an unregistered plugin id (see the doc comment on it),
    // which would make this assertion fail for a reason unrelated to ids.
    const slots: InsertSlot[] = [
      { id: 'slot-a', pluginId: 'multifilter', params: {}, bypass: false },
    ];
    rehydrateInsertChain(ctx, chain, slots);
    expect(chain.list().map((s) => s.id)).toEqual(['slot-a']);
  });
});
