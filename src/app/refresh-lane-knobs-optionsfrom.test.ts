/** @vitest-environment jsdom */
// refreshLaneKnobs normalised a discrete handle's index against spec.options
// (the STATIC option list), even for a param whose live control was built
// from optionsFrom (a DIFFERENT, possibly shorter, list — e.g. the
// Subtractive filter Type strip, whose options come from the chosen Mode's
// own declared taps: 4 under DIG, 3 under MOG/303/COMB). When the live list
// is shorter than the static one, normaliseSelectIndex/quantiseSelectValue
// disagree and the refresh both PAINTS the wrong option and WRITES it back
// via commitParam's onChange — see filter-kinds.ts and engine-params.ts's
// `optionsFrom` doc. This pins that refreshLaneKnobs resolves the SAME list
// the control was built from.

import { describe, it, expect } from 'vitest';
import { createKnobMounter, type KnobMounterDeps } from './knob-mounting';
import { buildEngineParamGrid } from '../engines/engine-param-grid';
import type { EngineParamSpec } from '../engines/engine-params';
import type { EngineUIContext } from '../engines/engine-types';
import type { SynthEngine } from '../engines/engine-types';
import type { KnobHandle } from '../core/knob';
import type { SessionState } from '../session/session';
import { FILTER_MODE_OPTIONS, typeOptionsFor } from '../audio-dsp/filter-kinds';

// Mirrors the real filter.model / filter.type pair from subtractive-params.ts:
// `options` is the 4-tap DIG list (the source param's default), `optionsFrom`
// rebuilds from whichever mode is live.
const MODEL: EngineParamSpec = {
  id: 'filter.model', label: 'Mode', kind: 'discrete', min: 0, max: 3, default: 0,
  options: FILTER_MODE_OPTIONS,
};
const TYPE: EngineParamSpec = {
  id: 'filter.type', label: 'Type', kind: 'discrete', min: 0, max: 3, default: 0,
  options: typeOptionsFor(0), // DIG's 4 taps: lp hp bp notch
  optionsFrom: { paramId: 'filter.model', build: typeOptionsFor },
};

function stubEngine(params: EngineParamSpec[]) {
  const state = new Map(params.map((p) => [p.id, p.default] as const));
  return {
    id: 'subtractive', params,
    getBaseValue: (id: string) => state.get(id) ?? 0,
    setBaseValue: (id: string, v: number) => { state.set(id, v); },
  };
}

describe('refreshLaneKnobs with optionsFrom', () => {
  it('keeps a 3-tap-mode Type index intact through a refresh (MOG, tap index 2 = bp)', () => {
    const laneId = 'sub-1';
    const sessionState = {
      lanes: [{ id: laneId, engineId: 'subtractive', clips: [], inserts: [] }],
    } as unknown as SessionState;

    const registry = new Map<string, KnobHandle>();
    const ctx = {
      laneId,
      registerKnob: (k: KnobHandle) => { if (k.meta?.id) registry.set(k.meta.id, k); },
      registry,
      sessionState,
    } as unknown as EngineUIContext;

    const engine = stubEngine([MODEL, TYPE]);
    // MOG (index 1) has 3 taps: lp hp bp. Set BEFORE the grid builds so the
    // initial Type strip is built from MOG's 3-option list, matching what a
    // preset load actually does (engine state applied, then UI built/refreshed).
    engine.setBaseValue('filter.model', 1);
    engine.setBaseValue('filter.type', 2); // bp — the 3rd (last) MOG tap
    buildEngineParamGrid(engine, ctx, document.createElement('div'));

    const mounter = createKnobMounter({
      registry,
      registerKnob: () => {},
      laneResources: { get: () => undefined },
      getSessionState: () => sessionState,
      getLaneDisplayName: () => undefined,
      fmtPct: String, fmtDb: String,
    } as unknown as KnobMounterDeps);

    mounter.refreshLaneKnobs(laneId, engine as unknown as SynthEngine);

    // The engine's own value must still say bp (index 2) — not overwritten by
    // a refresh that quantised against the wrong (4-option) list.
    expect(engine.getBaseValue('filter.type')).toBe(2);

    // And the strip must actually be showing bp, not whatever the wrong
    // arithmetic lands on (hp, index 1).
    const handle = registry.get(`${laneId}.filter.type`)!;
    const buttons = [...handle.el.querySelectorAll<HTMLButtonElement>('button.radio-btn')];
    const activeIdx = buttons.findIndex((b) => b.classList.contains('active'));
    expect(activeIdx).toBe(2);
  });
});
