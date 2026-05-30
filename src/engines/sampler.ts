// src/engines/sampler.ts
// Sampler engine: plays one-shot samples pitched per MIDI note. Phase 2 of the
// sampler spec (loop/song clip playback, modulation wiring, voice-stealing and
// the keymap UI arrive in later plans). The voice is built in Task 7.

import type {
  SynthEngine, Voice, EngineSequencer, EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { ModulationHostImpl } from '../modulation/modulation-host';
import type { KeymapEntry } from '../samples/types';

const SAMPLER_PARAMS: EngineParamSpec[] = [
  { id: 'gain',             label: 'Gain',    kind: 'continuous', min: 0,     max: 1.5, default: 1 },
  { id: 'amp.attack',       label: 'Attack',  kind: 'continuous', min: 0.001, max: 2,   default: 0.005, unit: 's', curve: 'exponential' },
  { id: 'amp.release',      label: 'Release', kind: 'continuous', min: 0.005, max: 4,   default: 0.08,  unit: 's', curve: 'exponential' },
  { id: 'pitch',            label: 'Pitch',   kind: 'continuous', min: -24,   max: 24,  default: 0,     unit: 'st' },
  { id: 'filter.cutoff',    label: 'Cutoff',  kind: 'continuous', min: 0,     max: 1,   default: 1 },
  { id: 'filter.resonance', label: 'Res',     kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { id: 'poly.voices',      label: 'Voices',  kind: 'continuous', min: 1,     max: 16,  default: 8 },
];

class SamplerSequencer implements EngineSequencer {
  getStepAt(): unknown { return null; }
  setLength(): void {}
  highlight(): void {}
  serialize(): unknown { return null; }
  deserialize(): void {}
  dispose(): void {}
}

export class SamplerEngine implements SynthEngine {
  readonly id = 'sampler';
  readonly name = 'Sampler';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = SAMPLER_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  private paramValues: Record<string, number> = {};
  private keymap: KeymapEntry[] = [];
  private modHost = new ModulationHostImpl([]);

  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of SAMPLER_PARAMS) this.paramValues[p.id] = p.default;
  }

  getBaseValue(id: string): number {
    return this.paramValues[id] ?? SAMPLER_PARAMS.find((p) => p.id === id)?.default ?? 0;
  }
  setBaseValue(id: string, v: number): void {
    this.paramValues[id] = v;
  }

  /** Replace the lane's one-shot keymap. Phase-3 UI calls this; tests call it
   *  directly. */
  setKeymap(entries: KeymapEntry[]): void {
    this.keymap = entries;
  }
  getKeymap(): KeymapEntry[] {
    return this.keymap;
  }

  applyPreset(name: string): void {
    const p = this.presets.find((x) => x.name === name);
    if (!p) return;
    for (const [k, v] of Object.entries(p.params)) this.paramValues[k] = v;
  }

  // createVoice is implemented in Task 7.
  createVoice(_ctx: AudioContext, _output: AudioNode): Voice {
    throw new Error('SamplerEngine.createVoice not implemented yet');
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer { return new SamplerSequencer(); }
  buildParamUI(_c: HTMLElement, _ctx?: EngineUIContext): void { /* keymap UI: later plan */ }
  dispose(): void { this.keymap = []; }
}

export const samplerEngine = new SamplerEngine();
registerEngine(samplerEngine);
registerEngineFactory('sampler', () => new SamplerEngine());
