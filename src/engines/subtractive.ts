// src/engines/subtractive.ts
// Wraps the existing PolySynth as the default 'subtractive' engine, with the
// modular ModulationHost layered on top (two ADSRs + two LFOs by default).

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { PolySynth } from '../polysynth/polysynth';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorVoice } from '../modulation/types';
import { recordVoiceMods, getCurrentLaneForVoice } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations } from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import { PendingBaseValues } from './pending-base-values';
import type { KnobHandle } from '../core/knob';

const WAVE_OPTIONS = [
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square',   label: 'Sqr' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sine',     label: 'Sin' },
];

// Unified-param schema. Dot-namespaced ids map directly onto the nested
// polysynth.params object tree via the dot-path walkers below.
const SUB_PARAMS: EngineParamSpec[] = [
  // Oscillators
  { id: 'osc1.level',   label: 'Osc1 Lvl',  kind: 'continuous', min: 0, max: 1, default: 0.6 },
  { id: 'osc1.detune',  label: 'Osc1 Det',  kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢' },
  { id: 'osc1.wave',    label: 'Osc1 Wave', kind: 'discrete', min: 0, max: 3, default: 0,
    options: WAVE_OPTIONS },
  { id: 'osc2.level',   label: 'Osc2 Lvl',  kind: 'continuous', min: 0, max: 1, default: 0.4 },
  { id: 'osc2.detune',  label: 'Osc2 Det',  kind: 'continuous', min: -50, max: 50, default: 7, unit: '¢' },
  { id: 'osc2.wave',    label: 'Osc2 Wave', kind: 'discrete', min: 0, max: 3, default: 1,
    options: WAVE_OPTIONS },
  { id: 'sub.level',    label: 'Sub Lvl',   kind: 'continuous', min: 0, max: 1, default: 0.3 },
  { id: 'noise.level',  label: 'Noise Lvl', kind: 'continuous', min: 0, max: 1, default: 0 },

  // Filter
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.55 },
  { id: 'filter.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.25 },
  { id: 'filter.envAmount', label: 'Env Amt',   kind: 'continuous', min: 0, max: 1, default: 0.45 },
  { id: 'filter.drive',     label: 'Drive',     kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'filter.keyTrack',  label: 'Key Track', kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'filter.attack',    label: 'F Atk',     kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'filter.decay',     label: 'F Dec',     kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's' },
  { id: 'filter.sustain',   label: 'F Sus',     kind: 'continuous', min: 0, max: 1, default: 0.4 },
  { id: 'filter.release',   label: 'F Rel',     kind: 'continuous', min: 0.005, max: 4, default: 0.35, unit: 's' },

  // Amp env
  { id: 'amp.attack',  label: 'A Atk', kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'amp.decay',   label: 'A Dec', kind: 'continuous', min: 0.001, max: 4, default: 0.2,  unit: 's' },
  { id: 'amp.sustain', label: 'A Sus', kind: 'continuous', min: 0, max: 1, default: 0.7 },
  { id: 'amp.release', label: 'A Rel', kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's' },

  // Master
  { id: 'master.tune', label: 'Tune', kind: 'continuous', min: -12, max: 12, default: 0, unit: 'st' },
];

const WAVE_VALUES = WAVE_OPTIONS.map(o => o.value);

function readDotPath(obj: Record<string, unknown>, path: string): number {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return 0;
  }
  if (typeof cur === 'number') return cur;
  if (typeof cur === 'string') {
    // Discrete wave: convert string back to index for getBaseValue.
    const i = WAVE_VALUES.indexOf(cur);
    return i >= 0 ? i : 0;
  }
  return 0;
}

function writeDotPath(obj: Record<string, unknown>, path: string, v: number, spec?: EngineParamSpec): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!next || typeof next !== 'object') return;
    cur = next as Record<string, unknown>;
  }
  // Discrete write: value is an index; convert to the string option value.
  if (spec && spec.kind === 'discrete' && spec.options) {
    const idx = Math.max(0, Math.min(spec.options.length - 1, Math.round(v)));
    cur[parts[parts.length - 1]] = spec.options[idx].value;
  } else {
    cur[parts[parts.length - 1]] = v;
  }
}

class SubtractiveVoice implements Voice {
  /** Per-voice AudioParams captured from polysynth.triggerWithBinding's onVoice.
   *  The lane-host modulator binder reads these via getAudioParams(). */
  private lastVoiceParams: {
    amp: AudioParam; cutoff: AudioParam; resonance: AudioParam; pitch: AudioParam;
  } | null = null;
  /** Per-voice release callback captured from triggerWithBinding's onVoice.
   *  Lets Voice.release() cut the polysynth's amp gate, since trigger()
   *  pre-schedules the full envelope. */
  private lastReleaseGate: ((time: number) => void) | null = null;

  /** Set by SubtractiveEngine.createVoice after construction so dispose() can
   *  tear down the lane's connection bindings. Set on first onVoice fire
   *  inside trigger() — that's when lastVoiceParams becomes available. */
  laneId: string | null = null;
  binder: ConnectionBinder | null = null;
  /** Latched at construction by the engine so trigger() can call back into
   *  the binder once the polysynth actually hands us a per-voice param set. */
  rebind: (() => void) | null = null;

  constructor(
    private polysynth: PolySynth,
    private voiceMods: Map<string, ModulatorVoice>,
  ) {}

  getAudioParams(): Map<string, AudioParam> {
    if (!this.lastVoiceParams) return new Map();
    return new Map<string, AudioParam>([
      ['amp.gain',         this.lastVoiceParams.amp],
      ['filter.cutoff',    this.lastVoiceParams.cutoff],
      ['filter.resonance', this.lastVoiceParams.resonance],
      ['osc1.detune',      this.lastVoiceParams.pitch],
    ]);
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    this.polysynth.triggerWithBinding(
      midi, time, options.gateDuration, options.accent ?? false,
      (vp) => {
        this.lastVoiceParams = vp;
        this.lastReleaseGate = vp.releaseGate;
        // Now that getAudioParams() returns real params, (re)apply the binder
        // so modulator outputs reach this freshly-allocated polysynth voice.
        if (this.rebind) this.rebind();
        // Fire all modulator voices at the same start time as the audio voice.
        // The lane-host has already bound modulator outputs into the
        // destination AudioParams via getAudioParams() before this trigger.
        for (const mv of this.voiceMods.values()) {
          mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
        }
      },
    );
  }

  release(time: number): void {
    // Cut the polysynth's pre-scheduled amp envelope so the voice goes silent
    // — without this, trigger()'s full ADSR keeps holding regardless.
    if (this.lastReleaseGate) this.lastReleaseGate(time);
    for (const mv of this.voiceMods.values()) mv.release(time);
  }

  connect(_dest: AudioNode): void {
    // PolySynth already connected to destination in constructor
  }

  dispose(): void {
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
    for (const mv of this.voiceMods.values()) mv.dispose();
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

class SubtractiveEngine implements SynthEngine {
  readonly id = 'subtractive';
  readonly name = 'Subtractive';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = SUB_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  private modHost = new ModulationHostImpl([
    {
      ...makeDefaultADSR('adsr-amp'),
      // depth=0: PolySynth's hardcoded amp envelope is authoritative; this
      // modulator is visible/editable so users can dial in extra contribution.
      connections: [{ id: 'c-amp', paramId: 'amp.gain', depth: 0 }],
    },
    {
      ...makeDefaultADSR('adsr-filter'),
      // depth=0: PolySynth's hardcoded cutoff envelope is authoritative; see above.
      connections: [{ id: 'c-cutoff', paramId: 'filter.cutoff', depth: 0 }],
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

  private pending = new PendingBaseValues();

  getBaseValue(id: string): number {
    if (!this.polysynth) return SUB_PARAMS.find(p => p.id === id)?.default ?? 0;
    return readDotPath(this.polysynth.params as unknown as Record<string, unknown>, id);
  }

  setBaseValue(id: string, v: number): void {
    if (!this.polysynth) {
      this.pending.set(id, v);
      return;
    }
    const spec = SUB_PARAMS.find(p => p.id === id);
    writeDotPath(this.polysynth.params as unknown as Record<string, unknown>, id, v, spec);
  }

  /** Cached so the modulation-panel onChange callback can re-apply bindings. */
  private currentLaneId: string | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (!this.polysynth) {
      this.polysynth = new PolySynth(ctx, output);
      this.pending.flush((id, v) => this.setBaseValue(id, v));
    }
    const voiceMods = this.modHost.spawnVoice(ctx, () => this.bpm);
    recordVoiceMods(voiceMods);
    const voice = new SubtractiveVoice(this.polysynth, voiceMods);
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      this.currentLaneId = laneId;
      // Subtractive can't bind until the polysynth allocates a per-note voice
      // (lastVoiceParams arrives via triggerWithBinding's onVoice callback).
      // Stash a closure the voice will call from that callback.
      voice.rebind = () => {
        voice.binder = bindVoiceModulators({ laneId, engine: this, voice, voiceMods, ctx });
      };
    }
    return voice;
  }

  getPolySynth(): PolySynth | null {
    return this.polysynth;
  }

  setPolySynth(ps: PolySynth): void {
    this.polysynth = ps;
    this.pending.flush((id, v) => this.setBaseValue(id, v));
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
        host: this.modHost,
        registry: ctx.registry as Map<string, KnobHandle>,
        registerKnob: (k) => ctx.registerKnob(k),
        onChange: () => {
          container.innerHTML = '';
          this.buildParamUI(container, ctx);
          if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
        },
      });
    }
  }

  dispose(): void {
    this.polysynth = null;
  }
}

export { SubtractiveEngine };
export const subtractiveEngine = new SubtractiveEngine();
registerEngine(subtractiveEngine);
// Factory: each per-lane subtractive needs its OWN PolySynth, which the caller
// must attach via setPolySynth(...) before triggering (createVoice requires it).
registerEngineFactory('subtractive', () => new SubtractiveEngine());
