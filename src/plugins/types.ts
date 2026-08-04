import type { EngineParamSpec } from '../engines/engine-params';
import type { VoiceTriggerOptions } from '../engines/engine-types';
import type { ModulatorState } from '../modulation/types';
import type { FxInstance } from '@loom/plugin-sdk';

export type PluginKind = 'engine' | 'fx' | 'notefx';

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
  /** Rack colour, for an fx manifest. Absent on engines. */
  readonly color?: string;
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

// FxInstance lives in the SDK: it is the shape a third-party insert compiles
// against, and two declarations of one shape guarantee an author picks the
// wrong one — the ModLite lesson, paid once already.
export type { FxInstance, FxFactory, FxDeclaration } from '@loom/plugin-sdk';

// A modulator is NOT a plugin-registry kind. It lives in its own registry,
// src/modulation/modulator-registry.ts, which is the one door for "what is this
// modulator and what can it do" — for built-ins and, from the plugin host's
// adoptComponents, for plugins too. This registry briefly held a 'modulator'
// kind whose two entries owned nothing and whose createInstance overload ended
// up with no caller at all; keeping it would have left TWO plausible homes for
// the same thing, which is how a plugin gets wired into the wrong one.

export interface NoteFxManifest { id: string; name: string; kind: 'notefx'; version: string; }
export interface NoteFxFactory {
  kind: 'notefx';
  manifest: NoteFxManifest;
  /** Returns default params for a fresh instance of this note-FX. */
  defaultParams(): Record<string, number | string | boolean>;
}

export type PluginFactory =
  | { kind: 'engine';    manifest: PluginManifest;
      create(ctx: AudioContext, output: AudioNode): SynthInstance }
  | { kind: 'fx';        manifest: PluginManifest;
      create(ctx: AudioContext): FxInstance }
  | NoteFxFactory;
