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
// methods (createVoice/buildSequencer/buildParamUI) are inert — nothing on the
// live or offline path calls them on the registered singleton, which is purely a
// metadata descriptor. Each engine file registers one of these.

import type {
  SynthEngine, Voice, EngineSequencer, EnginePreset,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { ModulationHostImpl } from '../modulation/modulation-host';
import type { ModulatorState } from '../modulation/types';
import { STRIP_PARAM_SPECS } from '../core/channel-strip-params';

export interface DescriptorEngineConfig {
  id: string;
  name: string;
  polyphony: 'mono' | 'poly';
  editor?: 'piano-roll' | 'drum-grid';
  params: EngineParamSpec[];
  /** Lazy preset getter (usually getCachedPresets(<id>)). */
  presets: () => EnginePreset[];
  /** Default modulator set (data) — seeds the host's serialized state used by
   *  the worklet lane to construct its in-worklet modulation. */
  modulators?: ModulatorState[];
  /** See SynthEngine.subGroupFor. */
  subGroupFor?: (paramId: string) => { key: string; label: string } | undefined;
  /** See SynthEngine.dynamicParamsFor. */
  dynamicParamsFor?: (lane: import('../session/session').SessionLane) => EngineParamSpec[];
}

const inertSequencer = (): EngineSequencer => ({
  getStepAt: () => null, setLength() {}, highlight() {},
  serialize: () => null, deserialize() {}, dispose() {},
});

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
  const modHost = new ModulationHostImpl(cfg.modulators ?? []);
  const params = withStripParams(cfg.params);
  const state: Record<string, number> = {};
  for (const p of params) state[p.id] = p.default;

  return {
    id: cfg.id,
    name: cfg.name,
    type: 'polyhost',
    polyphony: cfg.polyphony,
    editor: cfg.editor ?? 'piano-roll',
    params,
    get presets(): EnginePreset[] { return cfg.presets(); },
    get modulators(): ModulationHostImpl { return modHost; },

    getBaseValue(id: string): number {
      return state[id] ?? params.find((p) => p.id === id)?.default ?? 0;
    },
    setBaseValue(id: string, v: number): void { state[id] = v; },

    // Inert synthesis surface — the live path never calls these on the
    // registered metadata singleton (it builds a WorkletLaneEngine instead).
    createVoice: () => inertVoice(),
    buildSequencer: () => inertSequencer(),
    buildParamUI() { /* metadata-only */ },
    applyPreset(name: string): void {
      const preset = cfg.presets().find((p) => p.name === name);
      if (!preset) return;
      for (const [id, val] of Object.entries(preset.params as Record<string, number>)) {
        if (typeof val === 'number') state[id] = val;
      }
      if (preset.modulators) modHost.deserialize(preset.modulators);
    },
    dispose() { /* no live resources */ },
    subGroupFor: cfg.subGroupFor,
    dynamicParamsFor: cfg.dynamicParamsFor,
  };
}
