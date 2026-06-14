// src/engines/westcoast.ts
// "West Coast" (Buchla-style) synthesis engine: a complex oscillator (two
// cross-modulating oscillators via linear FM + ring/AM, plus a sub-harmonic
// divider) → a wavefolder ("Timbre") → a low-pass gate (vactrol-style),
// driven by a built-in AD "contour". Generation by FOLDING + cross-modulation
// rather than subtractive filtering. All real-time nodes; every param is
// live-modulatable. Cloned from the wavetable.ts engine shape.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { PluginFactory } from '../plugins/types';
import { registerEngine, registerEngineFactory } from './registry';
import type { KnobHandle } from '../core/knob';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorVoice } from '../modulation/types';
import { recordVoiceMods, getCurrentLaneForVoice } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import {
  bindEngineModulators, bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations,
} from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import { wireEngineParams } from './engine-ui';
import { getCachedPresets } from '../presets/preset-loader';
import { velGain } from '../core/velocity-gain';
import { makeFoldCurve } from './westcoast-fold';

const MAIN_WAVE_OPTIONS = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sawtooth', label: 'Saw' },
];
const MOD_WAVE_OPTIONS = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
];
const SUBDIV_OPTIONS = [
  { value: 'off', label: 'Off' }, { value: '2', label: '2' },
  { value: '3', label: '3' }, { value: '4', label: '4' },
];
const LPG_MODE_OPTIONS = [
  { value: 'lp', label: 'LP' }, { value: 'gate', label: 'Gate' }, { value: 'both', label: 'Both' },
];
const CONTOUR_MODE_OPTIONS = [
  { value: 'pluck', label: 'Pluck' }, { value: 'sustain', label: 'Sus' },
];
const ONOFF_OPTIONS = [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }];
const POLY_MODE_OPTIONS = [{ value: 'poly', label: 'Poly' }, { value: 'mono', label: 'Mono' }];

const MAIN_WAVE_VALUES = MAIN_WAVE_OPTIONS.map(o => o.value) as OscillatorType[];
const MOD_WAVE_VALUES = MOD_WAVE_OPTIONS.map(o => o.value) as OscillatorType[];
const SUBDIV_VALUES = [0, 2, 3, 4]; // index → divisor (0 = off)

const WEST_PARAMS: EngineParamSpec[] = [
  // Complex oscillator
  { id: 'osc.mainWave', label: 'Princ Wave', kind: 'discrete', min: 0, max: 2, default: 0, options: MAIN_WAVE_OPTIONS },
  { id: 'osc.modWave',  label: 'Mod Wave',   kind: 'discrete', min: 0, max: 1, default: 0, options: MOD_WAVE_OPTIONS },
  { id: 'osc.ratio',    label: 'Ratio',      kind: 'continuous', min: 0.25, max: 16, default: 2, unit: '×' },
  { id: 'osc.fmIndex',  label: 'FM Index',   kind: 'continuous', min: 0, max: 1, default: 0.2 },
  { id: 'osc.ring',     label: 'Ring/AM',    kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'osc.subDiv',   label: 'Sub ÷',      kind: 'discrete', min: 0, max: 3, default: 0, options: SUBDIV_OPTIONS },
  { id: 'osc.subLevel', label: 'Sub Lvl',    kind: 'continuous', min: 0, max: 1, default: 0.3 },
  { id: 'osc.detune',   label: 'Detune',     kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢' },
  // Timbre (wavefolder)
  { id: 'timbre.fold',     label: 'Fold',     kind: 'continuous', min: 0, max: 1, default: 0.5 },
  { id: 'timbre.symmetry', label: 'Symmetry', kind: 'continuous', min: -1, max: 1, default: 0 },
  // Low-pass gate
  { id: 'lpg.mode',      label: 'Mode',      kind: 'discrete', min: 0, max: 2, default: 2, options: LPG_MODE_OPTIONS },
  { id: 'lpg.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.6 },
  { id: 'lpg.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.2 },
  // Contour
  { id: 'contour.mode',   label: 'Mode',    kind: 'discrete', min: 0, max: 1, default: 0, options: CONTOUR_MODE_OPTIONS },
  { id: 'contour.attack', label: 'Attack',  kind: 'continuous', min: 0.001, max: 2, default: 0.005, unit: 's', curve: 'exponential' },
  { id: 'contour.decay',  label: 'Decay',   kind: 'continuous', min: 0.005, max: 4, default: 0.4, unit: 's', curve: 'exponential' },
  { id: 'contour.amount', label: 'Amount',  kind: 'continuous', min: 0, max: 1, default: 0.9 },
  { id: 'contour.cycle',  label: 'Cycle',   kind: 'discrete', min: 0, max: 1, default: 0, options: ONOFF_OPTIONS },
  // Amp / master
  { id: 'amp.level',   label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 },
  { id: 'master.tune', label: 'Tune',  kind: 'continuous', min: -12, max: 12, default: 0, unit: 'st' },
  // Poly
  // poly.mode = real monophony (effective cap 1). Legato/retrig is future work.
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16, default: 8 },
  { id: 'poly.mode',   label: 'Mode',   kind: 'discrete', min: 0, max: 1, default: 0, options: POLY_MODE_OPTIONS },
];

/** Operating ranges for the shared modBus AudioParams (native units). Must
 *  agree with WestVoice.getAudioParamRange so depth=1 swings equally whether
 *  the modulator is shared or per-voice. */
function sharedParamRange(shortId: string): { min: number; max: number } {
  switch (shortId) {
    case 'lpg.cutoff':    return { min: -4000, max: 4000 };
    case 'lpg.resonance': return { min: -10, max: 10 };
    case 'timbre.fold':   return { min: -1, max: 1 };
    case 'amp.gain':      return { min: 0, max: 1 };
    default:              return { min: 0, max: 1 };
  }
}

const FOLD_CURVE = makeFoldCurve();
// Holds the post-fold peak below 0 dBFS at accent + max fold (mirrors the
// OUTPUT_TRIM in wavetable.ts / fm.ts).
const OUTPUT_TRIM = 0.5;
// Multiplier on the base cutoff Hz that the contour applies to the filter.
// Relative (not absolute) so the base cutoff param genuinely controls timbre:
// low cutoff → contour sweeps a narrow band; high cutoff → contour sweeps wide.
const CUTOFF_ENV_SCALE = 3;

function midiToHz(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }
function cutoffHz(norm: number): number { return Math.min(18000, 60 * Math.pow(220, norm)); }

class WestVoice implements Voice {
  readonly mainOsc: OscillatorNode;
  private modOsc: OscillatorNode;
  private subOsc: OscillatorNode;
  private fmDepth: GainNode;
  private ringMod: GainNode;
  private ringGain: GainNode;
  private mainGain: GainNode;
  private subGain: GainNode;
  private bias: ConstantSourceNode;
  private foldDrive: GainNode;
  private folder: WaveShaperNode;
  private lpgFilter: BiquadFilterNode;
  private lpgVCA: GainNode;
  private ampOut: GainNode;
  private contour: ConstantSourceNode;
  private cutoffBase: ConstantSourceNode;
  private cutoffEnvGain: GainNode;
  private vcaEnvGain: GainNode;
  private started = false;
  private stopScheduled = false;

  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private getParam: (id: string) => number,
    private voiceMods: Map<string, ModulatorVoice>,
    modBus?: Record<string, ConstantSourceNode>,
  ) {
    this.mainOsc = ctx.createOscillator();
    this.modOsc = ctx.createOscillator();
    this.subOsc = ctx.createOscillator();
    this.fmDepth = ctx.createGain();
    this.ringMod = ctx.createGain(); this.ringMod.gain.value = 0;
    this.ringGain = ctx.createGain(); this.ringGain.gain.value = 0;
    this.mainGain = ctx.createGain(); this.mainGain.gain.value = 0;
    this.subGain = ctx.createGain(); this.subGain.gain.value = 0;
    this.bias = ctx.createConstantSource(); this.bias.offset.value = 0; this.bias.start();
    this.foldDrive = ctx.createGain(); this.foldDrive.gain.value = 0.1;
    this.folder = ctx.createWaveShaper();
    (this.folder as { curve: Float32Array | null }).curve = FOLD_CURVE;
    this.folder.oversample = '4x';
    this.lpgFilter = ctx.createBiquadFilter(); this.lpgFilter.type = 'lowpass';
    this.lpgVCA = ctx.createGain(); this.lpgVCA.gain.value = 0;
    this.ampOut = ctx.createGain(); this.ampOut.gain.value = 1;
    this.contour = ctx.createConstantSource(); this.contour.offset.value = 0; this.contour.start();
    this.cutoffBase = ctx.createConstantSource(); this.cutoffBase.offset.value = 0; this.cutoffBase.start();
    this.cutoffEnvGain = ctx.createGain(); this.cutoffEnvGain.gain.value = 0;
    this.vcaEnvGain = ctx.createGain(); this.vcaEnvGain.gain.value = 0;

    // Complex oscillator wiring.
    this.modOsc.connect(this.fmDepth).connect(this.mainOsc.frequency); // linear FM
    this.mainOsc.connect(this.ringMod);                                 // ring/AM
    this.modOsc.connect(this.ringMod.gain);
    this.ringMod.connect(this.ringGain);
    this.mainOsc.connect(this.mainGain);                                // dry
    this.subOsc.connect(this.subGain);                                  // sub
    // Sum osc paths + DC bias into the folder drive.
    this.mainGain.connect(this.foldDrive);
    this.ringGain.connect(this.foldDrive);
    this.subGain.connect(this.foldDrive);
    this.bias.connect(this.foldDrive);
    // Wavefolder → low-pass gate → output.
    this.foldDrive.connect(this.folder);
    this.folder.connect(this.lpgFilter).connect(this.lpgVCA).connect(this.ampOut).connect(output);
    // Cutoff: base + contour-driven env into filter frequency.
    this.lpgFilter.frequency.value = 0;
    this.cutoffBase.connect(this.lpgFilter.frequency);
    this.contour.connect(this.cutoffEnvGain).connect(this.lpgFilter.frequency);
    // VCA: contour-driven gate.
    this.contour.connect(this.vcaEnvGain).connect(this.lpgVCA.gain);

    // Shared modulation bus fan-in (one connection regardless of voice count).
    if (modBus) {
      modBus['lpg.cutoff'].connect(this.lpgFilter.frequency);
      modBus['lpg.resonance'].connect(this.lpgFilter.Q);
      modBus['amp.gain'].connect(this.ampOut.gain);
      modBus['timbre.fold'].connect(this.foldDrive.gain);
    }
  }

  getAudioParams(): Map<string, AudioParam> {
    return new Map<string, AudioParam>([
      ['amp.gain',         this.ampOut.gain],
      ['lpg.cutoff',       this.lpgFilter.frequency],
      ['lpg.resonance',    this.lpgFilter.Q],
      ['timbre.fold',      this.foldDrive.gain],
      ['timbre.symmetry',  this.bias.offset],
      ['osc.fmIndex',      this.fmDepth.gain],
      ['osc.ring',         this.ringGain.gain],
      ['osc.detune',       this.mainOsc.detune],
    ]);
  }

  getAudioParamRange(shortId: string): { min: number; max: number } | undefined {
    switch (shortId) {
      case 'lpg.cutoff':    return { min: -4000, max: 4000 };
      case 'lpg.resonance': return { min: -10, max: 10 };
      case 'timbre.fold':   return { min: -1, max: 1 };
      case 'timbre.symmetry': return { min: -1, max: 1 };
      case 'osc.fmIndex':   return { min: -2000, max: 2000 };
      case 'osc.detune':    return { min: -1200, max: 1200 };
      default: return undefined; // amp.gain, osc.ring fall back to 0..1
    }
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
    }
    const p = this.getParam;
    const note = midiToHz(midi);
    const tuneCents = p('master.tune') * 100;
    const detune = p('osc.detune');
    const ratio = p('osc.ratio');
    const fmIndex = p('osc.fmIndex');
    const ring = p('osc.ring');
    const subDiv = SUBDIV_VALUES[Math.round(p('osc.subDiv'))] ?? 0;
    const subLevel = p('osc.subLevel');
    const fold = p('timbre.fold');
    const symmetry = p('timbre.symmetry');
    const mode = Math.round(p('lpg.mode'));   // 0 lp, 1 gate, 2 both
    const filterMode = mode === 0 || mode === 2;
    const vcaMode = mode === 1 || mode === 2;
    const cutoff = p('lpg.cutoff');
    const res = p('lpg.resonance');
    const cmode = Math.round(p('contour.mode')); // 0 pluck, 1 sustain
    const atk = Math.max(0.001, p('contour.attack'));
    const dec = Math.max(0.005, p('contour.decay'));
    const amount = p('contour.amount');
    const cycle = Math.round(p('contour.cycle')) >= 1;
    const level = p('amp.level');
    const accentMul = options.accent ? 1.3 : 1.0;
    const vel = velGain(options.velocity, !!options.accent);

    // Oscillators.
    this.mainOsc.type = MAIN_WAVE_VALUES[Math.round(p('osc.mainWave'))] ?? 'sine';
    this.modOsc.type = MOD_WAVE_VALUES[Math.round(p('osc.modWave'))] ?? 'sine';
    this.subOsc.type = 'sine';
    this.mainOsc.frequency.setValueAtTime(note, time);
    this.mainOsc.detune.setValueAtTime(detune + tuneCents, time);
    this.modOsc.frequency.setValueAtTime(note * ratio, time);
    this.modOsc.detune.setValueAtTime(tuneCents, time);
    this.subOsc.frequency.setValueAtTime(subDiv > 0 ? note / subDiv : note, time);
    this.subOsc.detune.setValueAtTime(tuneCents, time);

    // Linear FM depth (Hz) ≈ index × modFreq × 2.
    this.fmDepth.gain.setValueAtTime(fmIndex * note * ratio * 2, time);

    // Oscillator mix.
    this.mainGain.gain.setValueAtTime(0.7, time);
    this.ringGain.gain.setValueAtTime(ring, time);
    this.subGain.gain.setValueAtTime(subDiv > 0 ? subLevel : 0, time);

    // Wavefolder: foldDrive sweeps the signal across the fold curve; bias = asymmetry.
    this.foldDrive.gain.setValueAtTime((0.1 + fold * 0.9) * accentMul, time);
    this.bias.offset.setValueAtTime(symmetry * 0.5, time);

    // Low-pass gate base + per-mode routing.
    this.lpgFilter.Q.setValueAtTime(0.5 + res * 20, time);
    this.cutoffBase.offset.setValueAtTime(cutoffHz(cutoff), time);
    this.cutoffEnvGain.gain.setValueAtTime(filterMode ? cutoffHz(cutoff) * CUTOFF_ENV_SCALE * accentMul : 0, time);
    this.vcaEnvGain.gain.setValueAtTime(vcaMode ? 1 : 0, time);
    this.lpgVCA.gain.setValueAtTime(vcaMode ? 0 : 1, time);

    // Output level (velocity + trim). amp.gain modBus sums on top.
    this.ampOut.gain.setValueAtTime(level * vel * OUTPUT_TRIM, time);

    // Contour AD (vactrol-style exponential decay via setTargetAtTime).
    const peak = amount;
    const gateEnd = time + options.gateDuration;
    this.contour.offset.cancelScheduledValues(time);
    this.contour.offset.setValueAtTime(0, time);
    this.contour.offset.linearRampToValueAtTime(peak, time + atk);
    let tailEnd: number;
    if (cmode === 1 && !cycle) {
      // Sustain: hold until gate end, then exponential release over decay.
      this.contour.offset.setValueAtTime(peak, gateEnd);
      this.contour.offset.setTargetAtTime(0, gateEnd, dec / 3);
      tailEnd = gateEnd + dec * 3;
    } else {
      // Pluck (and cycle base shape): exponential decay after attack, gate-independent.
      this.contour.offset.setTargetAtTime(0, time + atk, dec / 3);
      tailEnd = time + atk + dec * 3;
    }
    if (cycle) {
      // Re-trigger the AD shape on a loop → free-running LFO-like contour.
      const period = atk + dec;
      const until = Math.max(tailEnd, gateEnd);
      let t = time + period;
      while (t < until + period) {
        this.contour.offset.setValueAtTime(0, t);
        this.contour.offset.linearRampToValueAtTime(peak, t + atk);
        this.contour.offset.setTargetAtTime(0, t + atk, dec / 3);
        t += period;
      }
      tailEnd = t;
    }

    if (!this.started) {
      this.mainOsc.start(time); this.modOsc.start(time); this.subOsc.start(time);
      this.started = true;
    }
    const stopTime = Math.max(tailEnd, gateEnd) + 0.1;
    this.mainOsc.stop(stopTime); this.modOsc.stop(stopTime); this.subOsc.stop(stopTime);
    this.stopScheduled = true;
  }

  release(time: number): void {
    for (const mv of this.voiceMods.values()) mv.release(time);
    // Fast gate-close on the contour (closes VCA in gate/both modes; closes the
    // filter env in lp/both). Mirrors the wavetable release-cut pattern.
    this.contour.offset.cancelScheduledValues(time);
    this.contour.offset.linearRampToValueAtTime(0, time + 0.02);
  }

  connect(_dest: AudioNode): void {}

  dispose(): void {
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
    if (!this.stopScheduled && this.started) {
      try { this.mainOsc.stop(); } catch {}
      try { this.modOsc.stop(); } catch {}
      try { this.subOsc.stop(); } catch {}
      this.stopScheduled = true;
    }
    try { this.bias.stop(); } catch {}
    try { this.contour.stop(); } catch {}
    try { this.cutoffBase.stop(); } catch {}
    this.mainOsc.disconnect(); this.modOsc.disconnect(); this.subOsc.disconnect();
    this.fmDepth.disconnect(); this.ringMod.disconnect(); this.ringGain.disconnect();
    this.mainGain.disconnect(); this.subGain.disconnect(); this.bias.disconnect();
    this.foldDrive.disconnect(); this.folder.disconnect();
    this.lpgFilter.disconnect(); this.lpgVCA.disconnect(); this.ampOut.disconnect();
    this.contour.disconnect(); this.cutoffBase.disconnect();
    this.cutoffEnvGain.disconnect(); this.vcaEnvGain.disconnect();
    for (const mv of this.voiceMods.values()) mv.dispose();
  }
}

class WestSequencer implements EngineSequencer {
  getStepAt(_index: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_step: number): void {}
  serialize(): unknown { return null; }
  deserialize(_data: unknown): void {}
  dispose(): void {}
}

export class WestEngine implements SynthEngine {
  readonly id = 'westcoast';
  readonly name = 'West';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = WEST_PARAMS;
  get presets(): import('./engine-types').EnginePreset[] {
    return getCachedPresets('westcoast');
  }

  private paramValues: Record<string, number> = {};
  bpm = 120;
  maxVoices = 8;
  private monoMode = false;
  private activeVoices: WestVoice[] = [];
  private currentLaneId: string | null = null;

  readonly modBus?: Record<string, ConstantSourceNode>;
  private engineModVoices: Map<string, ModulatorVoice> | null = null;

  private modHost = new ModulationHostImpl([
    { ...makeDefaultADSR('adsr1'), connections: [{ id: 'c-fold', paramId: 'timbre.fold', depth: 0 }] },
    { ...makeDefaultADSR('adsr2'), connections: [{ id: 'c-cut', paramId: 'lpg.cutoff', depth: 0 }] },
    makeDefaultLFO('lfo1'),
    { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
  ]);
  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of WEST_PARAMS) this.paramValues[p.id] = p.default;
  }

  activeVoiceCount(): number { return this.activeVoices.length; }

  /** Mono mode collapses the effective polyphony cap to 1 voice. */
  private effectiveCap(): number {
    return this.monoMode ? 1 : this.maxVoices;
  }

  private stealOldest(n: number): void {
    const toSteal = this.activeVoices.splice(0, n);
    for (const v of toSteal) v.dispose();
  }

  getBaseValue(id: string): number {
    return this.paramValues[id] ?? WEST_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id === 'poly.voices') {
      const cap = Math.max(1, Math.min(16, Math.round(v)));
      this.maxVoices = cap;
      this.paramValues[id] = cap;
      if (this.activeVoices.length > cap) this.stealOldest(this.activeVoices.length - cap);
      return;
    }
    if (id === 'poly.mode') {
      this.monoMode = v >= 0.5;
      this.paramValues[id] = this.monoMode ? 1 : 0;
      if (this.activeVoices.length > this.effectiveCap()) {
        this.stealOldest(this.activeVoices.length - this.effectiveCap());
      }
      return;
    }
    this.paramValues[id] = v;
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [k, val] of Object.entries(preset.params)) {
      if (typeof val === 'number') this.setBaseValue(k, val);
    }
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (!this.modBus) {
      const mk = () => { const n = ctx.createConstantSource(); n.offset.value = 0; n.start(); return n; };
      (this as { modBus: Record<string, ConstantSourceNode> }).modBus = {
        'lpg.cutoff': mk(), 'lpg.resonance': mk(), 'amp.gain': mk(), 'timbre.fold': mk(),
      };
    }
    if (!this.engineModVoices) {
      this.engineModVoices = this.modHost.spawnVoiceFiltered(
        ctx, () => this.bpm,
        (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'shared',
      );
      const sharedLaneId = getCurrentLaneForVoice();
      if (sharedLaneId) {
        bindEngineModulators({
          laneId: sharedLaneId, engine: this, voiceMods: this.engineModVoices, ctx,
          rangeLookup: (shortId) => sharedParamRange(shortId),
        });
      }
    }
    const voiceMods = this.modHost.spawnVoiceFiltered(
      ctx, () => this.bpm,
      (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'per-voice',
    );
    const voice = new WestVoice(ctx, output, (id) => this.getBaseValue(id), voiceMods, this.modBus);
    recordVoiceMods(new Map([...(this.engineModVoices ?? new Map()), ...voiceMods]));
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      const engineMods = this.engineModVoices ?? new Map();
      const combinedMods = new Map<string, ModulatorVoice>([...engineMods, ...voiceMods]);
      voice.binder = bindVoiceModulators({
        laneId, engine: this, voice, voiceMods: combinedMods, ctx, voicePool: this.effectiveCap(),
      });
      this.currentLaneId = laneId;
    }
    this.activeVoices.push(voice);
    if (this.activeVoices.length > this.effectiveCap()) {
      this.stealOldest(this.activeVoices.length - this.effectiveCap());
    }
    voice.mainOsc.addEventListener('ended', () => {
      const idx = this.activeVoices.indexOf(voice);
      if (idx !== -1) this.activeVoices.splice(idx, 1);
    });
    return voice;
  }

  getSharedAudioParams(_ctx?: AudioContext): Map<string, AudioParam> {
    if (!this.modBus) return new Map();
    return new Map<string, AudioParam>([
      ['lpg.cutoff',    this.modBus['lpg.cutoff'].offset],
      ['lpg.resonance', this.modBus['lpg.resonance'].offset],
      ['amp.gain',      this.modBus['amp.gain'].offset],
      ['timbre.fold',   this.modBus['timbre.fold'].offset],
    ]);
  }

  buildSequencer(_container: HTMLElement, _stepCount: number): EngineSequencer {
    return new WestSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    const fmt = (id: string, v: number): string => {
      if (id === 'osc.ratio') return `${v.toFixed(2)}×`;
      if (id === 'osc.detune') return `${v.toFixed(0)}¢`;
      if (id === 'master.tune') return `${v.toFixed(0)}st`;
      if (id === 'poly.voices') return String(Math.round(v));
      if (id.endsWith('.attack') || id.endsWith('.decay')) {
        return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
      }
      return `${Math.round(v * 100)}%`;
    };

    const section = (labelText: string, accentClass: string, ids: string[]): void => {
      const row = document.createElement('div');
      row.className = 'row'; // same pattern as Subtractive's section rows
      const lab = document.createElement('div');
      lab.className = 'section-label'; // existing class used by subtractive.ts
      lab.textContent = labelText;
      row.appendChild(lab);
      const knobRow = document.createElement('div');
      knobRow.className = `knob-row ${accentClass}`;
      row.appendChild(knobRow);
      container.appendChild(row);
      wireEngineParams(this, ctx, knobRow, {
        filter: (id) => ids.includes(id),
        formatter: fmt,
      });
    };

    section('POLY', 'west-poly-knobs', ['poly.mode', 'poly.voices']);
    section('COMPLEX OSCILLATOR', 'west-osc-knobs',
      ['osc.mainWave', 'osc.modWave', 'osc.ratio', 'osc.fmIndex', 'osc.ring', 'osc.subDiv', 'osc.subLevel', 'osc.detune']);
    section('TIMBRE', 'west-timbre-knobs', ['timbre.fold', 'timbre.symmetry']);
    section('LOW-PASS GATE', 'west-lpg-knobs', ['lpg.mode', 'lpg.cutoff', 'lpg.resonance']);
    section('CONTOUR', 'west-contour-knobs',
      ['contour.mode', 'contour.attack', 'contour.decay', 'contour.amount', 'contour.cycle']);
    section('AMP', 'west-amp-knobs', ['amp.level', 'master.tune']);

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

  dispose(): void {
    for (const v of this.activeVoices) v.dispose();
    this.activeVoices = [];
  }
}

export const westEngine = new WestEngine();
registerEngine(westEngine);
registerEngineFactory('westcoast', () => new WestEngine());

export const westcoastPlugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'westcoast',
    name: 'West',
    kind: 'synth',
    version: '1.0.0',
    params: westEngine.params,
    presets: [],
  },
  create(ctx, output) {
    const engine = new WestEngine();
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
