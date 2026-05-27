// src/engines/subtractive.ts
// Wraps the existing PolySynth as the default 'subtractive' engine, with the
// modular ModulationHost layered on top (two ADSRs + two LFOs by default).

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, ParamDef, EngineUIContext,
} from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { PolySynth, POLY_DEFAULTS } from '../polysynth/polysynth';
import { ModulationHostImpl, bindVoiceModulation } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorVoice } from '../modulation/types';
import { getCurrentLaneForVoice, setActiveModVoices, recordVoiceMods } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import type { KnobHandle } from '../core/knob';

class SubtractiveVoice implements Voice {
  constructor(
    private polysynth: PolySynth,
    private modHost: ModulationHostImpl,
    private ctx: AudioContext,
    private getBpm: () => number,
    private laneId: string | null,
  ) {}

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    // Spawn modulator voices fresh per-trigger so each note gets its own
    // envelope curve / LFO phase.
    const voiceMods: Map<string, ModulatorVoice> = this.modHost.spawnVoice(this.ctx, this.getBpm);
    // Re-record on every trigger so the rAF poll always sees the most-recent
    // voice's mod envelopes. Snapshot the laneId from createVoice time since
    // currentLaneForVoice may have moved on by now.
    if (this.laneId) setActiveModVoices(this.laneId, voiceMods);
    else recordVoiceMods(voiceMods);

    this.polysynth.triggerWithBinding(
      midi, time, options.gateDuration, options.accent ?? false,
      (vp) => {
        bindVoiceModulation(
          voiceMods,
          this.modHost.modulators,
          { amp: vp.amp, cutoff: vp.cutoff, pitch: vp.pitch },
          {
            amp:    { min: 0,     max: 1     },
            cutoff: { min: 20,    max: 12000 },
            pitch:  { min: -1200, max: 1200  },
          },
          this.ctx,
        );
        // Fire all modulator voices at the same start time as the audio voice.
        for (const mv of voiceMods.values()) {
          mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
        }
      },
    );
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
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = SUBTRACTIVE_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  private modHost = new ModulationHostImpl([
    {
      ...makeDefaultADSR('adsr-amp'),
      // depth=0: PolySynth's hardcoded amp envelope is authoritative; this
      // modulator is visible/editable so users can dial in extra contribution.
      connections: [{ id: 'c-amp', paramId: 'amp', depth: 0 }],
    },
    {
      ...makeDefaultADSR('adsr-filter'),
      // depth=0: PolySynth's hardcoded cutoff envelope is authoritative; see above.
      connections: [{ id: 'c-cutoff', paramId: 'cutoff', depth: 0 }],
    },
    makeDefaultLFO('lfo1'),
    { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
  ]);

  /** Persistence + cross-module access to modulator state. */
  get modulators(): ModulationHostImpl { return this.modHost; }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    // Preset.params currently map onto PolySynthParams flat-ish; the existing
    // poly preset wiring in src/polysynth/poly-presets.ts owns full preset
    // shape. This hook only carries the modulators payload.
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  private polysynth: PolySynth | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (!this.polysynth) {
      this.polysynth = new PolySynth(ctx, output);
    }
    return new SubtractiveVoice(this.polysynth, this.modHost, ctx, () => this.bpm, getCurrentLaneForVoice());
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

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    // For subtractive, main.ts already builds the poly param UI. We only add
    // the modulators panel here (when invoked via a per-lane engine host).
    if (ctx) {
      renderModulatorsPanel(container, {
        engineId: this.id,
        laneId: ctx.laneId,
        extraPrefixes: ['poly', 'subtractive'],
        host: this.modHost,
        registry: ctx.registry as Map<string, KnobHandle>,
        registerKnob: (k) => ctx.registerKnob(k),
        onChange: () => {
          container.innerHTML = '';
          this.buildParamUI(container, ctx);
        },
      });
    }
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
