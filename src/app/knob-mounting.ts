import { wireEngineParams } from '../engines/engine-ui';
import { normaliseSelectIndex } from '../core/select-control';
import { wireDrumMasterUI } from '../core/drum-master-ui';
import { mountLaneFxPanel as mountLaneFxPanelInner } from '../core/lane-fx-panel';
import { LANE_ID_BASS } from '../core/lane-ids';
import type { KnobHandle } from '../core/knob';
import type { SynthEngine, EngineUIContext } from '../engines/engine-types';
import type { LaneResourceMap } from '../core/lane-resources';
import type { SessionState } from '../session/session';
import type { HistoryDeps } from '../save/history-wiring';
import { mirrorParamChange } from '../session/session-engine-state';

export interface KnobMounterDeps {
  registerKnob(k: KnobHandle): void;
  registry: Map<string, KnobHandle>;
  laneResources: LaneResourceMap;
  // Phase G: synth field removed; refreshKnobsFromSynth now resolves the
  // TB303 instance lazily from laneResources at call time.
  fmtPct(v: number): string;
  fmtDb(v: number): string;
  getSessionState(): SessionState | undefined;
  getLaneDisplayName(id: string): string | undefined;
  sidechainBus: import('../core/sidechain-bus').SidechainBus;
  // Late-bound: _discreteHistoryDeps is assigned after createKnobMounter
  // runs, so the value must be read at use time (not at construction).
  getHistoryDeps?(): HistoryDeps | undefined;
}

export interface LaneWiringOpts {
  laneId: string;
  engine: SynthEngine;
  parent: HTMLElement;
  formatter?: (id: string, v: number) => string;
}

export interface KnobMounter {
  wireLaneKnobs(opts: LaneWiringOpts): void;
  mountSubtractiveLaneKnobs(laneId: string): void;
  mountDrumMasterLaneKnobs(laneId: string): void;
  mountLaneFxPanel(laneId: string): void;
  refreshKnobsFromSynth(): void;
  refreshLaneKnobs(laneId: string, engine: SynthEngine): void;
}

function pageForLane(laneId: string): string {
  // Map canonical lane ids to the corresponding `data-page` attribute.
  // Bass (LANE_ID_BASS='tb-303-1') -> '303'; drums (LANE_ID_DRUMS='drums-1') -> 'drums';
  // every other lane (subtractive-1, subtractive-2, …) -> 'poly'.
  if (laneId === 'tb-303-1') return '303';
  if (laneId === 'drums-1')  return 'drums';
  return 'poly';
}

export function createKnobMounter(deps: KnobMounterDeps): KnobMounter {
  const buildCtx = (laneId: string): EngineUIContext => ({
    laneId,
    registerKnob: (k) => deps.registerKnob(k as KnobHandle),
    registry: deps.registry as unknown as Map<string, unknown>,
    lookupLaneDisplayName: deps.getLaneDisplayName,
    // Lazy getters so we can build ctx before sessionHost / history are
    // initialized — consumers read them later, at knob-event time.
    get sessionState() { return deps.getSessionState(); },
    get historyDeps() { return deps.getHistoryDeps?.(); },
  });

  const wireLaneKnobs = (opts: LaneWiringOpts) => {
    wireEngineParams(opts.engine, buildCtx(opts.laneId), opts.parent, { formatter: opts.formatter });
  };

  const mountSubtractiveLaneKnobs = (laneId: string) => {
    const sectionMap: Array<[string, string]> = [
      ['osc1.',   'poly-osc1-knobs'],
      ['osc2.',   'poly-osc2-knobs'],
      ['sub.',    'poly-sub-knobs'],
      ['noise.',  'poly-noise-knobs'],
      ['filter.', 'poly-filter-knobs'],
      ['amp.',    'poly-amp-knobs'],
      ['master.', 'poly-master-knobs'],
    ];
    const engine = deps.laneResources.get(laneId)?.engine;
    if (!engine) return;
    const ctx = buildCtx(laneId);
    // Unified envelope model: the amp/filter ADSR + Built-in Env toggle now live in
    // the MODULATORS panel (the panel ADSRs ARE the envelopes), so don't mount the
    // duplicate built-in env knobs here.
    const ENV_LEAVES = new Set(['attack', 'decay', 'sustain', 'release', 'builtinEnv']);
    const isEnvKnob = (id: string): boolean => ENV_LEAVES.has(id.slice(id.indexOf('.') + 1));
    for (const [prefix, divId] of sectionMap) {
      const parent = document.getElementById(divId);
      if (!parent) continue;
      parent.innerHTML = '';
      wireEngineParams(engine, ctx, parent, { filter: (id) => id.startsWith(prefix) && !isEnvKnob(id) });
    }
    // The AMP section held only envelope knobs ⇒ now empty. Hide it + its label so
    // no orphan "AMP" header is left behind.
    const ampDiv = document.getElementById('poly-amp-knobs');
    if (ampDiv) {
      ampDiv.style.display = 'none';
      const lbl = ampDiv.previousElementSibling;
      if (lbl?.classList.contains('section-label')) (lbl as HTMLElement).style.display = 'none';
    }
  };

  const mountDrumMasterLaneKnobs = (laneId: string) => {
    const strip = deps.laneResources.get(laneId)?.strip;
    if (!strip) return;
    wireDrumMasterUI({
      laneId, drumBusStrip: strip,
      registerKnob: deps.registerKnob,
      fmtPct: deps.fmtPct,
      fmtDb: deps.fmtDb,
      get historyDeps() { return deps.getHistoryDeps?.(); },
    });
  };

  const mountLaneFxPanel = (laneId: string) => {
    const strip = deps.laneResources.get(laneId)?.strip;
    if (!strip) return;
    const slot = document.querySelector(
      `[data-page="${pageForLane(laneId)}"] .lane-fx-knobs`,
    ) as HTMLElement | null;
    if (!slot) return;
    mountLaneFxPanelInner({
      laneId,
      strip,
      bus: deps.sidechainBus,
      parent: slot,
      registerKnob: (k) => deps.registerKnob(k),
      historyDeps: deps.getHistoryDeps?.(),
      lookupLabel: deps.getLaneDisplayName,
    });
  };

  const refreshKnobsFromSynth = () => {
    // Phase 4 cutover: the bass lane's engine is a worklet engine. Refresh its
    // TB-303 knobs from the engine's scalar param state (getBaseValue) — the same
    // generic path as refreshLaneKnobs, no legacy TB303 instance needed.
    const engine = deps.laneResources.get(LANE_ID_BASS)?.engine;
    if (!engine || engine.id !== 'tb303') return;
    refreshLaneKnobs(LANE_ID_BASS, engine);
  };

  const refreshLaneKnobs = (laneId: string, engine: SynthEngine) => {
    for (const spec of engine.params) {
      const handle = deps.registry.get(`${laneId}.${spec.id}`);
      if (!handle) continue;
      if (spec.kind === 'discrete' && spec.options && spec.options.length > 0) {
        const idx = Math.round(engine.getBaseValue(spec.id));
        handle.setValue(normaliseSelectIndex(idx, spec.options.length));
      } else {
        handle.setValue(engine.getBaseValue(spec.id));
      }
    }
  };

  return {
    wireLaneKnobs, mountSubtractiveLaneKnobs, mountDrumMasterLaneKnobs, mountLaneFxPanel,
    refreshKnobsFromSynth, refreshLaneKnobs,
  };
}
