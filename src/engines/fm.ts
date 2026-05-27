// 4-operator FM engine (DX7-style, simplified).
// Each operator: sine oscillator + ADSR envelope + output level.
// 4 algorithms covering common topologies (serial, parallel mods, two pairs, all-additive).
// Op4 self-feedback.

import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { createKnob, type KnobHandle } from '../core/knob';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorVoice } from '../modulation/types';
import { recordVoiceMods } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';

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

// Unified-param schema. Operator ids are 1-indexed everywhere (op1..op4),
// matching the UI labels and disambiguating from the legacy 0-indexed knob ids.
const FM_PARAMS: EngineParamSpec[] = [
  // Operator 1 (carrier in most algorithms)
  { id: 'op1.level',  label: 'Op1 Lvl',   kind: 'continuous', min: 0,    max: 1,  default: 0.9 },
  { id: 'op1.ratio',  label: 'Op1 Ratio', kind: 'continuous', min: 0.25, max: 16, default: 1, curve: 'exponential' },
  { id: 'op1.attack', label: 'Op1 Atk',   kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'op1.decay',  label: 'Op1 Dec',   kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's' },
  // Operator 2
  { id: 'op2.level',  label: 'Op2 Lvl',   kind: 'continuous', min: 0,    max: 1,  default: 0.5 },
  { id: 'op2.ratio',  label: 'Op2 Ratio', kind: 'continuous', min: 0.25, max: 16, default: 2, curve: 'exponential' },
  { id: 'op2.attack', label: 'Op2 Atk',   kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'op2.decay',  label: 'Op2 Dec',   kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's' },
  // Operator 3
  { id: 'op3.level',  label: 'Op3 Lvl',   kind: 'continuous', min: 0,    max: 1,  default: 0.4 },
  { id: 'op3.ratio',  label: 'Op3 Ratio', kind: 'continuous', min: 0.25, max: 16, default: 3, curve: 'exponential' },
  { id: 'op3.attack', label: 'Op3 Atk',   kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'op3.decay',  label: 'Op3 Dec',   kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's' },
  // Operator 4 (feedback source)
  { id: 'op4.level',  label: 'Op4 Lvl',   kind: 'continuous', min: 0,    max: 1,  default: 0.6 },
  { id: 'op4.ratio',  label: 'Op4 Ratio', kind: 'continuous', min: 0.25, max: 16, default: 1, curve: 'exponential' },
  { id: 'op4.attack', label: 'Op4 Atk',   kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'op4.decay',  label: 'Op4 Dec',   kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's' },
  // Mix / global
  { id: 'amp.mix',    label: 'Mix',       kind: 'continuous', min: 0, max: 1, default: 0.7 },
];

class FMVoice implements Voice {
  public readonly osc: OscillatorNode[] = [];
  private envGain: GainNode[] = [];
  public readonly outGain: GainNode[] = [];
  public readonly finalMix: GainNode;
  private fbGain: GainNode | null = null;
  private fbDelay: DelayNode | null = null;
  private opEnvs!: ConstantSourceNode[];

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private getOp: (i: number) => OpParams,
    private algo: FMAlgorithm,
    private feedback: number,
    private voiceMods: Map<string, ModulatorVoice>,
  ) {
    this.finalMix = ctx.createGain();
    this.finalMix.connect(output);

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
    // 1-indexed operator ids matching FM_PARAMS.
    for (let i = 0; i < this.outGain.length; i++) {
      const n = i + 1;
      m.set(`op${n}.level`, this.outGain[i].gain);
      if (this.osc[i]) m.set(`op${n}.ratio`, this.osc[i].detune);
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
    for (const mv of this.voiceMods.values()) mv.release(time);
  }
  connect(_dest: AudioNode): void {}

  dispose(): void {
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
  readonly name = 'FM (4-op)';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly params = FM_PARAMS;
  readonly editor = 'piano-roll' as const;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  private modHost = new ModulationHostImpl([
    makeDefaultLFO('lfo1'),
    makeDefaultADSR('adsr1'),
  ]);

  /** Persistence + cross-module access to modulator state. */
  get modulators(): ModulationHostImpl { return this.modHost; }

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
      this.paramValues[`op${n}.level`]  = this.opParams[i].level;
      this.paramValues[`op${n}.ratio`]  = this.opParams[i].ratio;
      this.paramValues[`op${n}.attack`] = this.opParams[i].attack;
      this.paramValues[`op${n}.decay`]  = this.opParams[i].decay;
    }
  }

  private syncValuesToOpParams(): void {
    for (let i = 0; i < this.opParams.length; i++) {
      const n = i + 1;
      const lv = this.paramValues[`op${n}.level`];
      const rt = this.paramValues[`op${n}.ratio`];
      const at = this.paramValues[`op${n}.attack`];
      const dc = this.paramValues[`op${n}.decay`];
      if (typeof lv === 'number') this.opParams[i].level  = lv;
      if (typeof rt === 'number') this.opParams[i].ratio  = rt;
      if (typeof at === 'number') this.opParams[i].attack = at;
      if (typeof dc === 'number') this.opParams[i].decay  = dc;
    }
  }

  getBaseValue(id: string): number {
    return this.paramValues[id] ?? FM_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
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

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    const voiceMods = this.modHost.spawnVoice(ctx, () => this.bpm);
    const voice = new FMVoice(
      ctx,
      output,
      (i) => this.opParams[i],
      ALGORITHMS[this.algorithmIndex],
      this.feedback,
      voiceMods,
    );
    recordVoiceMods(voiceMods);
    return voice;
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new FMSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    this.uiCtx = ctx;
    container.appendChild(this.buildAlgoSection());
    for (let i = 0; i < 4; i++) {
      container.appendChild(this.buildOpSection(i));
    }

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
        },
      });
    }
  }
  private uiCtx?: EngineUIContext;

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

  private buildAlgoSection(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row poly-section';

    const lab = document.createElement('div');
    lab.className = 'section-label';
    lab.textContent = 'ALGORITHM';
    row.appendChild(lab);

    const sel = document.createElement('select');
    ALGORITHMS.forEach((a, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${a.id}. ${a.name}`;
      if (i === this.algorithmIndex) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => { this.algorithmIndex = parseInt(sel.value, 10); });
    row.appendChild(sel);

    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    const k = createKnob({
      label: 'FB (op4)',
      min: 0, max: 1, value: this.feedback, defaultValue: 0,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => { this.feedback = v; },
    });
    this.uiCtx?.registerKnob(k);
    knobRow.appendChild(k.el);
    row.appendChild(knobRow);
    return row;
  }

  private buildOpSection(idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row poly-section';

    const lab = document.createElement('div');
    lab.className = 'section-label';
    lab.textContent = `OP ${idx + 1}`;
    row.appendChild(lab);

    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    const p = this.opParams[idx];
    const fmtSec = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
    const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

    const mk = (label: string, min: number, max: number, val: number, def: number, fmt: (v: number) => string, set: (v: number) => void) => {
      const k = createKnob({ label, min, max, value: val, defaultValue: def, format: fmt, onChange: set });
      this.uiCtx?.registerKnob(k);
      knobRow.appendChild(k.el);
    };

    const n = idx + 1;
    mk('Ratio',   0.1,   16, p.ratio,   1,    (v) => v.toFixed(2),           (v) => { p.ratio = v;   this.paramValues[`op${n}.ratio`]  = v; });
    mk('Detune', -50,    50, p.detune,  0,    (v) => `${v.toFixed(0)}¢`,     (v) => { p.detune = v; });
    mk('Level',   0,      1, p.level,   0.5,  fmtPct,                        (v) => { p.level = v;   this.paramValues[`op${n}.level`]  = v; });
    mk('A',       0.001,  2, p.attack,  0.01, fmtSec,                        (v) => { p.attack = v;  this.paramValues[`op${n}.attack`] = v; });
    mk('D',       0.001,  2, p.decay,   0.3,  fmtSec,                        (v) => { p.decay = v;   this.paramValues[`op${n}.decay`]  = v; });
    mk('S',       0,      1, p.sustain, 0.7,  fmtPct,                        (v) => { p.sustain = v; });
    mk('R',       0.005,  4, p.release, 0.3,  fmtSec,                        (v) => { p.release = v; });
    row.appendChild(knobRow);
    return row;
  }

  dispose(): void {}
}

export const fmEngine = new FMEngine();
registerEngine(fmEngine);
registerEngineFactory('fm', () => new FMEngine());
