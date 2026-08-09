// An automation envelope must reach its target whether or not the lane's editor
// panel happens to be mounted. Before this, playback resolved destinations only
// through the knob registry, so automation on an insert did nothing until you
// opened that channel — the value silently vanished.
import { describe, it, expect, vi } from 'vitest';
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

describe('the session scope (WEAVE macros)', () => {
  it('parses a macro id as a macro, not as a lane param', () => {
    expect(parseAutomationParamId('session.weave:density')).toEqual({
      scopeId: 'session.weave', kind: 'macro', paramId: 'density',
    });
  });

  it('still parses a lane engine param the way it did', () => {
    expect(parseAutomationParamId('lane-3.cutoff')).toEqual({
      scopeId: 'lane-3', kind: 'engine', paramId: 'cutoff',
    });
  });

  it('still parses an insert param the way it did', () => {
    expect(parseAutomationParamId('lane-3.fx:slot1.mix')).toEqual({
      scopeId: 'lane-3', kind: 'insert', slotId: 'slot1', paramId: 'mix',
    });
  });

  it('does not mistake a lane whose id merely starts with session for a macro', () => {
    expect(parseAutomationParamId('session-lane.cutoff')?.kind).toBe('engine');
  });

  it('refuses the marker with nothing after it, rather than an empty macro', () => {
    // Falls through to the dotted reading, which is the honest answer for a
    // string that names no param at all.
    expect(parseAutomationParamId('session.weave:')?.kind).not.toBe('macro');
  });

  it('keeps a dotted macro id whole, so a nested name survives', () => {
    expect(parseAutomationParamId('session.weave:style.mix')).toEqual({
      scopeId: 'session.weave', kind: 'macro', paramId: 'style.mix',
    });
  });
});

describe('a modulator depth', () => {
  it('parses on its two markers, not by counting dots', () => {
    expect(parseAutomationParamId('L1.mod.lfo1.conn.c1.depth'))
      .toEqual({ scopeId: 'L1', kind: 'modDepth', modId: 'lfo1', connId: 'c1' });
  });

  it('is not confused with an engine param that mentions mod', () => {
    expect(parseAutomationParamId('L1.mod.amount'))
      .toEqual({ scopeId: 'L1', kind: 'engine', paramId: 'mod.amount' });
  });

  const engineWithLfo = () => {
    const conn = { id: 'c1', paramId: 'filter.cutoff', depth: 0 };
    const mod = { id: 'lfo1', connections: [conn] };
    const set = vi.fn((modId: string, next: { id: string; depth: number }) => {
      if (modId === 'lfo1' && next.id === 'c1') mod.connections[0] = next as never;
    });
    const edited = vi.fn();
    return {
      setBaseValue: vi.fn(), getBaseValue: () => 0,
      modulators: { modulators: [mod], setConnection: set },
      onModulationEdited: edited,
      _mod: mod, _set: set, _edited: edited,
    };
  };

  const deps = (engine: unknown) => ({
    getInsertFx: () => undefined,
    getEngine: () => engine as never,
    getRange: () => ({ min: -1, max: 1 }),
  });

  it('reaches the modulation host, not the engine params', () => {
    const engine = engineWithLfo();
    const ok = applyAutomationToSession('L1.mod.lfo1.conn.c1.depth', 0.75, deps(engine));
    expect(ok).toBe(true);
    expect(engine.setBaseValue).not.toHaveBeenCalled();
    expect(engine._set).toHaveBeenCalledWith('lfo1', expect.objectContaining({ id: 'c1', depth: 0.5 }));
  });

  it('tells the engine to make it audible now', () => {
    // setConnection alone only edits state: the worklet keeps modulating at the
    // old depth until the engine pushes the change across.
    const engine = engineWithLfo();
    applyAutomationToSession('L1.mod.lfo1.conn.c1.depth', 1, deps(engine));
    expect(engine._edited).toHaveBeenCalled();
  });

  it('keeps the connection it is editing — target and id survive', () => {
    const engine = engineWithLfo();
    applyAutomationToSession('L1.mod.lfo1.conn.c1.depth', 0, deps(engine));
    expect(engine._mod.connections[0]).toMatchObject({ id: 'c1', paramId: 'filter.cutoff', depth: -1 });
  });

  it('lands nowhere, honestly, when the connection is gone', () => {
    const engine = engineWithLfo();
    engine._mod.connections.length = 0;
    expect(applyAutomationToSession('L1.mod.lfo1.conn.c1.depth', 1, deps(engine))).toBe(false);
  });
});
