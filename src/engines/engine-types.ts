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

export interface EngineUIContext {
  laneId: string;
  idPrefix: string;
  registerKnob: (k: unknown) => void;
}

export interface EnginePreset {
  name: string;
  params: Record<string, number>;
}

export interface SynthEngine {
  readonly id: string;
  readonly name: string;
  readonly type: 'polyhost' | 'tab';
  readonly polyphony: 'mono' | 'poly';
  readonly editor: 'piano-roll' | 'drum-grid';
  readonly params: ParamDef[];
  readonly presets: EnginePreset[];
  createVoice(ctx: AudioContext, output: AudioNode): Voice;
  buildSequencer(container: HTMLElement, stepCount: number): EngineSequencer;
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void;
  applyPreset(name: string): void;
  randomize?(): void;
  dispose(): void;
}
