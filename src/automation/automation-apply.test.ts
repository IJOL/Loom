// An automation envelope must reach its target whether or not the lane's editor
// panel happens to be mounted. Before this, playback resolved destinations only
// through the knob registry, so automation on an insert did nothing until you
// opened that channel — the value silently vanished.
import { describe, it, expect } from 'vitest';
import { parseAutomationParamId, applyAutomationToSession } from './automation-apply';
import { insertParamId } from './automation-targets';

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

  it('splits an insert param addressed by stable slot id', () => {
    expect(parseAutomationParamId('L1.fx:i3abc.mix'))
      .toEqual({ scopeId: 'L1', kind: 'insert', slotId: 'i3abc', paramId: 'mix' });
  });

  it('keeps a dotted global scope intact', () => {
    expect(parseAutomationParamId('fx.master.fx:i0.mix'))
      .toEqual({ scopeId: 'fx.master', kind: 'insert', slotId: 'i0', paramId: 'mix' });
    expect(parseAutomationParamId('fx.send.A.fx:i1.feedback'))
      .toEqual({ scopeId: 'fx.send.A', kind: 'insert', slotId: 'i1', paramId: 'feedback' });
  });

  it('does not mistake an engine param that merely starts with fx', () => {
    expect(parseAutomationParamId('L1.fxAmount'))
      .toEqual({ scopeId: 'L1', kind: 'engine', paramId: 'fxAmount' });
  });

  it('rejects an id with no lane segment', () => {
    expect(parseAutomationParamId('cutoff')).toBeNull();
  });

  it('still parses a genuine engine param with a dotted path (guard against over-rejection)', () => {
    expect(parseAutomationParamId('poly1.filter.cutoff'))
      .toEqual({ scopeId: 'poly1', kind: 'engine', paramId: 'filter.cutoff' });
  });
});

describe('canonical destination ids', () => {
  it('round-trips a lane insert param', () => {
    const id = insertParamId('poly1', 'i3abc', 'cutoff');
    expect(id).toBe('poly1.fx:i3abc.cutoff');
    expect(parseAutomationParamId(id)).toEqual({
      scopeId: 'poly1', kind: 'insert', slotId: 'i3abc', paramId: 'cutoff',
    });
  });

  it('round-trips a send-rack insert param, keeping the dotted scope intact', () => {
    const id = insertParamId('fx.send.A', 'i9', 'mix');
    expect(parseAutomationParamId(id)).toEqual({
      scopeId: 'fx.send.A', kind: 'insert', slotId: 'i9', paramId: 'mix',
    });
  });

  it('still reads an engine param', () => {
    expect(parseAutomationParamId('poly1.filter.cutoff')).toEqual({
      scopeId: 'poly1', kind: 'engine', paramId: 'filter.cutoff',
    });
  });
});

describe('applyAutomationToSession', () => {
  it('writes a normalised value onto an insert param using its declared range', () => {
    const vals = { mix: 0 };
    const applied = applyAutomationToSession('L1.fx:i0.mix', 0.25, {
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
    const applied = applyAutomationToSession('GONE.fx:i0.mix', 0.5, {
      getInsertFx: () => undefined,
      getEngine: () => undefined,
      getRange: () => undefined,
    });

    expect(applied).toBe(false);
  });
});
