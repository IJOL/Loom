// src/engines/engine-selector-ui.test.ts
// Regression test for the empty destination dropdown bug:
//   The modulators-panel destination dropdown is populated by filtering the
//   automationRegistry for `${laneId}.` entries (see modulation-ui.ts).
//
//   `rebuildEngineParamUI` calls `unregisterKnobsByPrefix(laneId, registry)`
//   to evict a stale engine's knobs when switching engines. For Subtractive
//   the knobs are mounted ONCE at boot (into the per-section divs declared
//   in index.html) and never re-registered by buildParamUI — so without an
//   explicit "rehydrate Subtractive main knobs" step the registry comes up
//   empty for that lane after the rebuild, and the modulator destination
//   dropdown comes up empty.

import { describe, it, expect } from 'vitest';
import { unregisterKnobsByPrefix, melodicSynthEngineIds } from './engine-selector-ui';
import type { KnobHandle } from '../core/knob';
import { bootstrapPlugins } from '../app/plugin-bootstrap';

function makeKnobHandle(id: string): KnobHandle {
  return {
    el: { } as unknown as HTMLElement,
    meta: { id, min: 0, max: 1 },
    setValue: () => { /* noop */ },
    setModulationOffset: () => { /* noop */ },
  };
}

describe('engine-selector-ui — registry hygiene', () => {
  it('unregisterKnobsByPrefix removes only entries with the matching prefix', () => {
    const reg = new Map<string, KnobHandle>();
    reg.set('main.osc1.level',      makeKnobHandle('main.osc1.level'));
    reg.set('main.filter.cutoff',   makeKnobHandle('main.filter.cutoff'));
    reg.set('bass.cutoff',          makeKnobHandle('bass.cutoff'));
    reg.set('mix.bass.eq.hi',       makeKnobHandle('mix.bass.eq.hi'));

    unregisterKnobsByPrefix('main.', reg);

    expect([...reg.keys()].sort()).toEqual(['bass.cutoff', 'mix.bass.eq.hi']);
  });
});

describe('engine-selector-ui — melodic engine filter', () => {
  it('lists the 5 piano-roll engines and excludes drums-machine', () => {
    bootstrapPlugins(); // registers all builtin synth plugins + engines
    const ids = melodicSynthEngineIds();
    expect(ids).toEqual(
      expect.arrayContaining(['tb303', 'subtractive', 'fm', 'wavetable', 'karplus']),
    );
    expect(ids).not.toContain('drums-machine');
  });
});
