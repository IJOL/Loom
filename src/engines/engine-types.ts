// src/engines/engine-types.ts

export interface ParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  curve?: 'linear' | 'exponential' | 'log';
  unit?: string;
}

export interface Voice {
  trigger(midi: number, time: number, options: VoiceTriggerOptions): void;
  release(time: number): void;
  connect(dest: AudioNode): void;
  dispose(): void;
}

export interface VoiceTriggerOptions {
  accent?: boolean;
  slide?: boolean;
  velocity?: number;
  gateDuration: number;
}

export interface EngineSequencer {
  getStepAt(index: number): unknown;
  setLength(n: number): void;
  highlight(step: number): void;
  serialize(): unknown;
  deserialize(data: unknown): void;
  dispose(): void;
}

// Optional context the host passes to engine.buildParamUI so engine knobs can
// participate in the global automation registry. `idPrefix` should be unique
// per lane (e.g. 'main', 'poly1') so concurrent lanes' knobs don't collide.
// The registerKnob callback accepts a duck-typed shape; engines pass the
// KnobHandle returned by createKnob and the host registers it.
export interface EngineUIContext {
  laneId: string;
  idPrefix: string;
  // Intentionally loose — engines pass createKnob() handles, host casts.
  registerKnob: (k: unknown) => void;
}

export interface SynthEngine {
  readonly id: string;
  readonly name: string;
  readonly type: 'polyhost' | 'tab';
  readonly polyphony: number | 'mono';
  readonly params: ParamDef[];
  createVoice(ctx: AudioContext, output: AudioNode): Voice;
  buildSequencer(container: HTMLElement, stepCount: number): EngineSequencer;
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void;
  /** Optional: randomize engine state. If omitted, host applies a generic
   *  per-param uniform random over `params`. */
  randomize?(): void;
  dispose(): void;
}
