// An automation envelope must reach its target whether or not the lane's editor
// panel happens to be mounted. Before this, playback resolved destinations only
// through the knob registry, so automation on an insert did nothing until you
// opened that channel — the value silently vanished.
import { describe, it, expect } from 'vitest';
import { parseAutomationParamId, applyAutomationToSession } from './automation-apply';

function fakeFx(vals: Record<string, number>) {
  return {
    getBaseValue: (id: string) => vals[id] ?? 0,
    setBaseValue: (id: string, v: number) => { vals[id] = v; },
  };
}

describe('parseAutomationParamId', () => {
  it('splits an engine param', () => {
    expect(parseAutomationParamId('L1.filter.cutoff'))
      .toEqual({ scopeId: 'L1', kind: 'engine', paramId: 'filter.cutoff' });
  });

  it('splits an insert param', () => {
    expect(parseAutomationParamId('L1.fx2.mix'))
      .toEqual({ scopeId: 'L1', kind: 'insert', slotIdx: 2, paramId: 'mix' });
  });

  it('keeps a dotted global scope intact', () => {
    expect(parseAutomationParamId('fx.master.fx0.mix'))
      .toEqual({ scopeId: 'fx.master', kind: 'insert', slotIdx: 0, paramId: 'mix' });
    expect(parseAutomationParamId('fx.send.A.fx1.feedback'))
      .toEqual({ scopeId: 'fx.send.A', kind: 'insert', slotIdx: 1, paramId: 'feedback' });
  });

  it('does not mistake an engine param that merely starts with fx', () => {
    expect(parseAutomationParamId('L1.fxAmount'))
      .toEqual({ scopeId: 'L1', kind: 'engine', paramId: 'fxAmount' });
  });

  it('rejects an id with no lane segment', () => {
    expect(parseAutomationParamId('cutoff')).toBeNull();
  });
});

describe('applyAutomationToSession', () => {
  it('writes a normalised value onto an insert param using its declared range', () => {
    const vals = { mix: 0 };
    const applied = applyAutomationToSession('L1.fx0.mix', 0.25, {
      getInsertFx: () => fakeFx(vals),
      getEngine: () => undefined,
      getRange: () => ({ min: 0, max: 100 }),
    });

    expect(applied).toBe(true);
    expect(vals.mix).toBe(25);
  });

  it('writes onto an engine param', () => {
    const vals = { cutoff: 0 };
    const applied = applyAutomationToSession('L1.cutoff', 0.5, {
      getInsertFx: () => undefined,
      getEngine: () => fakeFx(vals),
      getRange: () => ({ min: 20, max: 220 }),
    });

    expect(applied).toBe(true);
    expect(vals.cutoff).toBe(120);
  });

  it('reports failure when the target no longer exists', () => {
    const applied = applyAutomationToSession('GONE.fx0.mix', 0.5, {
      getInsertFx: () => undefined,
      getEngine: () => undefined,
      getRange: () => undefined,
    });

    expect(applied).toBe(false);
  });
});
