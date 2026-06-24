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
export function createDescriptorEngine(cfg: DescriptorEngineConfig): SynthEngine {
  const modHost = new ModulationHostImpl(cfg.modulators ?? []);
  const state: Record<string, number> = {};
  for (const p of cfg.params) state[p.id] = p.default;

  return {
    id: cfg.id,
    name: cfg.name,
    type: 'polyhost',
    polyphony: cfg.polyphony,
    editor: cfg.editor ?? 'piano-roll',
    params: cfg.params,
    get presets(): EnginePreset[] { return cfg.presets(); },
    get modulators(): ModulationHostImpl { return modHost; },

    getBaseValue(id: string): number {
      return state[id] ?? cfg.params.find((p) => p.id === id)?.default ?? 0;
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
  };
}
