import { normaliseSelectIndex } from '../core/select-control';
import { wireDrumMasterUI } from '../core/drum-master-ui';
import { mountLaneFxPanel as mountLaneFxPanelInner } from '../core/lane-fx-panel';
import { LANE_ID_BASS } from '../core/lane-ids';
import type { KnobHandle } from '../core/knob';
import type { SynthEngine } from '../engines/engine-types';
import type { LaneResourceMap } from '../core/lane-resources';
import type { SessionState } from '../session/session';
import type { HistoryDeps } from '../save/history-wiring';
import { withoutParamMirror } from '../session/session-engine-state';

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

export interface KnobMounter {
  mountDrumMasterLaneKnobs(laneId: string): void;
  mountLaneFxPanel(laneId: string): void;
  refreshKnobsFromSynth(): void;
  refreshLaneKnobs(laneId: string, engine: SynthEngine): void;
}

function pageForLane(laneId: string): string {
  // Map canonical lane ids to the corresponding `data-page` attribute.
  // Drums (LANE_ID_DRUMS='drums-1') -> 'drums'; everything else -> 'poly',
  // INCLUDING the bass: the TB-303 no longer has a page of its own.
  if (laneId === 'drums-1')  return 'drums';
  return 'poly';
}

export function createKnobMounter(deps: KnobMounterDeps): KnobMounter {
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
    // Display-only repaint: a handle's setValue fires the same onChange a user
    // drag does, and that onChange now mirrors into engineState.params. Left
    // unguarded, the load path (preset recall → here → THEN replay params)
    // would overwrite the very values it was about to restore.
    withoutParamMirror(() => {
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
    });
  };

  return {
    mountDrumMasterLaneKnobs, mountLaneFxPanel,
    refreshKnobsFromSynth, refreshLaneKnobs,
  };
}
