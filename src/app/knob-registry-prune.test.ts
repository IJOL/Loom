import { describe, it, expect } from 'vitest';
import { laneOfKnobId, pruneKnobRegistry, pruneKnobRegistryToDestinations } from './knob-registry-prune';
import type { KnobHandle } from '../core/knob';

const handle = (id: string) => ({ meta: { id, label: id, min: 0, max: 1 } }) as KnobHandle;

describe('laneOfKnobId', () => {
  it('reads the lane off an engine param', () => {
    expect(laneOfKnobId('L1.filter.cutoff')).toBe('L1');
  });

  it('reads the lane out of a mixer id, where it sits second', () => {
    expect(laneOfKnobId('mix.L1.pan')).toBe('L1');
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
      ['mix.L1.pan',     handle('mix.L1.pan')],
      ['OLD.cutoff',     handle('OLD.cutoff')],
      ['mix.OLD.pan',    handle('mix.OLD.pan')],
      ['OLD.fx0.mix',    handle('OLD.fx0.mix')],
      ['fx.mcomp.thr',   handle('fx.mcomp.thr')],
    ]);

    pruneKnobRegistry(reg, new Set(['L1']));

    expect([...reg.keys()].sort()).toEqual(['L1.cutoff', 'fx.mcomp.thr', 'mix.L1.pan']);
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
  // destination" rule would have shipped: the mixer registers six knobs per
  // track (mix.<laneId>.eqhi/eqmid/eqlow/sendA/sendB/pan — src/core/mixer.ts)
  // and listAutomationTargets does not model mix.* at all, so an empty
  // validIds set would classify every mixer knob as prunable. They must
  // survive untouched no matter what the destination catalogue says, because
  // the registry is their live write path, not just a list of automation
  // targets.
  it('leaves mixer knobs alone even when the destination set is empty', () => {
    const registry = new Map<string, KnobHandle>([
      ['mix.poly1.pan',   handle('mix.poly1.pan')],
      ['mix.poly1.sendA', handle('mix.poly1.sendA')],
    ]);
    pruneKnobRegistryToDestinations(registry, new Set());
    expect([...registry.keys()].sort()).toEqual(['mix.poly1.pan', 'mix.poly1.sendA']);
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
