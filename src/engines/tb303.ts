// src/engines/tb303.ts
// Adapts the existing TB303 monosynth to the SynthEngine interface so it can
// be picked as a lane engine alongside subtractive/wavetable/fm/karplus.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer,
  EngineUIContext, EnginePreset,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { PluginFactory } from '../plugins/types';
import { registerEngine, registerEngineFactory } from './registry';
import { getCachedPresets } from '../presets/preset-loader';
import { TB303 } from '../core/synth';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, type ModulatorVoice } from '../modulation/types';
import { recordVoiceMods, getCurrentLaneForVoice } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { wireEngineParams } from './engine-ui';
import { bindEngineModulators, bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations, disposeEngineMods } from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import { PendingBaseValues } from './pending-base-values';
import type { KnobHandle } from '../core/knob';
import { midiToFreq } from '../core/notes';

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

// TB-303 preset JSON keys are the TB303 synth's internal field names; map them
// to the EngineParamSpec ids that getBaseValue / setBaseValue speak so a preset
// can be applied through the same (instance-or-pending) path the knobs use.
const PRESET_KEY_TO_SPEC: Record<string, string> = {
  cutoff:    'filter.cutoff',
  resonance: 'filter.resonance',
  envMod:    'env.amount',
  decay:     'env.decay',
  accent:    'env.accent',
  wave:      'osc.wave',
};

/** Full-knob exponential sweep of the cutoff expressed in cents. The cutoff
 *  knob is normalized 0..1 and maps to 80·100^x Hz inside the synth — a ratio
 *  of 100 across the full knob, i.e. log2(100) octaves. Modulation is routed
 *  into BiquadFilterNode.detune (cents, multiplicative) instead of .frequency
 *  (Hz, additive) so a bipolar LFO at depth d moves the cutoff between
 *  base·100^(±d) — EXACTLY the normalized ±d the amber knob arc draws. The old
 *  additive-Hz path summed up to ±18 kHz onto a few-hundred-Hz base, driving
 *  filter.frequency negative and slamming the filter shut every cycle. */
const CUTOFF_DETUNE_SPAN_CENTS = 1200 * Math.log2(100);  // ≈ 7972.6 ¢

/** Modulation ranges for the TB-303's shared AudioParams, mirroring
 *  TB303Voice.getAudioParamRange. filter.cutoff modulation targets .detune
 *  (cents, exponential); filter.resonance targets .Q (linear, ~0..25 over the
 *  knob). The binder uses (max−min) as the depth=1 peak gain, so the SPAN is
 *  what matters. */
function tb303SharedRange(shortId: string): { min: number; max: number } {
  if (shortId === 'filter.cutoff')    return { min: 0, max: CUTOFF_DETUNE_SPAN_CENTS };
  if (shortId === 'filter.resonance') return { min: 0, max: 25 };
  return { min: 0, max: 1 };
}

class TB303Voice implements Voice {
  /** Set by TB303Engine.createVoice immediately after construction so
   *  dispose() can tear down the lane binding. */
  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

  constructor(
    private tb303: TB303,
    private voiceMods: Map<string, ModulatorVoice>,
    private getModStates: () => import('../modulation/types').ModulatorState[],
  ) {}

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    // Per-modulator trigger semantics:
    //   ADSR → always re-triggered (envelope starts fresh per note).
    //   LFO  → re-triggered only when state.trigger === 'note'; free mode
    //          (the default) leaves the shared LFO oscillator running so
    //          a 4/1 slow sweep is actually audible across a phrase.
    const states = this.getModStates();
    for (const [modId, mv] of this.voiceMods) {
      const s = states.find((x) => x.id === modId);
      if (!s) continue;
      if (s.kind === 'adsr' || (s.kind === 'lfo' && s.trigger === 'note')) {
        mv.trigger(time, { gateDuration: opts.gateDuration, accent: opts.accent });
      }
    }
    this.tb303.trigger({
      freq: midiToFreq(midi),
      accent: !!opts.accent,
      velocity: opts.velocity,
      slide: !!opts.slide,
      duration: opts.gateDuration,
    }, time);
  }

  release(time: number): void {
    this.tb303.releaseGate(time);
    for (const mv of this.voiceMods.values()) mv.release(time);
  }
  connect(_dest: AudioNode): void {}
  dispose(): void {
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
    // voiceMods are engine-owned; the engine disposes them on its own
    // disposal path. Disposing here would tear down the shared LFO state.
  }

  getAudioParams(): Map<string, AudioParam> {
    return new Map<string, AudioParam>([
      // cutoff modulation goes into .detune (cents, exponential) so it tracks
      // the normalized knob arc; the filter envelope still drives .frequency.
      ['filter.cutoff',    this.tb303.filter.detune],
      ['filter.resonance', this.tb303.filter.Q],
      ['amp.gain',         this.tb303.amp.gain],
    ]);
  }

  /** Modulation depth-scaling ranges. The knob/spec ranges are normalized
   *  0..1; the binder needs the destination AudioParam's units. filter.cutoff
   *  modulates BiquadFilterNode.detune (cents — a full-knob exponential sweep),
   *  filter.resonance modulates .Q (~0..25 across the knob). See
   *  tb303SharedRange / CUTOFF_DETUNE_SPAN_CENTS. */
  getAudioParamRange(id: string): { min: number; max: number } | undefined {
    if (id === 'filter.cutoff')    return { min: 0, max: CUTOFF_DETUNE_SPAN_CENTS };
    if (id === 'filter.resonance') return { min: 0, max: 25 };
    return undefined;
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
  readonly name = '303';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'mono' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = PARAMS;
  get presets(): EnginePreset[] { return getCachedPresets('tb303'); }

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

  private pending = new PendingBaseValues();

  /** Engine-wide modulator voices. Spawned lazily on the first createVoice
   *  call and REUSED across every subsequent trigger — the TB-303 is
   *  monophonic and creating fresh LFO oscillators per note would reset
   *  the phase every ~100 ms (see tb303-shared-mods.test.ts). */
  private engineModVoices: Map<string, ModulatorVoice> | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    let tb = this.instances.get(output);
    if (!tb) {
      tb = new TB303(ctx, output);
      this.instances.set(output, tb);
    }
    this.lastInstance = tb;
    this.pending.flush((id, v) => this.setBaseValue(id, v));

    if (!this.engineModVoices) {
      this.engineModVoices = this.modHost.spawnVoice(ctx, () => this.bpm);
    }
    recordVoiceMods(this.engineModVoices);
    const voice = new TB303Voice(tb, this.engineModVoices, () => this.modHost.modulators);
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      this.currentLaneId = laneId;
      // Shared-scope modulators (the default LFO is scope='shared') target the
      // synth's shared AudioParams (filter.frequency/Q/amp.gain). The per-voice
      // binder below EXCLUDES shared→shared connections — it assumes an engine
      // binder owns them — so without this call an LFO→filter.cutoff was
      // silently dropped ("LFO on the 303 does nothing", same shape as the
      // drums bug). rangeLookup maps the normalized spec range to the param's
      // native units (Hz/Q) so depth=1 is a full sweep.
      const sharedMods = new Map(
        [...this.engineModVoices].filter(([id]) => {
          const m = this.modHost.modulators.find((x) => x.id === id);
          return (m?.scope ?? (m?.kind === 'lfo' ? 'shared' : 'per-voice')) === 'shared';
        }),
      );
      bindEngineModulators({
        laneId, engine: this, voiceMods: sharedMods, ctx,
        rangeLookup: tb303SharedRange,
      });
      // Per-voice mods (e.g. a user-added ADSR) still bind through the voice
      // binder; shared-scope connections are excluded here to avoid double
      // routing with the engine binder above.
      voice.binder = bindVoiceModulators({ laneId, engine: this, voice, voiceMods: this.engineModVoices, ctx });
    }
    return voice;
  }

  /** Cached so the modulation-panel onChange callback can re-apply bindings
   *  without an extra plumbing path through ctx. */
  private currentLaneId: string | null = null;

  getBaseValue(id: string): number {
    if (!this.lastInstance) {
      // No TB303 yet (the instance is created lazily on the first note). Surface
      // any value applied instance-less — a preset load or knob edit before the
      // first trigger lands in `pending` — so the inspector knobs reflect it
      // instead of snapping back to the spec default.
      const pending = this.pending.get(id);
      return pending ?? PARAMS.find(p => p.id === id)?.default ?? 0;
    }
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
    if (!this.lastInstance) {
      this.pending.set(id, v);
      return;
    }
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
    this.pending.flush((id, v) => this.setBaseValue(id, v));
  }

  /** Returns the most recently created/registered TB303 instance.
   *  Phase G: used by save/load path and knob wiring to access the
   *  underlying TB303 without requiring a pre-boot singleton. */
  getInstance(): TB303 | null { return this.lastInstance; }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new TB303Sequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    if (!ctx) return;
    // Engine param knobs (Wave / Cutoff / Resonance / Env / Decay / Accent),
    // wired per-lane under `<laneId>.<spec.id>` — exactly like FM/Karplus/
    // Wavetable. Replaces the legacy static `data-page="303"` knob row that
    // only ever bound the canonical bass lane id `tb-303-1`, leaving every
    // other TB-303 lane (e.g. a MIDI-imported `lane-…`) with no controls.
    const knobs = document.createElement('div');
    knobs.className = 'row knobs';
    wireEngineParams(this, ctx, knobs, {
      formatter: (id, v) => (id.includes('decay') ? `${(v * 1000).toFixed(0)}ms` : `${Math.round(v * 100)}%`),
    });
    container.appendChild(knobs);

    {
      renderModulatorsPanel(container, {
        engineId: this.id,
        laneId: ctx.laneId,
        host: this.modHost,
        registry: ctx.registry as Map<string, KnobHandle>,
        registerKnob: (k) => ctx.registerKnob(k),
        lookupLaneDisplayName: ctx.lookupLaneDisplayName,
        sessionState: ctx.sessionState,
        historyDeps: ctx.historyDeps,
        laneInserts: ctx.laneInserts,
        masterInserts: ctx.masterInserts,
        fxBus: ctx.fxBus,
        onChange: () => {
          container.innerHTML = '';
          this.buildParamUI(container, ctx); // rebuild panel DOM
          if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
        },
      });
    }
  }

  applyPreset(name: string): void {
    const p = this.presets.find((x) => x.name === name);
    if (!p) return;
    // Route every preset param through setBaseValue so it applies whether or
    // not a TB303 instance exists yet: setBaseValue writes the live instance
    // when present and otherwise stashes into `pending` (flushed on the first
    // createVoice). The old code wrote `this.lastInstance.params` directly and
    // silently no-oped when no voice had played — which froze the 303 preset
    // dropdown and the boot preset on a lane whose clip wasn't running.
    for (const [k, v] of Object.entries(p.params)) {
      if (typeof v !== 'number') continue;
      const specId = PRESET_KEY_TO_SPEC[k];
      if (specId) this.setBaseValue(specId, v);
    }
    if (p.modulators) this.modHost.deserialize(p.modulators);
  }

  getSharedAudioParams(): Map<string, AudioParam> {
    if (!this.lastInstance) return new Map();
    return new Map<string, AudioParam>([
      // cutoff → .detune (cents, exponential, tracks the knob arc); the filter
      // envelope keeps driving .frequency underneath.
      ['filter.cutoff',    this.lastInstance.filter.detune],
      ['filter.resonance', this.lastInstance.filter.Q],
      ['amp.gain',         this.lastInstance.amp.gain],
    ]);
  }

  dispose(): void {
    // Stop the shared LFO/ADSR oscillators and drop the lane's modulation
    // bridges. A "New" or stem-"Replace" disposes the lane via this path; an
    // empty dispose() left the shared modulators running ("doesn't clean up").
    disposeEngineMods(this.engineModVoices, this.currentLaneId);
    this.engineModVoices = null;
    this.currentLaneId = null;
  }
}

export const tb303Engine = new TB303Engine();
registerEngine(tb303Engine);
registerEngineFactory('tb303', () => new TB303Engine());

// configureTB303EngineMainInstance deleted in Phase G — TB303Engine.createVoice
// is now self-contained: it creates a fresh TB303(ctx, output) and caches it
// internally (instances WeakMap + lastInstance). Registration no longer needs
// an external call site.

export const tb303Plugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'tb303',
    name: 'TB-303',
    kind: 'synth',
    version: '1.0.0',
    params: tb303Engine.params,
    presets: [],
  },
  create(ctx, output) {
    const engine = new TB303Engine();
    const voice = engine.createVoice(ctx, output);
    return {
      trigger:                (m, t, o) => voice.trigger(m, t, o),
      release:                (t)       => voice.release(t),
      connect:                (d)       => voice.connect(d),
      getAudioParams:         ()        => voice.getAudioParams(),
      getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
      getSharedAudioParams:   ()        => engine.getSharedAudioParams() ?? new Map(),
      getBaseValue:           (id)      => engine.getBaseValue(id),
      setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
      applyPreset:            (name)    => engine.applyPreset(name),
      dispose:                ()        => { voice.dispose(); engine.dispose(); },
    };
  },
};
