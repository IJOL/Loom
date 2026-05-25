// src/engines/subtractive.ts
// Wraps the existing PolySynth as the default 'subtractive' engine.

import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, ParamDef } from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { PolySynth, POLY_DEFAULTS } from '../polysynth';

class SubtractiveVoice implements Voice {
  constructor(
    private polysynth: PolySynth,
    private output: AudioNode,
  ) {}

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    this.polysynth.trigger(midi, time, options.gateDuration, options.accent ?? false);
  }

  release(_time: number): void {
    // PolySynth handles release internally via gateDuration scheduling
  }

  connect(_dest: AudioNode): void {
    // PolySynth already connected to destination in constructor
  }

  dispose(): void {
    // PolySynth voices self-cleanup after stopTime
  }
}

class SubtractiveSequencer implements EngineSequencer {
  getStepAt(_index: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_step: number): void {}
  serialize(): unknown { return null; }
  deserialize(_data: unknown): void {}
  dispose(): void {}
}

const SUBTRACTIVE_PARAMS: ParamDef[] = [
  { id: 'cutoff',    label: 'Cutoff',    min: 0, max: 1, default: POLY_DEFAULTS.filter.cutoff },
  { id: 'resonance', label: 'Resonance', min: 0, max: 1, default: POLY_DEFAULTS.filter.resonance },
  { id: 'envAmount', label: 'Env Amount', min: 0, max: 1, default: POLY_DEFAULTS.filter.envAmount },
  { id: 'drive',     label: 'Drive',     min: 0, max: 1, default: POLY_DEFAULTS.filter.drive },
  { id: 'osc1Level', label: 'Osc 1',     min: 0, max: 1, default: POLY_DEFAULTS.osc1.level },
  { id: 'osc2Level', label: 'Osc 2',     min: 0, max: 1, default: POLY_DEFAULTS.osc2.level },
  { id: 'subLevel',  label: 'Sub',       min: 0, max: 1, default: POLY_DEFAULTS.sub.level },
  { id: 'noiseLevel',label: 'Noise',     min: 0, max: 1, default: POLY_DEFAULTS.noise.level },
];

class SubtractiveEngine implements SynthEngine {
  readonly id = 'subtractive';
  readonly name = 'Subtractive';
  readonly type = 'polyhost' as const;
  readonly polyphony = 8;
  readonly params = SUBTRACTIVE_PARAMS;

  private polysynth: PolySynth | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (!this.polysynth) {
      this.polysynth = new PolySynth(ctx, output);
    }
    return new SubtractiveVoice(this.polysynth, output);
  }

  getPolySynth(): PolySynth | null {
    return this.polysynth;
  }

  setPolySynth(ps: PolySynth): void {
    this.polysynth = ps;
  }

  buildSequencer(_container: HTMLElement, _stepCount: number): EngineSequencer {
    return new SubtractiveSequencer();
  }

  buildParamUI(_container: HTMLElement): void {
    // For subtractive, main.ts already builds the poly param UI
  }

  dispose(): void {
    this.polysynth = null;
  }
}

export const subtractiveEngine = new SubtractiveEngine();
registerEngine(subtractiveEngine);
// Factory: each per-lane subtractive needs its OWN PolySynth, which the caller
// must attach via setPolySynth(...) before triggering (createVoice requires it).
registerEngineFactory('subtractive', () => new SubtractiveEngine());
