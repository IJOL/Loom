import { wireEngineParams } from '../engines/engine-ui';
import { wireDrumMasterUI } from '../core/drum-master-ui';
import { tb303Engine } from '../engines/tb303';
import { LANE_ID_BASS } from '../core/lane-ids';
import type { KnobHandle } from '../core/knob';
import type { SynthEngine, EngineUIContext } from '../engines/engine-types';
import type { LaneResourceMap } from '../core/lane-resources';
import type { TB303 } from '../core/synth';
import type { SessionState } from '../session/session';
import type { HistoryDeps } from '../save/history-wiring';

export interface KnobMounterDeps {
  registerKnob(k: KnobHandle): void;
  registry: Map<string, KnobHandle>;
  laneResources: LaneResourceMap;
  synth: TB303;
  fmtPct(v: number): string;
  fmtDb(v: number): string;
  getSessionState(): SessionState | undefined;
  getLaneDisplayName(id: string): string | undefined;
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
  refreshKnobsFromSynth(): void;
  refreshLaneKnobs(laneId: string, engine: SynthEngine): void;
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
    for (const [prefix, divId] of sectionMap) {
      const parent = document.getElementById(divId);
      if (!parent) continue;
      parent.innerHTML = '';
      wireEngineParams(engine, ctx, parent, { filter: (id) => id.startsWith(prefix) });
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

  const refreshKnobsFromSynth = () => {
    const liveValue = (specId: string): number | null => {
      switch (specId) {
        case 'filter.cutoff':    return deps.synth.params.cutoff;
        case 'filter.resonance': return deps.synth.params.resonance;
        case 'env.amount':       return deps.synth.params.envMod;
        case 'env.decay':        return deps.synth.params.decay;
        case 'env.accent':       return deps.synth.params.accent;
        case 'osc.wave':         return deps.synth.params.wave === 'square' ? 1 : 0;
      }
      return null;
    };
    for (const spec of tb303Engine.params) {
      const v = liveValue(spec.id);
      if (v == null) continue;
      deps.registry.get(`${LANE_ID_BASS}.${spec.id}`)?.setValue(v);
    }
  };

  const refreshLaneKnobs = (laneId: string, engine: SynthEngine) => {
    for (const spec of engine.params) {
      const handle = deps.registry.get(`${laneId}.${spec.id}`);
      handle?.setValue(engine.getBaseValue(spec.id));
    }
  };

  return {
    wireLaneKnobs, mountSubtractiveLaneKnobs, mountDrumMasterLaneKnobs,
    refreshKnobsFromSynth, refreshLaneKnobs,
  };
}
