// src/engines/descriptor-engine.ts
//
// Phase 4 cutover: the legacy node-per-note engine classes are gone. The live
// path synthesises through the AudioWorklet (WorkletLaneEngine / DrumsWorklet /
// SamplerWorklet / AudioWorklet) and offline render goes through the pure
// audio-dsp kernel. What still has to exist per engine is its METADATA — id,
// name, polyphony, editor, the EngineParamSpec[] and the default modulator set —
// which the engine registry exposes via getEngine()/getEngineDescriptor()/
// listEngines() (engine selector UI, GM matching, save/load, automation
// destinations, offline ParamBag assembly).
//
// This factory builds a thin, DATA-ONLY SynthEngine: it carries the spec +
// preset getter + a ModulationHostImpl (state container) and serves
// getBaseValue/setBaseValue over an in-memory ParamBag, but its synthesis
// methods (createVoice/buildParamUI) are inert — nothing on the
// live or offline path calls them on the registered singleton, which is purely a
// metadata descriptor. Each engine file registers one of these.

import type {
  SynthEngine, Voice, EnginePreset,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { EngineParamGroup } from './engine-param-groups';
import { ModulationHostImpl } from '../modulation/modulation-host';
import type { ModulatorState } from '../modulation/types';
import { STRIP_PARAM_SPECS } from '../core/channel-strip-params';
import { defaultNoteViewOf } from '../plugins/capabilities';

export interface DescriptorEngineConfig {
  id: string;
  name: string;
  polyphony: 'mono' | 'poly';
  params: EngineParamSpec[];
  /** Declared editor layout for `params`. See SynthEngine.groups. */
  groups?: EngineParamGroup[];
  /** Lazy preset getter (usually getCachedPresets(<id>)). */
  presets: () => EnginePreset[];
  /** Default modulator set (data) — seeds the host's serialized state used by
   *  the worklet lane to construct its in-worklet modulation. Accepts a lazy
   *  thunk because the sets engines actually pass are built by calling
   *  getModulator('lfo')/('adsr').defaultState(...): this factory runs at
   *  MODULE SCOPE for every one of the nine engines (registerEngine(...) is
   *  called at the top of each engine file), while the lfo/adsr COMPONENTS
   *  register themselves from src/plugins/modulators/*, discovered by a
   *  SEPARATE eager glob (plugin-bootstrap). Nothing orders those two globs
   *  against each other. Evaluating the modulator set right here would race
   *  that order and could throw (or, worse, silently ship a lane with no
   *  envelope) depending on which glob happens to run first. A thunk defers
   *  the read to the first real access — see ensureModHost below — by which
   *  point every eager module in the app has already finished loading. */
  modulators?: ModulatorState[] | (() => ModulatorState[]);
  /** See SynthEngine.subGroupFor. */
  subGroupFor?: (paramId: string) => { key: string; label: string } | undefined;
  /** See SynthEngine.dynamicParamsFor. */
  dynamicParamsFor?: (lane: import('../session/session').SessionLane) => EngineParamSpec[];
  /** See SynthEngine.structuralFor. */
  structuralFor?: (lane: import('../session/session').SessionLane) => unknown;
  /** See SynthEngine.extraUI. */
  extraUI?: (
    host: HTMLElement, ctx: import('./engine-types').EngineUIContext,
    engine: import('./engine-types').SynthEngine,
  ) => void;
  /** See SynthEngine.dynamicGroupsFor. */
  dynamicGroupsFor?: (lane: import('../session/session').SessionLane) => EngineParamGroup[];
  /** See SynthEngine.hideParam. */
  hideParam?: (laneId: string, paramId: string) => boolean;
}

const inertVoice = (): Voice => ({
  trigger() {}, release() {}, connect() {}, dispose() {},
  getAudioParams: () => new Map(),
});

/** Build a metadata-only SynthEngine for the registry. Synthesis is handled by
 *  the worklet engines / audio-dsp kernel — this object only answers metadata
 *  and scalar param state. */
/** The engine's own params plus the seven its lane's ChannelStrip contributes.
 *
 *  Every lane has a strip — level, pan, the two sends, three EQ bands — and its
 *  mixer column shows them, so they are automation destinations on every lane
 *  regardless of engine. Appending them HERE rather than in each engine file is
 *  what stops the tenth engine from silently shipping without them, which is the
 *  state eight of the nine were in: the catalogue reads `engine.params`, so a
 *  param no engine declared had no destination and no right-click menu.
 *
 *  Deduplicated because drums-machine declares the seven itself — its knobs and
 *  its saved envelopes predate this — and two copies would list every mixer
 *  param twice in every picker. */
function withStripParams(own: EngineParamSpec[]): EngineParamSpec[] {
  const declared = new Set(own.map((p) => p.id));
  return [...own, ...STRIP_PARAM_SPECS.filter((s) => !declared.has(s.id))];
}

export function createDescriptorEngine(cfg: DescriptorEngineConfig): SynthEngine {
  // Lazy on purpose — see DescriptorEngineConfig.modulators. Built on first
  // real access (the `modulators` getter below, or applyPreset), never at
  // this function's own call time, which for every in-tree engine IS module
  // scope (registerEngine(makeXDescriptor()) runs at import).
  let modHost: ModulationHostImpl | undefined;
  function ensureModHost(): ModulationHostImpl {
    if (!modHost) {
      const defaults = typeof cfg.modulators === 'function' ? cfg.modulators() : (cfg.modulators ?? []);
      modHost = new ModulationHostImpl(defaults);
    }
    return modHost;
  }
  const params = withStripParams(cfg.params);
  const state: Record<string, number> = {};
  for (const p of params) state[p.id] = p.default;

  return {
    id: cfg.id,
    name: cfg.name,
    type: 'polyhost',
    polyphony: cfg.polyphony,
    /** Derived, never declared: the note view comes from the engine's
     *  `defaultNoteView` capability. A getter rather than a value so it does not
     *  depend on whether the capability was registered before this descriptor
     *  was built. */
    get editor(): 'piano-roll' | 'drum-grid' {
      return defaultNoteViewOf(cfg.id) === 'pads' ? 'drum-grid' : 'piano-roll';
    },
    params,
    groups: cfg.groups,
    get presets(): EnginePreset[] { return cfg.presets(); },
    get modulators(): ModulationHostImpl { return ensureModHost(); },

    getBaseValue(id: string): number {
      return state[id] ?? params.find((p) => p.id === id)?.default ?? 0;
    },
    setBaseValue(id: string, v: number): void { state[id] = v; },

    // Inert synthesis surface — the live path never calls these on the
    // registered metadata singleton (it builds a WorkletLaneEngine instead).
    createVoice: () => inertVoice(),
    buildParamUI() { /* metadata-only */ },
    applyPreset(name: string): void {
      const preset = cfg.presets().find((p) => p.name === name);
      if (!preset) return;
      for (const [id, val] of Object.entries(preset.params as Record<string, number>)) {
        if (typeof val === 'number') state[id] = val;
      }
      if (preset.modulators) ensureModHost().deserialize(preset.modulators);
    },
    dispose() { /* no live resources */ },
    subGroupFor: cfg.subGroupFor,
    dynamicParamsFor: cfg.dynamicParamsFor,
    structuralFor: cfg.structuralFor,
    extraUI: cfg.extraUI,
    dynamicGroupsFor: cfg.dynamicGroupsFor,
    hideParam: cfg.hideParam,
  };
}
