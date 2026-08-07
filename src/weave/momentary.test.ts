import { describe, it, expect } from 'vitest';
import { createMomentary } from './momentary';

function harness(initial: Record<string, number> = { density: 0.5, energy: 0.5 }) {
  const values = { ...initial };
  const m = createMomentary({
    read: (id) => values[id] ?? 0,
    write: (id, v) => { values[id] = v; },
  });
  return { m, values };
}

const HARD: Array<{ id: string; value: number }> = [
  { id: 'density', value: 1 },
  { id: 'energy', value: 1 },
];

describe('momentary', () => {
  it('is not held before anything happens', () => {
    expect(harness().m.isHeld()).toBe(false);
  });

  it('jumps to the targets while held', () => {
    const { m, values } = harness();
    m.press(HARD);
    expect(values.density).toBe(1);
    expect(values.energy).toBe(1);
  });

  it('reports being held', () => {
    const { m } = harness();
    m.press(HARD);
    expect(m.isHeld()).toBe(true);
  });

  it('puts back exactly what was there on release', () => {
    const { m, values } = harness({ density: 0.3, energy: 0.7 });
    m.press(HARD);
    m.release();
    expect(values.density).toBeCloseTo(0.3);
    expect(values.energy).toBeCloseTo(0.7);
  });

  it('is not held after release', () => {
    const { m } = harness();
    m.press(HARD);
    m.release();
    expect(m.isHeld()).toBe(false);
  });

  it('leaves values it never touched alone', () => {
    const { m, values } = harness({ density: 0.5, energy: 0.5, space: 0.2 });
    m.press([{ id: 'density', value: 1 }]);
    m.release();
    expect(values.space).toBeCloseTo(0.2);
  });

  it('ignores a second press while already held', () => {
    // Otherwise the snapshot would be overwritten with the GESTURE's own
    // values, and the release would restore the gesture rather than what came
    // before it — the control would slowly eat the patch.
    const { m, values } = harness({ density: 0.3, energy: 0.7 });
    m.press(HARD);
    m.press([{ id: 'density', value: 0 }, { id: 'energy', value: 0 }]);
    m.release();
    expect(values.density).toBeCloseTo(0.3);
    expect(values.energy).toBeCloseTo(0.7);
  });

  it('ignores a release that never had a press', () => {
    const { m, values } = harness({ density: 0.4 });
    m.release();
    expect(values.density).toBeCloseTo(0.4);
  });

  it('survives being pressed and released repeatedly', () => {
    const { m, values } = harness({ density: 0.25 });
    for (let i = 0; i < 5; i++) {
      m.press([{ id: 'density', value: 1 }]);
      m.release();
    }
    expect(values.density).toBeCloseTo(0.25);
  });

  it('restores over a value the gesture itself changed', () => {
    const { m, values } = harness({ density: 0.6 });
    m.press([{ id: 'density', value: 1 }]);
    expect(values.density).toBe(1);
    m.release();
    expect(values.density).toBeCloseTo(0.6);
  });
});
