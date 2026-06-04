// src/engines/engine-types.ts

export type { EngineParamSpec } from './engine-params';
// Back-compat alias: code transitioning to the new name can still reference ParamDef.
export type ParamDef = import('./engine-params').EngineParamSpec;

export interface Voice {
  trigger(midi: number, time: number, options: VoiceTriggerOptions): void;
  release(time: number): void;
  connect(dest: AudioNode): void;
  dispose(): void;
  /** Per-voice AudioParams keyed by EngineParamSpec.id. The modulator binder
   *  connects each enabled connection through a depth-gain into the matching
   *  entry. Discrete-only params may be absent. */
  getAudioParams(): Map<string, AudioParam>;
  /** Optional: declare the AudioParam's operating range for modulation depth
   *  scaling, when it differs from the spec range. E.g. a spec might say
   *  `filter.cutoff` is 0..1 (a normalized knob value) while the underlying
   *  AudioParam is `BiquadFilterNode.frequency` operating in Hz. The
   *  modulator binder uses this range when building the depth gain so
   *  depth=1.0 produces a full-swing modulation in the param's native units.
   *  Returning undefined falls back to the spec range. */
  getAudioParamRange?(shortId: string): { min: number; max: number } | undefined;
}

export interface VoiceTriggerOptions {
  accent?: boolean;
  slide?: boolean;
  velocity?: number;
  gateDuration: number;
  /** Loop/song audio clip to play directly (sampler). When present, the voice
   *  plays this buffer for `gateDuration` instead of resolving the lane keymap. */
  sample?: import('../session/session').ClipSample;
  /** Slice-mode playback (sampler): play this sub-region of a buffer at
   *  natural pitch, applying the per-pad params keyed by the trigger note.
   *  Set by the scheduler for warpMode==='slice' loop clips. */
  slice?: { sampleId: string; start: number; end: number };
}

export interface EngineSequencer {
  getStepAt(index: number): unknown;
  setLength(n: number): void;
  highlight(step: number): void;
  serialize(): unknown;
  deserialize(data: unknown): void;
  dispose(): void;
}

export interface EngineUIContext {
  laneId: string;
  registerKnob: (k: unknown) => void;
  /** Read-only view of every automatable knob registered so far. Used by
   *  the modulation panel to populate destination dropdowns. */
  registry: Map<string, unknown>;
  /** Optional session-lane name resolver used by the modulators panel so
   *  destination labels show the user-facing session lane name instead of
   *  the internal `main` / `bass` / `drums` / `poly1` ids. */
  lookupLaneDisplayName?: (laneId: string) => string | undefined;
  /** Phase C: when present, knob mutations mirror into
   *  `sessionState.lanes[laneId].engineState.params` so the lane's sound
   *  persists across tab switches and save/load. */
  sessionState?: import('../session/session').SessionState;
  /** Optional undo history deps. When present, every knob drag/wheel/dblclick
   *  is bracketed as a single undo entry via attachKnobUndo. */
  historyDeps?: import('../save/history-wiring').HistoryDeps;
  /** Phase J: lane insert chain for this lane — used by the modulation
   *  destination dropdown to expose FX params as targets. */
  laneInserts?: import('../plugins/fx/insert-chain').InsertChain;
  /** Phase J: master insert chain — used by the modulation destination
   *  dropdown to expose master FX params as targets. */
  masterInserts?: import('../plugins/fx/insert-chain').InsertChain;
  /** Option B2: FxBus instance — used by the modulation destination dropdown
   *  to expose master send (reverb/delay) AudioParams as targets. Hidden from
   *  the insert picker to prevent double-tail bugs. */
  fxBus?: import('../core/fx').FxBus;
  /** Live AudioContext — sampler/UI code uses it to decode imported audio. */
  audioContext?: AudioContext;
  /** Place a freshly-built clip onto this lane (the sampler's "import as loop"
   *  flow). The host adds it to the lane's first empty clip slot and re-renders. */
  installClip?: (clip: import('../session/session').SessionClip) => void;
}

export interface EnginePreset<P = Record<string, number>> {
  name: string;
  /** Loose mapping to GM program numbers (0-127). Optional during the
   *  migration from inline-TS presets to JSON assets — JSON-sourced
   *  presets will always provide it. Code that reads `gm` should treat
   *  `undefined` as empty. */
  gm?: number[];
  params: P;
  modulators?: import('../modulation/types').ModulatorState[];
}

export interface SynthEngine {
  readonly id: string;
  readonly name: string;
  readonly type: 'polyhost' | 'tab';
  readonly polyphony: 'mono' | 'poly';
  readonly editor: 'piano-roll' | 'drum-grid';
  readonly params: import('./engine-params').EngineParamSpec[];
  readonly presets: EnginePreset[];
  /** Engine's modulation host — read by the voice-mod binder to enumerate
   *  enabled modulators when (re)applying gain bridges. Each engine owns
   *  exactly one host instance for its lifetime. */
  readonly modulators: import('../modulation/types').ModulationHost;
  /** Read the engine's current scalar state for a param. */
  getBaseValue(id: string): number;
  /** Write the engine's scalar state. Knob (user drag) and automation
   *  per-step write here. Engines apply this to internal state that future
   *  triggers read from. */
  setBaseValue(id: string, value: number): void;
  createVoice(ctx: AudioContext, output: AudioNode): Voice;
  buildSequencer(container: HTMLElement, stepCount: number): EngineSequencer;
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void;
  applyPreset(name: string): void;
  randomize?(): void;
  dispose(): void;
  /** AudioParams that SHARED modulators write to. The voice manager's
   *  modulation bus fans this out internally to every active per-voice
   *  AudioParam, so the binder makes ONE connection regardless of how
   *  many notes are playing. Returns an empty Map until the engine has
   *  a voice manager instance (lazy after first createVoice). */
  getSharedAudioParams?(ctx?: AudioContext): Map<string, AudioParam>;
}
