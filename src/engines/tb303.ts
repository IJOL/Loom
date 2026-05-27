// src/engines/tb303.ts
// Adapts the existing TB303 monosynth to the SynthEngine interface so it can
// be picked as a lane engine alongside subtractive/wavetable/fm/karplus.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer,
  EngineUIContext, EnginePreset,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { TB303 } from '../core/synth';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, type ModulatorVoice } from '../modulation/types';
import { recordVoiceMods } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import type { KnobHandle } from '../core/knob';

const PARAMS: EngineParamSpec[] = [
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.42 },
  { id: 'filter.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.55 },
  { id: 'env.amount',       label: 'Env',       kind: 'continuous', min: 0, max: 1, default: 0.5  },
  { id: 'env.decay',        label: 'Decay',     kind: 'continuous', min: 0, max: 1, default: 0.4  },
  { id: 'env.accent',       label: 'Accent',    kind: 'continuous', min: 0, max: 1, default: 0.6  },
  {
    id: 'osc.wave', label: 'Wave', kind: 'discrete',
    min: 0, max: 1, default: 0,
    options: [{ value: 'sawtooth', label: 'Saw' }, { value: 'square', label: 'Sqr' }],
  },
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
  constructor(
    private tb303: TB303,
    private voiceMods: Map<string, ModulatorVoice>,
  ) {}

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    // Fire modulator voices first so their AudioParam contributions land
    // before the trigger envelope writes the filter/amp curves.
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: opts.gateDuration, accent: opts.accent });
    }
    this.tb303.trigger({
      freq: midiToFreq(midi),
      accent: !!opts.accent,
      slide: !!opts.slide,
      duration: opts.gateDuration,
    }, time);
  }

  release(time: number): void {
    for (const mv of this.voiceMods.values()) mv.release(time);
  }
  connect(_dest: AudioNode): void {}
  dispose(): void {
    for (const mv of this.voiceMods.values()) mv.dispose();
  }

  getAudioParams(): Map<string, AudioParam> {
    return new Map<string, AudioParam>([
      ['filter.cutoff',    this.tb303.filter.frequency],
      ['filter.resonance', this.tb303.filter.Q],
      ['amp.gain',         this.tb303.amp.gain],
    ]);
  }
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

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  // LFO only — TB303's filter envelope is baked into trigger() and is part
  // of the 303 character. A free LFO lets the user add dub-style cutoff
  // wobbles or accent-shifting motion on top.
  private modHost = new ModulationHostImpl([
    makeDefaultLFO('lfo1'),
  ]);

  /** Persistence + cross-module access to modulator state. */
  get modulators(): ModulationHostImpl { return this.modHost; }

  private instances = new WeakMap<AudioNode, TB303>();
  private lastInstance: TB303 | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    let tb = this.instances.get(output);
    if (!tb) {
      tb = new TB303(ctx, output);
      this.instances.set(output, tb);
    }
    this.lastInstance = tb;

    const voiceMods = this.modHost.spawnVoice(ctx, () => this.bpm);
    recordVoiceMods(voiceMods);
    return new TB303Voice(tb, voiceMods);
  }

  getBaseValue(id: string): number {
    if (!this.lastInstance) return PARAMS.find(p => p.id === id)?.default ?? 0;
    const p = this.lastInstance.params;
    switch (id) {
      case 'filter.cutoff':    return p.cutoff;
      case 'filter.resonance': return p.resonance;
      case 'env.amount':       return p.envMod;
      case 'env.decay':        return p.decay;
      case 'env.accent':       return p.accent;
      case 'osc.wave':         return p.wave === 'square' ? 1 : 0;
    }
    return 0;
  }

  setBaseValue(id: string, v: number): void {
    if (!this.lastInstance) return;
    const p = this.lastInstance.params as unknown as Record<string, number | string>;
    switch (id) {
      case 'filter.cutoff':    p.cutoff = v;    return;
      case 'filter.resonance': p.resonance = v; return;
      case 'env.amount':       p.envMod = v;    return;
      case 'env.decay':        p.decay = v;     return;
      case 'env.accent':       p.accent = v;    return;
      case 'osc.wave':         p.wave = v >= 0.5 ? 'square' : 'sawtooth'; return;
    }
  }

  // Pre-register an externally-constructed TB303 so the singleton synth
  // owned by main.ts (which Classic UI knobs and randomize() mutate) is
  // the same instance this engine wraps. Without this, createVoice would
  // build a separate orphan TB303 the knobs don't reach.
  registerInstance(output: AudioNode, instance: TB303): void {
    this.instances.set(output, instance);
    this.lastInstance = instance;
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new TB303Sequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    // The Classic 303 page already renders the TB303 knobs against the
    // singleton synth. Per-lane UI binding moves into this method in
    // Phase 7 when the dedicated TB-303 tab is dismantled.
    if (ctx) {
      renderModulatorsPanel(container, {
        engineId: this.id,
        laneId: ctx.laneId,
        host: this.modHost,
        registry: ctx.registry as Map<string, KnobHandle>,
        registerKnob: (k) => ctx.registerKnob(k),
        onChange: () => {
          container.innerHTML = '';
          this.buildParamUI(container, ctx); // rebuild panel DOM
        },
      });
    }
  }

  applyPreset(name: string): void {
    const p = this.presets.find((x) => x.name === name);
    if (!p) return;
    if (this.lastInstance) {
      const params = this.lastInstance.params as unknown as Record<string, number | string>;
      for (const [k, v] of Object.entries(p.params)) {
        if (k === 'wave') {
          params.wave = v < 0.5 ? 'sawtooth' : 'square';
        } else {
          params[k] = v;
        }
      }
    }
    if (p.modulators) this.modHost.deserialize(p.modulators);
  }

  dispose(): void {}
}

export const tb303Engine = new TB303Engine();
registerEngine(tb303Engine);
registerEngineFactory('tb303', () => new TB303Engine());

export function configureTB303EngineMainInstance(output: AudioNode, instance: TB303): void {
  tb303Engine.registerInstance(output, instance);
}
