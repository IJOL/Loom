import { describe, it, expect } from 'vitest';
import { laneOfKnobId, pruneKnobRegistry, pruneKnobRegistryToDestinations } from './knob-registry-prune';
import type { KnobHandle } from '../core/knob';

const handle = (id: string) => ({ meta: { id, label: id, min: 0, max: 1 } }) as KnobHandle;

describe('laneOfKnobId', () => {
  it('reads the lane off an engine param', () => {
    expect(laneOfKnobId('L1.filter.cutoff')).toBe('L1');
  });

  it('reads the lane off a mixer-strip param, which is scoped like any other', () => {
    // `<laneId>.bus.<param>` — the mixer column's controls used to be
    // `mix.<laneId>.<param>`, needing their own branch here. Putting the lane
    // back in the scope position is what made them automation destinations, and
    // it also removed the special case.
    expect(laneOfKnobId('L1.bus.pan')).toBe('L1');
    expect(laneOfKnobId('L1.bus.eq.high')).toBe('L1');
  });

  it('treats master / send knobs as global', () => {
    expect(laneOfKnobId('fx.mcomp.thr')).toBeNull();
    expect(laneOfKnobId('fx.send.a.level')).toBeNull();
  });
});

describe('pruneKnobRegistry', () => {
  it('drops the previous session lanes and keeps the current ones', () => {
    const reg = new Map<string, KnobHandle>([
      ['L1.cutoff',      handle('L1.cutoff')],
      ['L1.bus.pan',     handle('L1.bus.pan')],
      ['OLD.cutoff',     handle('OLD.cutoff')],
      ['OLD.bus.pan',    handle('OLD.bus.pan')],
      ['OLD.fx0.mix',    handle('OLD.fx0.mix')],
      ['fx.mcomp.thr',   handle('fx.mcomp.thr')],
    ]);

    pruneKnobRegistry(reg, new Set(['L1']));

    // The departed lane's strip knobs go with it — correctly: a ChannelStrip is
    // owned by its lane and disposed with it.
    expect([...reg.keys()].sort()).toEqual(['L1.bus.pan', 'L1.cutoff', 'fx.mcomp.thr']);
  });

  it('is a no-op when every lane is still present', () => {
    const reg = new Map<string, KnobHandle>([['L1.cutoff', handle('L1.cutoff')]]);
    pruneKnobRegistry(reg, new Set(['L1']));
    expect(reg.size).toBe(1);
  });
});

describe('pruneKnobRegistryToDestinations', () => {
  it('drops knobs for an insert that no longer exists, including on the master rack', () => {
    const registry = new Map<string, KnobHandle>([
      ['poly1.cutoff',            handle('poly1.cutoff')],
      ['poly1.fx:gone.cutoff',    handle('poly1.fx:gone.cutoff')],
      ['fx.master.fx:gone.gain',  handle('fx.master.fx:gone.gain')],
      ['fx.master.fx:alive.gain', handle('fx.master.fx:alive.gain')],
    ]);
    pruneKnobRegistryToDestinations(registry, new Set([
      'poly1.cutoff', 'fx.master.fx:alive.gain',
    ]));
    expect([...registry.keys()].sort()).toEqual(['fx.master.fx:alive.gain', 'poly1.cutoff']);
  });

  it('keeps a modulator config knob, which is never a destination', () => {
    const registry = new Map<string, KnobHandle>([['poly1.mod.lfo1.rate', handle('poly1.mod.lfo1.rate')]]);
    pruneKnobRegistryToDestinations(registry, new Set());
    expect(registry.has('poly1.mod.lfo1.rate')).toBe(true);
  });

  // This is the regression the naive "delete everything that isn't a
  // destination" rule would have shipped. The mixer column registers seven
  // controls per lane (`<laneId>.bus.*` — src/core/mixer.ts), and while they ARE
  // destinations now, this pruner runs against whatever catalogue it is handed:
  // an empty set (a load in flight, a lane not yet allocated) would classify
  // every mixer control as prunable. Only insert-param ids are ever candidates,
  // because the registry is these controls' live write path, not merely a list
  // of automation targets.
  it('leaves mixer strip controls alone even when the destination set is empty', () => {
    const registry = new Map<string, KnobHandle>([
      ['poly1.bus.pan',       handle('poly1.bus.pan')],
      ['poly1.bus.delaySend', handle('poly1.bus.delaySend')],
      ['poly1.bus.level',     handle('poly1.bus.level')],
    ]);
    pruneKnobRegistryToDestinations(registry, new Set());
    expect([...registry.keys()].sort())
      .toEqual(['poly1.bus.delaySend', 'poly1.bus.level', 'poly1.bus.pan']);
  });

  it('leaves an engine param alone even when the destination set is empty', () => {
    const registry = new Map<string, KnobHandle>([['poly1.cutoff', handle('poly1.cutoff')]]);
    pruneKnobRegistryToDestinations(registry, new Set());
    expect(registry.has('poly1.cutoff')).toBe(true);
  });

  it('is a no-op when every insert slot is still alive', () => {
    const registry = new Map<string, KnobHandle>([
      ['poly1.fx:a.cutoff', handle('poly1.fx:a.cutoff')],
      ['poly1.fx:a.mix',    handle('poly1.fx:a.mix')],
    ]);
    // Only one of the slot's two params is a "destination" here (e.g. the
    // other is non-continuous) — the slot itself is still alive, so both
    // knobs must survive.
    pruneKnobRegistryToDestinations(registry, new Set(['poly1.fx:a.cutoff']));
    expect(registry.size).toBe(2);
  });
});
