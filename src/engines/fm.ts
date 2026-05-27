// 4-operator FM engine (DX7-style, simplified).
// Each operator: sine oscillator + ADSR envelope + output level.
// 4 algorithms covering common topologies (serial, parallel mods, two pairs, all-additive).
// Op4 self-feedback.

import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, ParamDef, EngineUIContext } from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { createKnob, type KnobHandle } from '../core/knob';
import { ModulationHostImpl, bindVoiceModulation } from '../modulation/modulation-host';
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

class FMVoice implements Voice {
  private osc: OscillatorNode[] = [];
  private envGain: GainNode[] = [];
  private outGain: GainNode[] = [];
  private finalMix: GainNode;
  private fbGain: GainNode | null = null;
  private fbDelay: DelayNode | null = null;

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

  /** Final-mix output gain — useful destination for amp-style modulation. */
  get mixGainParam(): AudioParam { return this.finalMix.gain; }
  /** Op1 output level — useful destination for tremolo/level-mod on the main carrier. */
  get op1LevelParam(): AudioParam { return this.outGain[0].gain; }
  /** Op2 output level — useful destination for modulation-index wobble in serial/parallel algos. */
  get op2LevelParam(): AudioParam { return this.outGain[1].gain; }
  /** Op1 oscillator detune — useful destination for pitch vibrato. */
  get op1DetuneParam(): AudioParam { return this.osc[0].detune; }

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
      this.envGain[i].gain.setValueAtTime(0, time);
      this.envGain[i].gain.linearRampToValueAtTime(1, time + a);
      this.envGain[i].gain.linearRampToValueAtTime(sus, time + a + d);

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
      this.envGain[i].gain.setValueAtTime(sus, gateEnd);
      this.envGain[i].gain.exponentialRampToValueAtTime(0.0001, gateEnd + r);
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

class FMEngine implements SynthEngine {
  readonly id = 'fm';
  readonly name = 'FM (4-op)';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly params: ParamDef[] = [];
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

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  private algorithmIndex = 0;
  private feedback = 0;
  private opParams: OpParams[] = [
    { ...OP_DEFAULTS, ratio: 1, level: 0.9 },
    { ...OP_DEFAULTS, ratio: 2, level: 0.5 },
    { ...OP_DEFAULTS, ratio: 3, level: 0.4 },
    { ...OP_DEFAULTS, ratio: 1, level: 0.6 },
  ];

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
    const voiceParamMap: Record<string, AudioParam> = {
      'fm-mix':      voice.mixGainParam,
      'fm-op1-level': voice.op1LevelParam,
      'fm-op2-level': voice.op2LevelParam,
      'fm-op1-detune': voice.op1DetuneParam,
    };
    const paramRanges: Record<string, { min: number; max: number }> = {
      'fm-mix':       { min: 0,    max: 1    },
      'fm-op1-level': { min: 0,    max: 1    },
      'fm-op2-level': { min: 0,    max: 1    },
      'fm-op1-detune':{ min: -100, max: 100  },
    };
    bindVoiceModulation(voiceMods, this.modHost.modulators, voiceParamMap, paramRanges, ctx);
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
    const fbId = this.uiCtx?.idPrefix ? `${this.uiCtx.idPrefix}.fm-feedback` : undefined;
    const k = createKnob({
      id: fbId,
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

    const mk = (paramId: string, label: string, min: number, max: number, val: number, def: number, fmt: (v: number) => string, set: (v: number) => void) => {
      const fullId = this.uiCtx?.idPrefix ? `${this.uiCtx.idPrefix}.fm-op${idx}-${paramId}` : undefined;
      const k = createKnob({ id: fullId, label, min, max, value: val, defaultValue: def, format: fmt, onChange: set });
      this.uiCtx?.registerKnob(k);
      knobRow.appendChild(k.el);
    };

    mk('ratio',   'Ratio',   0.1,   16, p.ratio,   1,    (v) => v.toFixed(2),               (v) => { p.ratio = v; });
    mk('detune',  'Detune', -50,    50, p.detune,  0,    (v) => `${v.toFixed(0)}¢`,         (v) => { p.detune = v; });
    mk('level',   'Level',   0,      1, p.level,   0.5,  fmtPct,                            (v) => { p.level = v; });
    mk('a',       'A',       0.001,  2, p.attack,  0.01, fmtSec,                            (v) => { p.attack = v; });
    mk('d',       'D',       0.001,  2, p.decay,   0.3,  fmtSec,                            (v) => { p.decay = v; });
    mk('s',       'S',       0,      1, p.sustain, 0.7,  fmtPct,                            (v) => { p.sustain = v; });
    mk('r',       'R',       0.005,  4, p.release, 0.3,  fmtSec,                            (v) => { p.release = v; });
    row.appendChild(knobRow);
    return row;
  }

  dispose(): void {}
}

export const fmEngine = new FMEngine();
registerEngine(fmEngine);
registerEngineFactory('fm', () => new FMEngine());
