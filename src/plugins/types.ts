import type { EngineParamSpec } from '../engines/engine-params';
import type { VoiceTriggerOptions } from '../engines/engine-types';
import type { ModulatorState } from '../modulation/types';

export type PluginKind = 'synth' | 'fx' | 'modulator';

/** Alias the unified param spec under a kind-neutral name. EngineParamSpec
 *  stays the canonical type. */
export type ParamSpec = EngineParamSpec;

export interface PluginPreset {
  name: string;
  gm?: number[];
  params: Record<string, number>;
  modulators?: ModulatorState[];
}

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly kind: PluginKind;
  readonly version: string;
  readonly params: ParamSpec[];
  /** Static presets bundled with the plugin. May be empty when an external
   *  loader (e.g. `preset-loader.ts`) owns presets for this id. */
  readonly presets: PluginPreset[];
}

export interface SynthInstance {
  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void;
  release(time: number): void;
  connect(dest: AudioNode): void;
  getAudioParams(): Map<string, AudioParam>;
  getAudioParamRange?(shortId: string): { min: number; max: number } | undefined;
  getSharedAudioParams?(ctx?: AudioContext): Map<string, AudioParam>;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  dispose(): void;
}

export interface FxInstance {
  readonly input: AudioNode;
  readonly output: AudioNode;
  getAudioParams(): Map<string, AudioParam>;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  setBpm?(bpm: number): void;
  dispose(): void;
}

export interface ModulatorInstance {
  readonly output: AudioNode;
  getAudioParams(): Map<string, AudioParam>;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  setBpm?(bpm: number): void;
  trigger?(time: number, opts: { gateDuration: number; accent?: boolean }): void;
  release?(time: number): void;
  dispose(): void;
}

export type PluginFactory =
  | { kind: 'synth';     manifest: PluginManifest;
      create(ctx: AudioContext, output: AudioNode): SynthInstance }
  | { kind: 'fx';        manifest: PluginManifest;
      create(ctx: AudioContext): FxInstance }
  | { kind: 'modulator'; manifest: PluginManifest;
      create(ctx: AudioContext, bpm: number): ModulatorInstance };
