import { describe, it, expect } from 'vitest';
import { applyWeaveParamMacros, createWeaveParamMacros, macroTargets } from './weave-param-macros';
import type { AutomationTarget } from '../automation/automation-targets';

const dest = (id: string, min = 0, max = 1): AutomationTarget =>
  ({ id, label: id, laneId: id.split('.')[0], laneName: 'L', min, max });

/** A session with two lanes, each with its two sends, and one LFO depth. */
const CATALOGUE: AutomationTarget[] = [
  dest('lane1.bus.sendA'), dest('lane1.bus.sendB'),
  dest('lane2.bus.sendA'), dest('lane2.bus.sendB'),
  dest('lane1.lfo1.depth'),
  dest('lane1.filter.cutoff', 20, 20000),
];

/** Collects what landed, and on what.
 *
 *  `write` stands in for AutomationWrites.applyPlaybackUnmountedWrite, so the
 *  denormalisation is asserted the way the real door performs it: against the
 *  range the CATALOGUE declared, not one this module assumed. */
function harness(catalogue = CATALOGUE) {
  const written = new Map<string, number>();
  return {
    written,
    deps: {
      destinations: () => catalogue,
      write: (id: string, v: number, ranges: ReadonlyMap<string, { min: number; max: number }>) => {
        const r = ranges.get(id);
        written.set(id, r ? r.min + v * (r.max - r.min) : v);
      },
    },
  };
}

describe('macroTargets', () => {
  it('finds every modulator depth, whatever its lane or kind', () => {
    expect(macroTargets(CATALOGUE).lfoDepthIds).toEqual(['lane1.lfo1.depth']);
  });

  it('offers nothing a session does not have', () => {
    // A Space knob on a session with no sends must move nothing, not throw.
    expect(macroTargets([dest('lane1.filter.cutoff')]).lfoDepthIds).toEqual([]);
  });
});

describe('applyWeaveParamMacros', () => {
  it('writes nothing while the macros sit at their neutral', () => {
    const h = harness();
    expect(applyWeaveParamMacros({ space: 0, motion: 0 }, h.deps)).toBe(0);
    expect(h.written.size).toBe(0);
  });

  it('fans Space over EVERY lane, because it is a scene macro', () => {
    // A wash on one lane is not what "space" means.
    const h = harness();
    applyWeaveParamMacros({ space: 1, motion: 0 }, h.deps);
    expect(h.written.get('lane1.bus.sendA')).toBeCloseTo(1);
    expect(h.written.get('lane2.bus.sendA')).toBeCloseTo(1);
  });

  it('gives the second bus less, so the two sends are not one control twice', () => {
    const h = harness();
    applyWeaveParamMacros({ space: 1, motion: 0 }, h.deps);
    expect(h.written.get('lane1.bus.sendB')).toBeLessThan(h.written.get('lane1.bus.sendA')!);
  });

  it('moves every modulator depth with Motion', () => {
    const h = harness();
    applyWeaveParamMacros({ space: 0, motion: 0.8 }, h.deps);
    expect(h.written.get('lane1.lfo1.depth')).toBeCloseTo(0.8);
  });

  it('leaves alone what neither macro addresses', () => {
    // The catalogue is full of destinations these two must never touch.
    const h = harness();
    applyWeaveParamMacros({ space: 1, motion: 1 }, h.deps);
    expect(h.written.has('lane1.filter.cutoff')).toBe(false);
  });

  it('denormalises through the destination\'s DECLARED range', () => {
    // The macro speaks 0..1; the target speaks its own units, and the range
    // comes from the catalogue rather than being assumed here.
    const h = harness([dest('lane1.lfo1.depth', 0, 50)]);
    applyWeaveParamMacros({ space: 0, motion: 1 }, h.deps);
    expect(h.written.get('lane1.lfo1.depth')).toBeCloseTo(50);
  });

  it('reports how many writes landed, so a dead macro is visible', () => {
    const h = harness();
    expect(applyWeaveParamMacros({ space: 1, motion: 1 }, h.deps)).toBe(5);
  });
});

describe('a macro that goes back to neutral takes its effect with it', () => {
  it('clears the sends when Space returns to zero', () => {
    // Reported: "la macro de space... si la pones a 0 de nuevo sigue habiendo
    // eco". At neutral the mapping wrote NOTHING, so the sends kept whatever
    // the last non-zero position had left on them. A macro you cannot undo is
    // worse than one that does not exist.
    const h = harness();
    const macros = createWeaveParamMacros(h.deps);
    macros.apply({ space: 0.8, motion: 0 });
    // Something audible went out. WHICH value is the taper's business and is
    // asserted in macro-params.test.ts, not duplicated here.
    expect(h.written.get('lane1.bus.sendA')).toBeGreaterThan(0);

    macros.apply({ space: 0, motion: 0 });
    expect(h.written.get('lane1.bus.sendA')).toBe(0);
    expect(h.written.get('lane1.bus.sendB')).toBe(0);
  });

  it('does the same for Motion', () => {
    const h = harness();
    const macros = createWeaveParamMacros(h.deps);
    macros.apply({ space: 0, motion: 0.9 });
    expect(h.written.get('lane1.lfo1.depth')).toBeCloseTo(0.9, 5);
    macros.apply({ space: 0, motion: 0 });
    expect(h.written.get('lane1.lfo1.depth')).toBe(0);
  });

  it('writes NOTHING while it has never left neutral', () => {
    // The property the old guard existed to protect, and it still holds: a
    // panel merely opened must not zero the sends a user set by hand at the
    // desk. Identity means identity.
    const h = harness();
    const macros = createWeaveParamMacros(h.deps);
    macros.apply({ space: 0, motion: 0 });
    expect(h.written.size).toBe(0);
  });

  it('goes quiet again once it has put the zero back', () => {
    // One write on the way down, not one per repaint: a param written sixty
    // times a second with the same value is sixty ramps for nothing.
    const h = harness();
    const macros = createWeaveParamMacros(h.deps);
    macros.apply({ space: 0.5, motion: 0 });
    macros.apply({ space: 0, motion: 0 });
    h.written.clear();
    macros.apply({ space: 0, motion: 0 });
    expect(h.written.size).toBe(0);
  });
});
