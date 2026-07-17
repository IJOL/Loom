// The XY pad's pure core: a two-axis learn state machine + a position→writes
// mapping. No DOM, no AudioParam — just "which param is each axis bound to" and
// "given a pad position, what normalized value does each bound param get." The
// denormalization (norm → real via a knob's min/max) and the actual write happen
// in the wiring layer; this stays testable in isolation.
import { describe, it, expect } from 'vitest';
import { XyPadModel, applyXyWrites } from './xy-pad';

describe('XyPadModel — learn', () => {
  it('starts with both axes unassigned and nothing armed', () => {
    const m = new XyPadModel();
    expect(m.target('x')).toBeNull();
    expect(m.target('y')).toBeNull();
    expect(m.isArmed('x')).toBe(false);
    expect(m.isArmed('y')).toBe(false);
  });

  it('arming an axis then touching a knob binds it and disarms', () => {
    const m = new XyPadModel();
    m.armLearn('x');
    expect(m.isArmed('x')).toBe(true);
    const bound = m.learn('bass.filter.cutoff');
    expect(bound).toBe('x');
    expect(m.target('x')).toBe('bass.filter.cutoff');
    expect(m.isArmed('x')).toBe(false);
  });

  it('touching a knob while nothing is armed changes nothing', () => {
    const m = new XyPadModel();
    expect(m.learn('bass.filter.cutoff')).toBeNull();
    expect(m.target('x')).toBeNull();
    expect(m.target('y')).toBeNull();
  });

  it('only one axis is armed at a time — arming Y supersedes X', () => {
    const m = new XyPadModel();
    m.armLearn('x');
    m.armLearn('y');
    expect(m.isArmed('x')).toBe(false);
    expect(m.isArmed('y')).toBe(true);
    expect(m.learn('lead.reso')).toBe('y');
    expect(m.target('y')).toBe('lead.reso');
    expect(m.target('x')).toBeNull();
  });

  it('cancelLearn disarms without binding', () => {
    const m = new XyPadModel();
    m.armLearn('x');
    m.cancelLearn();
    expect(m.isArmed('x')).toBe(false);
    expect(m.learn('bass.filter.cutoff')).toBeNull();
    expect(m.target('x')).toBeNull();
  });

  it('re-learning an axis replaces its target', () => {
    const m = new XyPadModel();
    m.armLearn('x'); m.learn('a.one');
    m.armLearn('x'); m.learn('a.two');
    expect(m.target('x')).toBe('a.two');
  });

  it('clearTarget unbinds an axis', () => {
    const m = new XyPadModel();
    m.armLearn('x'); m.learn('a.one');
    m.clearTarget('x');
    expect(m.target('x')).toBeNull();
  });
});

describe('XyPadModel — position → writes', () => {
  it('emits a write only for assigned axes', () => {
    const m = new XyPadModel();
    m.armLearn('x'); m.learn('bass.cutoff');
    const w = m.writesFor(0.25, 0.9);
    expect(w).toEqual([{ axis: 'x', paramId: 'bass.cutoff', norm: 0.25 }]);
  });

  it('emits both writes when both axes are bound', () => {
    const m = new XyPadModel();
    m.armLearn('x'); m.learn('bass.cutoff');
    m.armLearn('y'); m.learn('bass.reso');
    const w = m.writesFor(0.1, 0.7);
    expect(w).toContainEqual({ axis: 'x', paramId: 'bass.cutoff', norm: 0.1 });
    expect(w).toContainEqual({ axis: 'y', paramId: 'bass.reso', norm: 0.7 });
  });

  it('clamps positions into 0..1', () => {
    const m = new XyPadModel();
    m.armLearn('x'); m.learn('a');
    m.armLearn('y'); m.learn('b');
    const w = m.writesFor(-0.5, 1.8);
    expect(w.find((e) => e.axis === 'x')!.norm).toBe(0);
    expect(w.find((e) => e.axis === 'y')!.norm).toBe(1);
  });

  it('emits nothing when neither axis is bound', () => {
    const m = new XyPadModel();
    expect(m.writesFor(0.5, 0.5)).toEqual([]);
  });
});

describe('XyPadModel — serialization', () => {
  it('round-trips its assignments through get/setState', () => {
    const m = new XyPadModel();
    m.armLearn('x'); m.learn('bass.cutoff');
    m.armLearn('y'); m.learn('lead.reso');
    const snap = m.getState();
    expect(snap).toEqual({ x: 'bass.cutoff', y: 'lead.reso' });

    const m2 = new XyPadModel();
    m2.setState(snap);
    expect(m2.target('x')).toBe('bass.cutoff');
    expect(m2.target('y')).toBe('lead.reso');
  });

  it('setState tolerates a partial/empty snapshot', () => {
    const m = new XyPadModel();
    m.setState({ x: 'only.x', y: null });
    expect(m.target('x')).toBe('only.x');
    expect(m.target('y')).toBeNull();
  });
});

describe('applyXyWrites — denormalize + drive the knobs', () => {
  const fakeKnob = (min: number, max: number) => {
    const calls: number[] = [];
    return { meta: { min, max }, setValue: (v: number) => calls.push(v), calls };
  };

  it('maps each write\'s 0..1 into the target knob\'s real range', () => {
    const cutoff = fakeKnob(20, 20000);
    const reso = fakeKnob(0, 1);
    const registry = new Map<string, any>([['bass.cutoff', cutoff], ['bass.reso', reso]]);
    applyXyWrites([
      { axis: 'x', paramId: 'bass.cutoff', norm: 0.5 },
      { axis: 'y', paramId: 'bass.reso', norm: 0.25 },
    ], registry);
    expect(cutoff.calls).toEqual([20 + 0.5 * (20000 - 20)]);
    expect(reso.calls).toEqual([0.25]);
  });

  it('skips a write whose target is not in the registry — no throw', () => {
    const registry = new Map<string, any>();
    expect(() => applyXyWrites([{ axis: 'x', paramId: 'gone', norm: 0.5 }], registry)).not.toThrow();
  });
});
