// 4-operator FM engine (DX7-style, simplified).
// Each operator: sine oscillator + ADSR envelope + output level.
// 4 algorithms covering common topologies (serial, parallel mods, two pairs, all-additive).
// Op4 self-feedback.

import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { PluginFactory } from '../plugins/types';
import { registerEngine, registerEngineFactory } from './registry';
import type { KnobHandle } from '../core/knob';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorVoice } from '../modulation/types';
import { recordVoiceMods, getCurrentLaneForVoice } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { bindEngineModulators, bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations } from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import { wireEngineParams } from './engine-ui';
import { getCachedPresets } from '../presets/preset-loader';

interface FMAlgorithm {
  id: number;
  name: string;
  // Per op (0..3): which op indices modulate this op, and whether it goes to the mix.
  ops: Array<{ modulators: number[]; isCarrier: boolean }>;
}

const ALGORITHMS: FMAlgorithm[] = [
  { id: 1, name: 'Serial 4→3→2→1', ops: [
    { modulators: [1], isCarrier: true  },
    { modulators: [2], isCarrier: false },
    { modulators: [3], isCarrier: false },
    { modulators: [],  isCarrier: false },
  ]},
  { id: 2, name: 'Parallel mods → 1', ops: [
    { modulators: [1, 2, 3], isCarrier: true  },
    { modulators: [],        isCarrier: false },
    { modulators: [],        isCarrier: false },
    { modulators: [],        isCarrier: false },
  ]},
  { id: 3, name: 'Two pairs (4→3, 2→1)', ops: [
    { modulators: [1], isCarrier: true  },
    { modulators: [],  isCarrier: false },
    { modulators: [3], isCarrier: true  },
    { modulators: [],  isCarrier: false },
  ]},
  { id: 4, name: 'Additive (all carriers)', ops: [
    { modulators: [], isCarrier: true },
    { modulators: [], isCarrier: true },
    { modulators: [], isCarrier: true },
    { modulators: [], isCarrier: true },
  ]},
];

interface OpParams {
  ratio: number;
  detune: number;
  level: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

const OP_DEFAULTS: OpParams = {
  ratio: 1, detune: 0, level: 0.8,
  attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3,
};

const ALGO_OPTIONS = ALGORITHMS.map((a, i) => ({ value: String(i), label: `${a.id}. ${a.name}` }));

// Helper to expand the 7 op params per operator.
function opParamSpecs(n: number, defaults: { ratio: number; level: number }): EngineParamSpec[] {
  return [
    { id: `op${n}.ratio`,   label: `Op${n} Ratio`, kind: 'continuous', min: 0.1, max: 16, default: defaults.ratio, curve: 'exponential' },
    { id: `op${n}.detune`,  label: `Op${n} Det`,   kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢' },
    { id: `op${n}.level`,   label: `Op${n} Lvl`,   kind: 'continuous', min: 0,   max: 1,  default: defaults.level },
    { id: `op${n}.attack`,  label: `Op${n} Atk`,   kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
    { id: `op${n}.decay`,   label: `Op${n} Dec`,   kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's' },
    { id: `op${n}.sustain`, label: `Op${n} Sus`,   kind: 'continuous', min: 0,   max: 1,  default: 0.7 },
    { id: `op${n}.release`, label: `Op${n} Rel`,   kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's' },
  ];
}

// Unified-param schema. Operator ids are 1-indexed everywhere (op1..op4),
// matching the UI labels and disambiguating from the legacy 0-indexed knob ids.
const FM_PARAMS: EngineParamSpec[] = [
  { id: 'algorithm', label: 'Algorithm', kind: 'discrete', min: 0, max: ALGO_OPTIONS.length - 1, default: 0, options: ALGO_OPTIONS },
  { id: 'feedback',  label: 'FB (op4)', kind: 'continuous', min: 0, max: 1, default: 0 },
  ...opParamSpecs(1, { ratio: 1, level: 0.9 }),
  ...opParamSpecs(2, { ratio: 2, level: 0.5 }),
  ...opParamSpecs(3, { ratio: 3, level: 0.4 }),
  ...opParamSpecs(4, { ratio: 1, level: 0.6 }),
  // Mix / global
  { id: 'amp.mix',    label: 'Mix',       kind: 'continuous', min: 0, max: 1, default: 0.7 },
  // Polyphony cap — shown as a knob in the FM inspector.
  { id: 'poly.voices', label: 'Voices',   kind: 'continuous', min: 1, max: 16, default: 6 },
];

class FMVoice implements Voice {
  public readonly osc: OscillatorNode[] = [];
  private envGain: GainNode[] = [];
  public readonly outGain: GainNode[] = [];
  public readonly finalMix: GainNode;
  private fbGain: GainNode | null = null;
  private fbDelay: DelayNode | null = null;
  private opEnvs!: ConstantSourceNode[];

  /** Set by FMEngine.createVoice for dispose-time cleanup. */
  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private getOp: (i: number) => OpParams,
    private algo: FMAlgorithm,
    private feedback: number,
    private voiceMods: Map<string, ModulatorVoice>,
    modBus?: Record<string, ConstantSourceNode>,
  ) {
    this.finalMix = ctx.createGain();
    this.finalMix.connect(output);
    // Shared modulation bus fan-out: scope='shared' LFOs/ADSRs write to
    // modBus[*].offset, and each voice sums those constants into its own
    // AudioParams. FM only shares the final amp (no centralized filter).
    if (modBus) {
      modBus['amp.mix'].connect(this.finalMix.gain);
    }

    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const eg = ctx.createGain(); eg.gain.value = 0;
      const og = ctx.createGain(); og.gain.value = 0;
      o.connect(eg).connect(og);
      this.osc.push(o);
      this.envGain.push(eg);
      this.outGain.push(og);
    }

    // Internal envelope sources — one per operator. Modulators sum on top of
    // these via the destination AudioParam (envGain[i].gain) so the per-op
    // amp envelope and external modulation stack cleanly.
    this.opEnvs = [];
    for (let i = 0; i < this.envGain.length; i++) {
      const env = ctx.createConstantSource();
      env.offset.value = 0;
      env.start();
      env.connect(this.envGain[i].gain);
      this.envGain[i].gain.value = 0;
      this.opEnvs.push(env);
    }

    // Routing: modulators -> target's frequency AudioParam (a-rate FM).
    for (let target = 0; target < 4; target++) {
      const opDef = this.algo.ops[target];
      for (const src of opDef.modulators) {
        this.outGain[src].connect(this.osc[target].frequency);
      }
      if (opDef.isCarrier) {
        this.outGain[target].connect(this.finalMix);
      }
    }
  }

  getAudioParams(): Map<string, AudioParam> {
    const m = new Map<string, AudioParam>();
    // 1-indexed operator ids matching FM_PARAMS. Ratio is a trigger-time
    // multiplier (`freq * p.ratio`), not an audio-rate AudioParam, so it is
    // intentionally not exposed here.
    for (let i = 0; i < this.outGain.length; i++) {
      const n = i + 1;
      m.set(`op${n}.level`, this.outGain[i].gain);
    }
    m.set('amp.mix', this.finalMix.gain);
    return m;
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    // Fire modulator voices first so their AudioParam contributions land
    // before the oscillators start.
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
    }

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const velMul = options.accent ? 1.3 : 1.0;

    let maxRelease = 0;
    for (let i = 0; i < 4; i++) {
      const p = this.getOp(i);
      const opDef = this.algo.ops[i];
      this.osc[i].frequency.setValueAtTime(freq * p.ratio, time);
      this.osc[i].detune.setValueAtTime(p.detune, time);

      const a = Math.max(0.001, p.attack);
      const d = Math.max(0.001, p.decay);
      const sus = Math.max(0.0001, p.sustain);
      // Per-op amp envelope is now written onto the internal ConstantSource's
      // offset, which sums into envGain[i].gain alongside any modulators.
      this.opEnvs[i].offset.cancelScheduledValues(time);
      this.opEnvs[i].offset.setValueAtTime(0, time);
      this.opEnvs[i].offset.linearRampToValueAtTime(1, time + a);
      this.opEnvs[i].offset.linearRampToValueAtTime(sus, time + a + d);

      // Carriers go to mix at modest amplitude; modulators output in Hz of
      // frequency deviation, so we scale by (op freq * index multiplier).
      const opFreq = freq * p.ratio;
      const outVal = opDef.isCarrier
        ? p.level * velMul * 0.25
        : p.level * opFreq * 4;
      this.outGain[i].gain.setValueAtTime(outVal, time);

      if (p.release > maxRelease) maxRelease = p.release;
    }

    // Op4 self-feedback: outGain[3] -> fbGain -> delay(1 sample) -> osc[3].frequency
    if (this.feedback > 0) {
      const op4Freq = freq * this.getOp(3).ratio;
      this.fbGain = this.ctx.createGain();
      this.fbGain.gain.value = this.feedback * op4Freq * 2;
      this.fbDelay = this.ctx.createDelay(0.01);
      this.fbDelay.delayTime.value = 0;
      this.outGain[3].connect(this.fbGain).connect(this.fbDelay).connect(this.osc[3].frequency);
    }

    const gateEnd = time + options.gateDuration;
    for (let i = 0; i < 4; i++) {
      const p = this.getOp(i);
      const r = Math.max(0.005, p.release);
      const sus = Math.max(0.0001, p.sustain);
      this.opEnvs[i].offset.setValueAtTime(sus, gateEnd);
      this.opEnvs[i].offset.exponentialRampToValueAtTime(0.0001, gateEnd + r);
    }

    const stopTime = gateEnd + maxRelease + 0.05;
    for (const o of this.osc) {
      o.start(time);
      o.stop(stopTime);
    }
  }

  release(time: number): void {
    // Cut the pre-scheduled per-op amp envelopes so the gate actually
    // closes at `time` rather than running out the original gateDuration.
    // Each opEnv is a ConstantSource summing into envGain[i].gain.
    for (let i = 0; i < this.opEnvs.length; i++) {
      const env = this.opEnvs[i];
      const p = this.getOp(i);
      const r = Math.max(0.005, p.release);
      env.offset.cancelScheduledValues(time);
      // Anchor the current value, then exponentially decay to near-zero.
      // We can't read AudioParam.value reliably here, so we use setTargetAtTime
      // for a smooth fall starting at `time`.
      env.offset.setTargetAtTime(0, time, r / 3);
    }
    for (const mv of this.voiceMods.values()) mv.release(time);
  }
  connect(_dest: AudioNode): void {}

  dispose(): void {
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
    for (const o of this.osc) { try { o.stop(); } catch {} o.disconnect(); }
    for (const g of this.envGain) g.disconnect();
    for (const g of this.outGain) g.disconnect();
    for (const e of this.opEnvs) { try { e.stop(); } catch {} e.disconnect(); }
    if (this.fbGain) this.fbGain.disconnect();
    if (this.fbDelay) this.fbDelay.disconnect();
    this.finalMix.disconnect();
    for (const mv of this.voiceMods.values()) mv.dispose();
  }
}

class FMSequencer implements EngineSequencer {
  getStepAt(_i: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_s: number): void {}
  serialize(): unknown { return null; }
  deserialize(_d: unknown): void {}
  dispose(): void {}
}

export class FMEngine implements SynthEngine {
  readonly id = 'fm';
  readonly name = 'FM';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly params = FM_PARAMS;
  readonly editor = 'piano-roll' as const;
  get presets(): import('./engine-types').EnginePreset[] {
    return getCachedPresets('fm');
  }

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  /** Engine-wide shared modulation bus. ConstantSourceNodes whose .offset is
   *  driven by scope='shared' modulators (via bindEngineModulators) and whose
   *  output fans out to every voice's matching AudioParam in the constructor.
   *  Lazy-init in createVoice because we need the AudioContext.
   *  FM only shares the final amp gain — per-op envelopes stay per-voice. */
  readonly modBus?: Record<string, ConstantSourceNode>;

  /** Cached engine-wide modulator voices for scope='shared' mods. Spawned
   *  once on the first createVoice call and reused for every subsequent voice
   *  so shared LFOs/ADSRs share phase + state across notes. */
  private engineModVoices: Map<string, ModulatorVoice> | null = null;

  private modHost = new ModulationHostImpl([
    makeDefaultLFO('lfo1'),
    makeDefaultADSR('adsr1'),
  ]);

  /** Persistence + cross-module access to modulator state. */
  get modulators(): ModulationHostImpl { return this.modHost; }

  /** Maximum simultaneous voices. Oldest voice is stolen when exceeded. */
  maxVoices = 6;

  /** Ordered list of active voices (oldest first). */
  private activeVoices: FMVoice[] = [];

  /** How many voices are currently tracked as active. */
  activeVoiceCount(): number {
    return this.activeVoices.length;
  }

  /** Steal (dispose + remove) the N oldest voices. */
  private stealOldest(n: number): void {
    const toSteal = this.activeVoices.splice(0, n);
    for (const v of toSteal) {
      v.dispose();
    }
  }

  private algorithmIndex = 0;
  private feedback = 0;
  private opParams: OpParams[] = [
    { ...OP_DEFAULTS, ratio: 1, level: 0.9 },
    { ...OP_DEFAULTS, ratio: 2, level: 0.5 },
    { ...OP_DEFAULTS, ratio: 3, level: 0.4 },
    { ...OP_DEFAULTS, ratio: 1, level: 0.6 },
  ];

  private paramValues: Record<string, number> = {};

  constructor() {
    for (const p of FM_PARAMS) {
      this.paramValues[p.id] = p.default;
    }
    // Mirror the seeded opParams[] values into the unified store so reads via
    // getBaseValue match what the voice will see when it triggers.
    this.syncOpParamsToValues();
  }

  private syncOpParamsToValues(): void {
    for (let i = 0; i < this.opParams.length; i++) {
      const n = i + 1;
      this.paramValues[`op${n}.level`]   = this.opParams[i].level;
      this.paramValues[`op${n}.ratio`]   = this.opParams[i].ratio;
      this.paramValues[`op${n}.detune`]  = this.opParams[i].detune;
      this.paramValues[`op${n}.attack`]  = this.opParams[i].attack;
      this.paramValues[`op${n}.decay`]   = this.opParams[i].decay;
      this.paramValues[`op${n}.sustain`] = this.opParams[i].sustain;
      this.paramValues[`op${n}.release`] = this.opParams[i].release;
    }
  }

  private syncValuesToOpParams(): void {
    for (let i = 0; i < this.opParams.length; i++) {
      const n = i + 1;
      const lv = this.paramValues[`op${n}.level`];
      const rt = this.paramValues[`op${n}.ratio`];
      const dt = this.paramValues[`op${n}.detune`];
      const at = this.paramValues[`op${n}.attack`];
      const dc = this.paramValues[`op${n}.decay`];
      const su = this.paramValues[`op${n}.sustain`];
      const rl = this.paramValues[`op${n}.release`];
      if (typeof lv === 'number') this.opParams[i].level   = lv;
      if (typeof rt === 'number') this.opParams[i].ratio   = rt;
      if (typeof dt === 'number') this.opParams[i].detune  = dt;
      if (typeof at === 'number') this.opParams[i].attack  = at;
      if (typeof dc === 'number') this.opParams[i].decay   = dc;
      if (typeof su === 'number') this.opParams[i].sustain = su;
      if (typeof rl === 'number') this.opParams[i].release = rl;
    }
  }

  getBaseValue(id: string): number {
    if (id === 'algorithm') return this.algorithmIndex;
    if (id === 'feedback')  return this.feedback;
    return this.paramValues[id] ?? FM_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id === 'algorithm') { this.algorithmIndex = Math.max(0, Math.min(ALGORITHMS.length - 1, Math.round(v))); return; }
    if (id === 'feedback')  { this.feedback = v; return; }
    if (id === 'poly.voices') {
      const newCap = Math.max(1, Math.min(16, Math.round(v)));
      this.maxVoices = newCap;
      this.paramValues[id] = newCap;
      // Steal excess voices immediately if the new cap is below the current count.
      if (this.activeVoices.length > newCap) {
        this.stealOldest(this.activeVoices.length - newCap);
      }
      return;
    }
    this.paramValues[id] = v;
    // Keep the engine's per-op struct in sync so future triggers see the
    // new value.
    this.syncValuesToOpParams();
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  /** Cached so the modulation-panel onChange callback can re-apply bindings. */
  private currentLaneId: string | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    // Lazy-init the shared modulation bus on the first createVoice call.
    if (!this.modBus) {
      const n = ctx.createConstantSource();
      n.offset.value = 0;
      n.start();
      (this as { modBus: Record<string, ConstantSourceNode> }).modBus = {
        'amp.mix': n,
      };
    }
    // 1. Lazy-init engine-wide modulator voices for SHARED mods and bind
    //    them ONCE to the modulation bus AudioParams. The amp.mix paramId is
    //    a 0..1 gain in both the spec and the AudioParam, so the default
    //    rangeLookup (from engine.params) is correct — no override needed.
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
        });
      }
    }
    // 2. Per-voice modulators: spawn per call for this note.
    const voiceMods = this.modHost.spawnVoiceFiltered(
      ctx, () => this.bpm,
      (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'per-voice',
    );
    const voice = new FMVoice(
      ctx,
      output,
      (i) => this.opParams[i],
      ALGORITHMS[this.algorithmIndex],
      this.feedback,
      voiceMods,
      this.modBus,
    );
    // Record BOTH engine-shared and per-voice mods so the rAF tick can find
    // the shared LFO via getActiveModVoice (whose currentValue() syncs the
    // live OscillatorNode to state mutations).
    recordVoiceMods(new Map([...(this.engineModVoices ?? new Map()), ...voiceMods]));
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      // Merge engine-shared mods into the per-voice binding map so a
      // scope='shared' LFO targeting a per-voice-only param (e.g. an op-level
      // envelope) still gets a gain bridge. The voice-mod-binder skips
      // shared-bus paramIds for shared-scope mods so we don't double-route.
      const engineMods = this.engineModVoices ?? new Map<string, ModulatorVoice>();
      const combinedMods = new Map<string, ModulatorVoice>([...engineMods, ...voiceMods]);
      voice.binder = bindVoiceModulators({ laneId, engine: this, voice, voiceMods: combinedMods, ctx });
      this.currentLaneId = laneId;
    }

    // Polyphony cap: track the new voice, then steal oldest if over limit.
    this.activeVoices.push(voice);
    if (this.activeVoices.length > this.maxVoices) {
      this.stealOldest(this.activeVoices.length - this.maxVoices);
    }

    // Self-pruning: when the last oscillator fires its 'ended' event the voice
    // has finished naturally — remove it from activeVoices so the slot is freed
    // without waiting for a steal on overflow.
    const lastOsc = voice.osc[voice.osc.length - 1];
    lastOsc.addEventListener('ended', () => {
      const idx = this.activeVoices.indexOf(voice);
      if (idx !== -1) this.activeVoices.splice(idx, 1);
    });

    return voice;
  }

  getSharedAudioParams(_ctx?: AudioContext): Map<string, AudioParam> {
    if (!this.modBus) return new Map();
    return new Map<string, AudioParam>([
      ['amp.mix', this.modBus['amp.mix'].offset],
    ]);
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new FMSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    const fmtSec = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
    const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

    // Top section: Algorithm + Feedback
    const topRow = document.createElement('div');
    topRow.className = 'row poly-section';
    const topLab = document.createElement('div');
    topLab.className = 'section-label';
    topLab.textContent = 'ALGORITHM';
    topRow.appendChild(topLab);
    const topKnobs = document.createElement('div');
    topKnobs.className = 'knob-row';
    topRow.appendChild(topKnobs);
    container.appendChild(topRow);

    wireEngineParams(this, ctx, topKnobs, {
      filter: (id) => id === 'algorithm' || id === 'feedback',
      formatter: (_id, v) => fmtPct(v),
    });

    // Per-op sections (op1..op4).
    for (let i = 0; i < 4; i++) {
      const n = i + 1;
      const row = document.createElement('div');
      row.className = 'row poly-section';
      const lab = document.createElement('div');
      lab.className = 'section-label';
      lab.textContent = `OP ${n}`;
      row.appendChild(lab);
      const knobRow = document.createElement('div');
      knobRow.className = 'knob-row';
      row.appendChild(knobRow);
      container.appendChild(row);

      wireEngineParams(this, ctx, knobRow, {
        filter: (id) => id.startsWith(`op${n}.`),
        formatter: (id, v) => {
          if (id.endsWith('.ratio'))   return v.toFixed(2);
          if (id.endsWith('.detune'))  return `${v.toFixed(0)}¢`;
          if (id.endsWith('.attack') || id.endsWith('.decay') || id.endsWith('.release')) return fmtSec(v);
          return fmtPct(v);
        },
      });
    }

    // Mix knob on its own.
    const mixRow = document.createElement('div');
    mixRow.className = 'row poly-section';
    const mixLab = document.createElement('div');
    mixLab.className = 'section-label';
    mixLab.textContent = 'MIX';
    mixRow.appendChild(mixLab);
    const mixKnobs = document.createElement('div');
    mixKnobs.className = 'knob-row';
    mixRow.appendChild(mixKnobs);
    container.appendChild(mixRow);
    wireEngineParams(this, ctx, mixKnobs, {
      filter: (id) => id === 'amp.mix' || id === 'poly.voices',
      formatter: (id, v) => id === 'poly.voices' ? String(Math.round(v)) : fmtPct(v),
    });

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
        this.buildParamUI(container, ctx);
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
      },
    });
  }

  randomize(): void {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const ratios = [0.5, 1, 1, 2, 2, 3, 4, 5, 7];
    this.algorithmIndex = Math.floor(Math.random() * ALGORITHMS.length);
    this.feedback = Math.random() < 0.4 ? Math.random() * 0.6 : 0;
    for (let i = 0; i < 4; i++) {
      this.opParams[i] = {
        ratio: ratios[Math.floor(Math.random() * ratios.length)],
        detune: rnd(-12, 12),
        level: rnd(0.4, 1),
        attack: rnd(0.005, 0.15),
        decay: rnd(0.05, 0.6),
        sustain: rnd(0.3, 0.9),
        release: rnd(0.1, 1.2),
      };
    }
    this.syncOpParamsToValues();
  }

  dispose(): void {}
}

export const fmEngine = new FMEngine();
registerEngine(fmEngine);
registerEngineFactory('fm', () => new FMEngine());

export const fmPlugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'fm',
    name: 'FM',
    kind: 'synth',
    version: '1.0.0',
    params: fmEngine.params,
    presets: [],
  },
  create(ctx, output) {
    const engine = new FMEngine();
    const voice = engine.createVoice(ctx, output);
    return {
      trigger:                (m, t, o) => voice.trigger(m, t, o),
      release:                (t)       => voice.release(t),
      connect:                (d)       => voice.connect(d),
      getAudioParams:         ()        => voice.getAudioParams(),
      getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
      getSharedAudioParams:   (c)       => engine.getSharedAudioParams?.(c) ?? new Map(),
      getBaseValue:           (id)      => engine.getBaseValue(id),
      setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
      applyPreset:            (name)    => engine.applyPreset(name),
      dispose:                ()        => { voice.dispose(); engine.dispose(); },
    };
  },
};
