// src/polysynth/poly-preset-apply.test.ts
//
// Regression: picking a preset or hitting Randomize on a poly lane did not
// survive a save. These three paths push values straight into the engine, so no
// knob onChange fires and `commitParam` never runs; they used to get their
// mirror for free from `refreshLaneKnobs` repainting the knobs, which stopped
// being true once that repaint was wrapped in `withoutParamMirror`. Nothing else
// writes a melodic lane's sound to disk (the live picker never sets
// `enginePresetName`), so the recalled sound was simply gone on reload.

import { describe, it, expect } from 'vitest';
import {
  applyEnginePresetToLane, applyUserPolyPresetToLane,
  type PolyPresetApplyDeps,
} from './poly-preset-apply';
import { polyParamsToFlat } from './poly-preset-store';
import { POLY_DEFAULTS, type PolySynthParams } from './poly-params';
import { withoutParamMirror } from '../session/session-engine-state';
import type { EngineParamSpec } from '../engines/engine-params';
import type { SynthEngine } from '../engines/engine-types';
import type { SessionState } from '../session/session';

const LANE = 'subtractive-1';

/** Every subtractive dot-id, declared as a spec so a bulk commit has the same
 *  param list the real engine exposes. */
const SPECS: EngineParamSpec[] = Object.entries(polyParamsToFlat(POLY_DEFAULTS))
  .map(([id, v]) => ({ id, label: id, kind: 'continuous', min: -100, max: 100, default: v }));

function fixture() {
  const values = new Map(SPECS.map((s) => [s.id, s.default] as const));
  let refreshed = 0;
  const engine = {
    params: SPECS,
    getBaseValue: (id: string) => values.get(id) ?? 0,
    setBaseValue: (id: string, v: number) => { values.set(id, v); },
    // A factory preset recall: the engine owns the mapping, we only see the
    // base values move.
    applyPreset: (_name: string) => { for (const s of SPECS) values.set(s.id, s.default + 1); },
  };
  const state = {
    lanes: [{ id: LANE, engineId: 'subtractive', clips: [], inserts: [] }],
  } as unknown as SessionState;
  const deps: PolyPresetApplyDeps = {
    getLaneEngineInstance: () => engine as unknown as SynthEngine,
    getSessionState: () => state,
    refreshLaneKnobs: () => { refreshed++; },
  };
  return { engine, state, deps, refreshCount: () => refreshed };
}

const paramsOf = (state: SessionState) =>
  state.lanes.find((l) => l.id === LANE)?.engineState?.params ?? {};

/** The invariant all three share: engineState.params reports exactly what the
 *  engine now holds, param by param. Relative by construction — the expected
 *  value is read back off the engine, never written as a literal. */
function expectMirrorsEngine(f: ReturnType<typeof fixture>) {
  const params = paramsOf(f.state);
  for (const spec of SPECS) expect(params[spec.id]).toBe(f.engine.getBaseValue(spec.id));
}

describe('poly preset / randomize applies reach engineState.params', () => {
  it('applyEnginePresetToLane mirrors the recalled preset and repaints the knobs', () => {
    const f = fixture();

    applyEnginePresetToLane(f.deps, LANE, 'PAD Warm');

    expectMirrorsEngine(f);
    expect(f.refreshCount(), 'the knob repaint still happens').toBe(1);
  });

  it('applyUserPolyPresetToLane mirrors a user preset flattened to dot-ids', () => {
    const f = fixture();
    const user: PolySynthParams = JSON.parse(JSON.stringify(POLY_DEFAULTS));
    user.filter.cutoff = POLY_DEFAULTS.filter.cutoff / 2;
    user.osc1.wave = 'triangle';

    applyUserPolyPresetToLane(f.deps, LANE, user);

    expectMirrorsEngine(f);
    expect(paramsOf(f.state)['filter.cutoff']).toBe(user.filter.cutoff);
  });

  // The randomize case moved out with randomizeSubtractiveLane: the dice is one
  // shared implementation over the engine's declared params now
  // (engines/engine-randomize.test.ts), not a subtractive-only path here.

  it('both stay silent inside withoutParamMirror (the load path)', () => {
    const f = fixture();

    withoutParamMirror(() => {
      applyEnginePresetToLane(f.deps, LANE, 'PAD Warm');
      applyUserPolyPresetToLane(f.deps, LANE, POLY_DEFAULTS);
    });

    expect(f.state.lanes[0].engineState?.params).toBeUndefined();
    expect(f.refreshCount(), 'the engine and the display still moved').toBe(2);
  });
});
