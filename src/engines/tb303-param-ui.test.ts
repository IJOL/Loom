/** @vitest-environment jsdom */
// Regression: the TB-303 engine must render its OWN parameter controls in the
// per-lane inspector (engine-mod-host), like FM/Karplus/Wavetable do — instead
// of relying on the legacy static `data-page="303"` knob row that was wired
// only to the canonical bass lane id `tb-303-1`. That legacy path left any
// other TB-303 lane (e.g. a MIDI-imported lane such as `lane-mpr2awpz-2`) with
// NO engine controls at all. buildParamUI must wire the param knobs under the
// canonical `<laneId>.<spec.id>` ids for ANY laneId.

import { describe, it, expect } from 'vitest';
import { tb303Engine } from './tb303';
import type { EngineUIContext } from './engine-types';

function makeCtx(laneId: string, registered: string[]): EngineUIContext {
  return {
    laneId,
    registerKnob: (k: { meta?: { id?: string } }) => {
      if (k.meta?.id) registered.push(k.meta.id);
    },
    registry: new Map(),
    lookupLaneDisplayName: () => undefined,
  } as unknown as EngineUIContext;
}

describe('TB303Engine.buildParamUI — per-lane engine controls', () => {
  it('registers wave + cutoff/resonance/env/decay/accent knobs for an arbitrary lane id', () => {
    const laneId = 'lead-sub-lead-1'; // NOT the canonical tb-303-1
    const registered: string[] = [];
    const container = document.createElement('div');

    tb303Engine.buildParamUI(container, makeCtx(laneId, registered));

    for (const id of ['osc.wave', 'filter.cutoff', 'filter.resonance', 'env.amount', 'env.decay', 'env.accent']) {
      expect(registered).toContain(`${laneId}.${id}`);
    }
  });
});
