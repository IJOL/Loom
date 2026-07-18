import { describe, it, expect } from 'vitest';
import { laneOfKnobId, pruneKnobRegistry } from './knob-registry-prune';
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
