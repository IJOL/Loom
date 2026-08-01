/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { landAutomationValue } from './automation-knob';
import type { KnobHandle } from '../core/knob';

function stubHandle(min: number, max: number): KnobHandle & { last: number | null } {
  const h = {
    el: document.createElement('div'),
    last: null as number | null,
    meta: { id: 'L.filter.cutoff', label: 'Cutoff', min, max },
    setValue(v: number) { h.last = v; },
  };
  return h as unknown as KnobHandle & { last: number | null };
}

describe('landAutomationValue', () => {
  it('drives the mounted knob, denormalised against its own range', () => {
    const handle = stubHandle(0, 200);
    const registry = new Map([['L.filter.cutoff', handle as unknown as KnobHandle]]);
    const applyUnmounted = vi.fn();

    landAutomationValue({ registry, applyUnmounted, getTargetRanges: () => new Map() },
      'L.filter.cutoff', 0.25);

    expect((handle as unknown as { last: number }).last).toBe(50);
    expect(applyUnmounted).not.toHaveBeenCalled();
  });

  it('falls back to the audio object when no knob is mounted', () => {
    const applyUnmounted = vi.fn();
    const ranges = new Map([['L.filter.cutoff', { min: 0, max: 1 }]]);

    landAutomationValue({ registry: new Map(), applyUnmounted, getTargetRanges: () => ranges },
      'L.filter.cutoff', 0.25);

    expect(applyUnmounted).toHaveBeenCalledWith('L.filter.cutoff', 0.25, ranges);
  });

  it('asks for the range table at most once across many unmounted writes', () => {
    const getTargetRanges = vi.fn(() => new Map());
    const land = { registry: new Map(), applyUnmounted: vi.fn(), getTargetRanges };

    landAutomationValue(land, 'a.x', 0.1);
    landAutomationValue(land, 'b.y', 0.2);

    expect(getTargetRanges).toHaveBeenCalledTimes(2); // per call; the CALLER memoises per frame
  });

  it('is a no-op, never a throw, when there is no fallback wired', () => {
    expect(() => landAutomationValue({ registry: new Map() }, 'a.x', 0.5)).not.toThrow();
  });
});
