import { normaliseSelectIndex } from '../core/select-control';
import { wireDrumMasterUI } from '../core/drum-master-ui';
import { mountLaneFxPanel as mountLaneFxPanelInner } from '../core/lane-fx-panel';
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
  refreshLaneKnobs(laneId: string, engine: SynthEngine): void;
}

function pageForLane(laneId: string): string {
  // Map canonical lane ids to the corresponding `data-page` attribute.
  // Drums (LANE_ID_DRUMS='drums-1') -> 'drums'; everything else -> 'instrument',
  // INCLUDING the bass: the TB-303 no longer has a page of its own.
  //
  // SECOND COPY of the routing showLaneEditor does with its `targetTab`. They
  // must agree: this one picks the page whose `.lane-fx-knobs` slot the per-lane
  // FX panel mounts into, and if it names a page that does not exist the panel
  // silently never mounts — the sidechain select simply is not there.
  if (laneId === 'drums-1')  return 'drums';
  return 'instrument';
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

  // refreshKnobsFromSynth is GONE. It repainted one hardcoded lane
  // ('tb-303-1') and only when its engine was literally 'tb303' — leftover glue
  // from the days the 303 had a page of its own. It was still called, from
  // applyLoadedStateV3, but by then applyLoadedSessionState has already run
  // applyEngineState() and THEN renderWithMixer(), which rebuilds every lane's
  // param grid from engine.getBaseValue. It repainted correct values onto one
  // lane, and it was the last `engine.id === 'tb303'` in src/app.

  const refreshLaneKnobs = (laneId: string, engine: SynthEngine) => {
    // Display-only repaint: a handle's setValue fires the same onChange a user
    // drag does, and that onChange now mirrors into engineState.params. Left
    // unguarded, the load path (preset recall → here → THEN replay params)
    // would overwrite the very values it was about to restore.
    withoutParamMirror(() => {
      for (const spec of engine.params) {
        const handle = deps.registry.get(`${laneId}.${spec.id}`);
        if (!handle) continue;
        // Resolve the SAME option list the live control was built from
        // (engine-param-grid.ts's buildControl): `optionsFrom`, when present,
        // rebuilds from another param's current value and can be a DIFFERENT
        // length than the static `spec.options` (e.g. the Subtractive filter
        // Type strip: 4 taps under DIG, 3 under MOG/303/COMB). Normalising
        // against the wrong length disagrees with the control's own
        // quantiseSelectValue and both paints and commits the wrong option.
        const options = spec.kind === 'discrete'
          ? (spec.optionsFrom
              ? (spec.optionsFrom.table[String(Math.round(engine.getBaseValue(spec.optionsFrom.paramId)))]
                 ?? spec.options)
              : spec.options)
          : undefined;
        if (options && options.length > 0) {
          const idx = Math.round(engine.getBaseValue(spec.id));
          handle.setValue(normaliseSelectIndex(idx, options.length));
        } else {
          handle.setValue(engine.getBaseValue(spec.id));
        }
      }
    });
  };

  return {
    mountDrumMasterLaneKnobs, mountLaneFxPanel,
    refreshLaneKnobs,
  };
}
