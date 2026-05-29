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
import { bindEngineModulators, bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations } from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import { PendingBaseValues } from './pending-base-values';
import type { KnobHandle } from '../core/knob';
import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';

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

  { id: 'poly.mode',   label: 'Mode',   kind: 'continuous', min: 0, max: 1,  default: 0 },
  { id: 'poly.retrig', label: 'Retrig', kind: 'continuous', min: 0, max: 1,  default: 1 },
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16, default: 8 },
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

/** Operating ranges for the modBus AudioParams (ConstantSourceNode.offset
 *  summed into each per-voice AudioParam). Must agree with the per-voice
 *  ranges declared on SubtractiveVoice.getAudioParamRange so depth=1
 *  produces the same audible swing whether the modulator is shared or
 *  per-voice. */
function sharedParamRange(shortId: string): { min: number; max: number } {
  switch (shortId) {
    case 'filter.cutoff':    return { min: -4000, max: 4000 };
    case 'filter.resonance': return { min: -10,   max: 10   };
    case 'amp.gain':         return { min: 0,     max: 1    };
    default:                 return { min: 0,     max: 1    };
  }
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
    amp: AudioParam; cutoff: AudioParam; resonance: AudioParam;
    pitch: AudioParam; pitch2: AudioParam;
    osc1Level: AudioParam; osc2Level: AudioParam; subLevel: AudioParam;
    noiseLevel: AudioParam; noiseColor: AudioParam;
    envAmount: AudioParam; drive: AudioParam; keyTrack: AudioParam; tune: AudioParam;
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
    const v = this.lastVoiceParams;
    return new Map<string, AudioParam>([
      ['amp.gain',         v.amp],
      ['filter.cutoff',    v.cutoff],
      ['filter.resonance', v.resonance],
      ['filter.envAmount', v.envAmount],
      ['filter.keyTrack',  v.keyTrack],
      ['filter.drive',     v.drive],
      ['osc1.detune',      v.pitch],
      ['osc1.level',       v.osc1Level],
      ['osc2.detune',      v.pitch2],
      ['osc2.level',       v.osc2Level],
      ['sub.level',        v.subLevel],
      ['noise.level',      v.noiseLevel],
      ['noise.color',      v.noiseColor],
      ['master.tune',      v.tune],
    ]);
  }

  /** Declared AudioParam operating ranges (in their native units). Used by
   *  the modulator binder so depth=1.0 produces a full-swing modulation. */
  getAudioParamRange(shortId: string): { min: number; max: number } | undefined {
    switch (shortId) {
      // filter.frequency holds 0; ConstantSources sum Hz into it. ±4 kHz is
      // a dramatic but musical sweep on a typical 1-3 kHz base cutoff.
      case 'filter.cutoff':    return { min: -4000, max: 4000 };
      // filter.Q. Native ~0.5..22.5; depth=1 with bipolar LFO sweeps ±10 Q.
      case 'filter.resonance': return { min: -10,   max: 10   };
      // Hz of envelope sweep contribution (envScaler.gain). ±8 kHz lets the
      // env open the filter wide on big modulations.
      case 'filter.envAmount': return { min: -8000, max: 8000 };
      // Hz of key-tracking contribution per voice (already scaled by note delta).
      case 'filter.keyTrack':  return { min: -4,    max: 4    };
      // Pre-shaper input boost (×). 1×=no drive, 9×=max drive.
      case 'filter.drive':     return { min: -8,    max: 8    };
      // Cents on osc.detune. ±1200 = ±octave swing for pitch modulation.
      case 'osc1.detune':
      case 'osc2.detune':      return { min: -1200, max: 1200 };
      // master.tune is a ConstantSource.offset in cents, summed into every osc
      // detune. ±1200 = ±octave global tune sweep.
      case 'master.tune':      return { min: -1200, max: 1200 };
      // noise.color is filter cutoff (Hz). ±8 kHz hops the noise from sub to bright.
      case 'noise.color':      return { min: -8000, max: 8000 };
      default: return undefined; // amp.gain, *.level fall back to spec 0..1
    }
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
  readonly name = 'Sub';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = SUB_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [
    {
      // Bright stab — saw + square mix, mid-open cutoff with moderate
      // resonance, fast amp env. Good for syncopated chord stabs.
      name: 'Bright Stab',
      params: {
        'osc1.level':       0.7,
        'osc1.wave':        0,    // saw
        'osc2.level':       0.5,
        'osc2.detune':      7,
        'osc2.wave':        1,    // square
        'sub.level':        0.1,
        'noise.level':      0,
        'filter.cutoff':    0.7,
        'filter.resonance': 0.4,
        'filter.envAmount': 0.25,
        'filter.drive':     0.15,
        'filter.attack':    0.01,
        'filter.decay':     0.20,
        'filter.sustain':   0.30,
        'amp.attack':       0.005,
        'amp.decay':        0.15,
        'amp.sustain':      0.40,
        'amp.release':      0.20,
      },
    },
    {
      // Sub bell — sine osc + heavy sub + low cutoff with high resonance,
      // creates a self-oscillating ping near the fundamental. Use for the
      // "FM bell"-style C-slot in the demo.
      name: 'Sub Bell',
      params: {
        'osc1.level':       0.4,
        'osc1.wave':        3,    // sine
        'osc2.level':       0.0,
        'sub.level':        0.6,
        'noise.level':      0,
        'filter.cutoff':    0.4,
        'filter.resonance': 0.85,
        'filter.envAmount': 0.7,
        'filter.drive':     0,
        'filter.attack':    0.001,
        'filter.decay':     0.6,
        'filter.sustain':   0.05,
        'amp.attack':       0.002,
        'amp.decay':        0.45,
        'amp.sustain':      0.15,
        'amp.release':      0.35,
      },
    },
  ];

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

  /** Engine-wide voices for scope='shared' modulators. Lazy-init on the
   *  first createVoice call, then REUSED forever — same pattern as drums
   *  and TB-303 — so a shared LFO oscillator runs continuously across
   *  notes and an actual sweep is audible. */
  private engineModVoices: Map<string, import('../modulation/types').ModulatorVoice> | null = null;

  getBaseValue(id: string): number {
    if (!this.polysynth) return SUB_PARAMS.find(p => p.id === id)?.default ?? 0;
    if (id === 'poly.voices') return this.polysynth.maxVoices;
    if (id === 'poly.mode')   return this.polysynth.mode === 'mono' ? 1 : 0;
    if (id === 'poly.retrig') return this.polysynth.retrig ? 1 : 0;
    return readDotPath(this.polysynth.params as unknown as Record<string, unknown>, id);
  }

  setBaseValue(id: string, v: number): void {
    if (!this.polysynth) {
      this.pending.set(id, v);
      return;
    }
    if (id === 'poly.voices') { this.polysynth.setMaxVoices(v); return; }
    if (id === 'poly.mode')   { this.polysynth.setMode(v >= 0.5 ? 'mono' : 'poly'); return; }
    if (id === 'poly.retrig') { this.polysynth.setRetrig(v >= 0.5); return; }
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
    // 1. Lazy-init engine-wide modulator voices for SHARED mods and bind
    //    them ONCE to the modulation bus AudioParams. The shared modBus
    //    offsets are summed into per-voice AudioParams in their native
    //    units (Hz for cutoff, Q for resonance, gain for amp), so we
    //    reuse SubtractiveVoice's range schema here too — depth=1 on
    //    a shared LFO must produce the same swing magnitude as on a
    //    per-voice LFO bound to the same param.
    if (!this.engineModVoices) {
      this.engineModVoices = this.modHost.spawnVoiceFiltered(
        ctx, () => this.bpm,
        (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'shared',
      );
      const sharedLaneId = getCurrentLaneForVoice();
      if (sharedLaneId) {
        bindEngineModulators({
          laneId: sharedLaneId,
          engine: this,
          voiceMods: this.engineModVoices,
          ctx,
          rangeLookup: (shortId) => sharedParamRange(shortId),
        });
      }
    }
    // 2. Per-voice modulators: spawn per call for this note.
    const voiceMods = this.modHost.spawnVoiceFiltered(
      ctx, () => this.bpm,
      (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'per-voice',
    );
    // Record BOTH engine-shared and per-voice mods so the rAF tick can find
    // the shared LFO via getActiveModVoice and poll currentValue() (which
    // syncs the live OscillatorNode to state mutations).
    recordVoiceMods(new Map([...(this.engineModVoices ?? new Map()), ...voiceMods]));
    const voice = new SubtractiveVoice(this.polysynth, voiceMods);
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      this.currentLaneId = laneId;
      // Subtractive can't bind until the polysynth allocates a per-note voice
      // (lastVoiceParams arrives via triggerWithBinding's onVoice callback).
      // Stash a closure the voice will call from that callback. We merge the
      // engine-shared mods into the per-voice binding map so a scope='shared'
      // LFO targeting a per-voice-only param (e.g. filter.envAmount, drive,
      // master.tune) still gets a gain bridge — the connection-binder skips
      // any mod whose paramId isn't present in the per-voice param map, so
      // the merge is safe even when both binders see the same modulator.
      const engineMods = this.engineModVoices ?? new Map();
      const combinedMods = new Map<string, ModulatorVoice>([...engineMods, ...voiceMods]);
      voice.rebind = () => {
        voice.binder = bindVoiceModulators({
          laneId, engine: this, voice, voiceMods: combinedMods, ctx,
        });
      };
    }
    return voice;
  }

  getSharedAudioParams(_ctx?: AudioContext): Map<string, AudioParam> {
    if (!this.polysynth) return new Map();
    return new Map<string, AudioParam>([
      ['filter.cutoff',    this.polysynth.modBus['filter.cutoff'].offset],
      ['filter.resonance', this.polysynth.modBus['filter.resonance'].offset],
      ['amp.gain',         this.polysynth.modBus['amp.gain'].offset],
    ]);
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
    if (!ctx) return;
    container.innerHTML = '';

    // Header row: MODE / RETRIG / VOICES. Lives at the top of the engine
    // panel so the user can toggle polyphony without scrolling to the
    // bottom of the modulators.
    const header = document.createElement('div');
    header.className = 'row poly-section';
    const headerLab = document.createElement('div');
    headerLab.className = 'section-label';
    headerLab.textContent = 'POLY';
    header.appendChild(headerLab);
    const headerKnobs = document.createElement('div');
    headerKnobs.className = 'knob-row';
    header.appendChild(headerKnobs);

    const ps = this.polysynth;
    // Local for the retrig-visibility refresh closure to update.
    let refreshRetrigVisibility: (() => void) | null = null;
    if (ps) {
      const mode = createSelectControl({
        id: `${ctx.laneId}.poly.mode`,
        label: 'MODE',
        options: [{ value: 'poly', label: 'Poly' }, { value: 'mono', label: 'Mono' }],
        initialValue: ps.mode,
        onChange: (v) => {
          ps.setMode(v as 'mono' | 'poly');
          refreshRetrigVisibility?.();
        },
      });
      ctx.registerKnob(mode.handle);
      headerKnobs.appendChild(mode.el);

      const retrig = createSelectControl({
        id: `${ctx.laneId}.poly.retrig`,
        label: 'RETRIG',
        options: [{ value: 'legato', label: 'Legato' }, { value: 'retrig', label: 'Retrig' }],
        initialValue: ps.retrig ? 'retrig' : 'legato',
        onChange: (v) => { ps.setRetrig(v === 'retrig'); },
      });
      ctx.registerKnob(retrig.handle);
      headerKnobs.appendChild(retrig.el);

      const voices = createKnob({
        id: `${ctx.laneId}.poly.voices`,
        label: 'VOICES', min: 1, max: 16, step: 1, value: ps.maxVoices, defaultValue: 8,
        format: (v) => String(v),
        onChange: (v) => { ps.setMaxVoices(v); },
      });
      ctx.registerKnob(voices);
      headerKnobs.appendChild(voices.el);

      // RETRIG only matters in mono mode; hide it in poly.
      refreshRetrigVisibility = () => {
        retrig.el.style.display = ps.mode === 'mono' ? '' : 'none';
      };
      refreshRetrigVisibility();
    }

    container.appendChild(header);

    // Modulators panel (existing).
    renderModulatorsPanel(container, {
      engineId: this.id,
      laneId: ctx.laneId,
      host: this.modHost,
      registry: ctx.registry as Map<string, KnobHandle>,
      registerKnob: (k) => ctx.registerKnob(k),
      lookupLaneDisplayName: ctx.lookupLaneDisplayName,
      sessionState: ctx.sessionState,
      onChange: () => {
        container.innerHTML = '';
        this.buildParamUI(container, ctx);
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
      },
    });
  }

  dispose(): void {
    this.polysynth = null;
  }
}

export { SubtractiveEngine };
// Singleton export (`subtractiveEngine`) has been removed. Every consumer
// now allocates via the factory through `createEngineInstance('subtractive')`
// or reads its lane's instance from `laneResources`. A representative
// instance is still registered into the engine registry so `getEngine('subtractive')`
// keeps returning a SynthEngine (for code paths that don't have a laneId).
registerEngineFactory('subtractive', () => new SubtractiveEngine());
registerEngine(new SubtractiveEngine());
