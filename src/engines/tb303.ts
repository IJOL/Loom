// src/engines/tb303.ts
// Adapts the existing TB303 monosynth to the SynthEngine interface so it can
// be picked as a lane engine alongside subtractive/wavetable/fm/karplus.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer,
  EngineUIContext, EnginePreset, ParamDef,
} from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { TB303 } from '../core/synth';

const PARAMS: ParamDef[] = [
  { id: 'cutoff',    label: 'CUTOFF', min: 0, max: 1, default: 0.42 },
  { id: 'resonance', label: 'RES',    min: 0, max: 1, default: 0.55 },
  { id: 'envMod',    label: 'ENV',    min: 0, max: 1, default: 0.5  },
  { id: 'decay',     label: 'DECAY',  min: 0, max: 1, default: 0.4  },
  { id: 'accent',    label: 'ACCENT', min: 0, max: 1, default: 0.6  },
  { id: 'wave',      label: 'WAVE',   min: 0, max: 1, default: 0    },
];

const TB303_PRESETS: EnginePreset[] = [
  { name: 'Acid Classic', params: { cutoff: 0.35, resonance: 0.70, envMod: 0.60, decay: 0.50, accent: 0.70, wave: 0 } },
  { name: 'Dub Sub',      params: { cutoff: 0.20, resonance: 0.40, envMod: 0.30, decay: 0.65, accent: 0.45, wave: 1 } },
  { name: 'Squelch',      params: { cutoff: 0.45, resonance: 0.85, envMod: 0.75, decay: 0.35, accent: 0.80, wave: 0 } },
];

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

class TB303Voice implements Voice {
  constructor(private tb303: TB303) {}

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    this.tb303.trigger({
      freq: midiToFreq(midi),
      accent: !!opts.accent,
      slide: !!opts.slide,
      duration: opts.gateDuration,
    }, time);
  }

  release(_time: number): void {}
  connect(_dest: AudioNode): void {}
  dispose(): void {}
}

class TB303Sequencer implements EngineSequencer {
  getStepAt(_i: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_s: number): void {}
  serialize(): unknown { return null; }
  deserialize(_d: unknown): void {}
  dispose(): void {}
}

export class TB303Engine implements SynthEngine {
  readonly id = 'tb303';
  readonly name = 'TB-303';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'mono' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = PARAMS;
  readonly presets = TB303_PRESETS;

  private instances = new WeakMap<AudioNode, TB303>();
  private lastInstance: TB303 | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    let tb = this.instances.get(output);
    if (!tb) {
      tb = new TB303(ctx, output);
      this.instances.set(output, tb);
    }
    this.lastInstance = tb;
    return new TB303Voice(tb);
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new TB303Sequencer();
  }

  buildParamUI(_container: HTMLElement, _ctx?: EngineUIContext): void {
    // The Classic 303 page already renders the TB303 knobs against the
    // singleton synth. Per-lane UI binding moves into this method in
    // Phase 7 when the dedicated TB-303 tab is dismantled.
  }

  applyPreset(name: string): void {
    const p = this.presets.find((x) => x.name === name);
    if (!p || !this.lastInstance) return;
    const params = this.lastInstance.params as unknown as Record<string, number | string>;
    for (const [k, v] of Object.entries(p.params)) {
      if (k === 'wave') {
        params.wave = v < 0.5 ? 'sawtooth' : 'square';
      } else {
        params[k] = v;
      }
    }
  }

  dispose(): void {}
}

const tb303Engine = new TB303Engine();
registerEngine(tb303Engine);
registerEngineFactory('tb303', () => new TB303Engine());
