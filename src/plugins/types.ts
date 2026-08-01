import type { EngineParamSpec } from '../engines/engine-params';
import type { VoiceTriggerOptions } from '../engines/engine-types';
import type { ModulatorState } from '../modulation/types';

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
  /** Native modulation range for a param (the binder uses max−min as the
   *  depth=1 peak gain). Omit → the binder falls back to 0..1. Frequency-type
   *  params should expose their modulation AudioParam as a .detune (cents) here
   *  via getAudioParams + return a cents span, so a bipolar LFO sweeps the
   *  filter exponentially instead of summing ±1 Hz (inaudible). */
  getAudioParamRange?(shortId: string): { min: number; max: number } | undefined;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  setBpm?(bpm: number): void;
  dispose(): void;
}

// A modulator is NOT a plugin-registry kind. It lives in its own registry,
// src/modulation/modulator-registry.ts, which is the one door for "what is this
// modulator and what can it do" — for built-ins and, from the plugin ABI's
// registerComponent, for plugins too. This registry briefly held a 'modulator'
// kind whose two entries owned nothing and whose createInstance overload ended
// up with no caller at all; keeping it would have left TWO plausible homes for
// the same thing, which is how a plugin gets wired into the wrong one.

export interface NoteFxManifest { id: string; name: string; kind: 'notefx'; version: string; }
export interface NoteFxFactory {
  kind: 'notefx';
  manifest: NoteFxManifest;
  /** Returns default params for a fresh instance of this note-FX. */
  defaultParams(): Record<string, number | string>;
}

export type PluginFactory =
  | { kind: 'engine';    manifest: PluginManifest;
      create(ctx: AudioContext, output: AudioNode): SynthInstance }
  | { kind: 'fx';        manifest: PluginManifest;
      create(ctx: AudioContext): FxInstance }
  | NoteFxFactory;
