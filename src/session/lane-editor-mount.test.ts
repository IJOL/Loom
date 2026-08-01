/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { injectEngineModulatorPanel } from './session-host-lane-editor';
import type { SessionHost } from './session-host';
import type { SessionState } from './session';
import type { KnobHandle } from '../core/knob';
import { landAutomationValue } from '../automation/automation-knob';
import { applyLiveControlWrite } from '../automation/live-control-apply';
import { applyAutomationToSession } from '../automation/automation-apply';
import { commitParamForLane } from '../engines/engine-param-commit';

const knob = (id: string): KnobHandle =>
  ({ el: document.createElement('div'), setValue() {}, meta: { id, label: id, min: 0, max: 1 } }) as unknown as KnobHandle;

function hostWith(registry: Map<string, KnobHandle>, engineParamIds: (laneId: string) => string[]) {
  document.body.innerHTML = '<div class="page" data-page="poly"><div id="poly-fx-row"></div></div>';
  const lanes = [
    { id: 'fm-1', engineId: 'fm', name: 'FM', clips: [], inserts: [] },
    { id: 'sub-1', engineId: 'subtractive', name: 'Sub', clips: [], inserts: [] },
  ];
  const engineFor = (laneId: string) => ({
    id: lanes.find((l) => l.id === laneId)!.engineId,
    params: [],
    buildParamUI(container: HTMLElement, ctx: { registerKnob(k: KnobHandle): void }) {
      for (const id of engineParamIds(laneId)) {
        const k = knob(`${laneId}.${id}`);
        container.appendChild(k.el);
        ctx.registerKnob(k);
      }
    },
  });
  const deps = {
    automationRegistry: registry,
    laneResources: { get: (id: string) => ({ engine: engineFor(id) }) },
    registerKnob: (k: KnobHandle) => { if (k.meta.id) registry.set(k.meta.id, k); },
  };
  return {
    state: { lanes },
    deps,
    registerKnobHandle(k: KnobHandle) { deps.registerKnob(k); },
    inspector: { mountLaneInserts() {} },
  } as unknown as SessionHost;
}

/** A minimal ParamTarget: enough for applyAutomationToSession /
 *  applyLiveControlWrite / commitParamForLane, all of which only need
 *  get/setBaseValue. */
function makeEngine(initial: number) {
  let value = initial;
  return {
    getBaseValue: (_id: string) => value,
    setBaseValue: (_id: string, v: number) => { value = v; },
    get value() { return value; },
  };
}

describe('lane editor mount transaction', () => {
  let registry: Map<string, KnobHandle>;
  beforeEach(() => { registry = new Map(); });

  it('drops the previous lane engine knobs when the editor re-points', () => {
    const host = hostWith(registry, (laneId) => (laneId === 'fm-1' ? ['op1.ratio'] : ['filter.cutoff']));

    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    expect(registry.has('fm-1.op1.ratio')).toBe(true);

    injectEngineModulatorPanel(host, 'sub-1', 'poly');
    expect(registry.has('fm-1.op1.ratio')).toBe(false);
    expect(registry.has('sub-1.filter.cutoff')).toBe(true);
  });

  it('never drops a knob mounted outside the host — the mixer strip survives', () => {
    const host = hostWith(registry, () => ['op1.ratio']);
    registry.set('fm-1.bus.level', knob('fm-1.bus.level'));   // the mixer column owns this

    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    injectEngineModulatorPanel(host, 'sub-1', 'poly');

    expect(registry.has('fm-1.bus.level')).toBe(true);
  });

  it('re-opening the same lane leaves exactly one live handle per id', () => {
    const host = hostWith(registry, () => ['op1.ratio']);

    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    const first = registry.get('fm-1.op1.ratio');
    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    const second = registry.get('fm-1.op1.ratio');

    expect(second).toBeDefined();
    expect(second).not.toBe(first);              // the rebuilt widget, not the stale one
    expect(second!.el.isConnected).toBe(true);   // and it is the one in the DOM
  });

  // ── Step 5: the by-id write surfaces still reach a lane whose editor closed ──
  // injectEngineModulatorPanel unregisters fm-1's knobs the moment the editor
  // re-points to sub-1. These three prove Task 1's unmounted paths pick up
  // exactly where the removed handle left off — one test per write surface.

  it('an XY-pad write reaches a lane whose editor is closed', () => {
    const host = hostWith(registry, () => ['op1.ratio']);
    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    injectEngineModulatorPanel(host, 'sub-1', 'poly');
    expect(registry.has('fm-1.op1.ratio')).toBe(false);

    const engine = makeEngine(0.2);
    const state = { lanes: [{ id: 'fm-1' }] } as unknown as SessionState;
    const ok = applyLiveControlWrite('fm-1.op1.ratio', 0.75, {
      getInsertFx: () => undefined,
      getEngine: (laneId) => (laneId === 'fm-1' ? engine : undefined),
      getRange: () => ({ min: 0, max: 1 }),
      sessionState: state,
    });

    expect(ok).toBe(true);
    expect(engine.value).toBeCloseTo(0.75);
    // A live gesture persists — this is the mirror a mounted knob's onChange
    // would otherwise have performed.
    expect(state.lanes[0].engineState?.params?.['op1.ratio']).toBeCloseTo(0.75);
  });

  it('a MIDI-surface write reaches a lane whose editor is closed', () => {
    const host = hostWith(registry, () => ['op1.ratio']);
    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    injectEngineModulatorPanel(host, 'sub-1', 'poly');
    expect(registry.has('fm-1.op1.ratio')).toBe(false);

    const engine = makeEngine(0.2);
    const state = { lanes: [{ id: 'fm-1' }] } as unknown as SessionState;
    // loom-facade's setEngineParam falls back to exactly this call when
    // knobRegistry has no handle for the id.
    commitParamForLane(engine, state, 'fm-1', 'op1.ratio', 0.9);

    expect(engine.value).toBeCloseTo(0.9);
    expect(state.lanes[0].engineState?.params?.['op1.ratio']).toBeCloseTo(0.9);
  });

  it('a take curve reaches a lane whose editor is closed', () => {
    const host = hostWith(registry, () => ['op1.ratio']);
    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    injectEngineModulatorPanel(host, 'sub-1', 'poly');
    expect(registry.has('fm-1.op1.ratio')).toBe(false);

    const engine = makeEngine(0.2);
    landAutomationValue(
      {
        registry,
        applyUnmounted: (paramId, normalised, ranges) =>
          applyAutomationToSession(paramId, normalised, {
            getInsertFx: () => undefined,
            getEngine: () => engine,
            getRange: (id) => ranges.get(id),
          }),
        getTargetRanges: () => new Map([['fm-1.op1.ratio', { min: 0, max: 1 }]]),
      },
      'fm-1.op1.ratio',
      0.6,
    );

    expect(engine.value).toBeCloseTo(0.6);
    // Playback semantics: the value reaches the engine and nothing else — a
    // curve belongs to the clip/take, not to the lane's saved base sound. That
    // guarantee is structural, not something this test can exercise: unlike
    // LiveControlApplyDeps (live-control-apply.ts), AutomationApplyDeps
    // (automation-apply.ts) carries no sessionState at all, so there is no
    // handle through which this call could reach lane.engineState even by
    // accident — asserting on a `state` object that was never wired into the
    // deps above would only prove the test's own fixture is inert, not that
    // the production path doesn't mirror.
  });
});
