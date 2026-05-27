import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, ParamDef, EngineUIContext } from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { createPeriodicWaves, WAVETABLES } from './wavetable-tables';
import { createKnob, type KnobHandle } from '../core/knob';
import { ModulationHostImpl, bindVoiceModulation } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import type { ModulatorVoice } from '../modulation/types';
import { recordVoiceMods } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';

const WAVETABLE_PARAMS: ParamDef[] = [
  { id: 'wt-morph',        label: 'Morph',     min: 0,     max: 1, default: 0.5 },
  { id: 'wt-detune',       label: 'Detune',    min: 0,     max: 50, default: 0, unit: '¢' },
  { id: 'wt-filterCutoff', label: 'Cutoff',    min: 0,     max: 1, default: 0.8 },
  { id: 'wt-filterRes',    label: 'Resonance', min: 0,     max: 1, default: 0.1 },
];

class WavetableVoice implements Voice {
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private gainA: GainNode;
  private gainB: GainNode;
  private filter: BiquadFilterNode;
  private amp: GainNode;
  private started = false;
  private stopScheduled = false;

  constructor(
    ctx: AudioContext,
    output: AudioNode,
    private waves: PeriodicWave[],
    private getParam: (id: string) => number,
    private getWaveAIndex: () => number,
    private getWaveBIndex: () => number,
    private voiceMods: Map<string, ModulatorVoice>,
  ) {
    this.oscA = ctx.createOscillator();
    this.oscB = ctx.createOscillator();
    this.gainA = ctx.createGain();
    this.gainB = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.amp = ctx.createGain();
    // Base value 0 — ADSR sums in via Web Audio param summing.
    this.amp.gain.value = 0;

    this.oscA.connect(this.gainA).connect(this.filter);
    this.oscB.connect(this.gainB).connect(this.filter);
    this.filter.connect(this.amp).connect(output);
  }

  // Exposed so the engine can build the voiceParamMap before bind.
  get ampParam(): AudioParam { return this.amp.gain; }
  get cutoffParam(): AudioParam { return this.filter.frequency; }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    // Fire modulator voices first so their AudioParam contributions land
    // before the oscillators start.
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
    }

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const velMul = options.accent ? 1.3 : 1.0;
    const morph = this.getParam('wt-morph');
    const detune = this.getParam('wt-detune');
    const cutoff = this.getParam('wt-filterCutoff');
    const res = this.getParam('wt-filterRes');

    const aIdx = Math.max(0, Math.min(this.waves.length - 1, this.getWaveAIndex()));
    const bIdx = Math.max(0, Math.min(this.waves.length - 1, this.getWaveBIndex()));
    this.oscA.setPeriodicWave(this.waves[aIdx]);
    this.oscB.setPeriodicWave(this.waves[bIdx]);

    this.oscA.frequency.setValueAtTime(freq, time);
    this.oscB.frequency.setValueAtTime(freq, time);
    this.oscA.detune.setValueAtTime(-detune, time);
    this.oscB.detune.setValueAtTime(detune, time);

    // Equal-power crossfade so total energy stays roughly constant across morph
    const gA = Math.cos(morph * Math.PI * 0.5) * velMul;
    const gB = Math.sin(morph * Math.PI * 0.5) * velMul;
    this.gainA.gain.setValueAtTime(gA, time);
    this.gainB.gain.setValueAtTime(gB, time);

    // Static cutoff base + Q. ADSR routed to wt-cutoff supplies envelope motion;
    // LFOs routed to wt-cutoff (via UI) add wobble.
    const baseHz = 60 * Math.pow(220, cutoff);
    this.filter.Q.setValueAtTime(0.5 + res * 20, time);
    // Note: setting the base value, not scheduling a sweep.
    this.filter.frequency.setValueAtTime(baseHz, time);

    if (!this.started) {
      this.oscA.start(time);
      this.oscB.start(time);
      this.started = true;
    }
  }

  release(_time: number): void {
    for (const mv of this.voiceMods.values()) mv.release(_time);
  }

  connect(_dest: AudioNode): void {}

  dispose(): void {
    if (!this.stopScheduled && this.started) {
      try { this.oscA.stop(); } catch {}
      try { this.oscB.stop(); } catch {}
      this.stopScheduled = true;
    }
    this.oscA.disconnect();
    this.oscB.disconnect();
    this.filter.disconnect();
    this.amp.disconnect();
    for (const mv of this.voiceMods.values()) mv.dispose();
  }
}

class WavetableSequencer implements EngineSequencer {
  getStepAt(_index: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_step: number): void {}
  serialize(): unknown { return null; }
  deserialize(_data: unknown): void {}
  dispose(): void {}
}

class WavetableEngine implements SynthEngine {
  readonly id = 'wavetable';
  readonly name = 'Wavetable';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly params = WAVETABLE_PARAMS;
  readonly editor = 'piano-roll' as const;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  private waves: PeriodicWave[] = [];
  private paramValues: Record<string, number> = {};
  private waveAIndex = 2; // Sawtooth
  private waveBIndex = 3; // Square
  private waveSelectListeners: Array<() => void> = [];

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  private modHost = new ModulationHostImpl([
    {
      ...makeDefaultADSR('adsr1'),
      connections: [
        { id: 'c-amp',    paramId: 'wt-amp',    depth: 1.0 },
        { id: 'c-cutoff', paramId: 'wt-cutoff', depth: 0.5 },
      ],
    },
    makeDefaultLFO('lfo1'),
  ]);

  /** Persistence + cross-module access to modulator state. */
  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of WAVETABLE_PARAMS) {
      this.paramValues[p.id] = p.default;
    }
  }

  setParam(id: string, value: number): void {
    this.paramValues[id] = value;
  }

  getParam(id: string): number {
    return this.paramValues[id] ?? 0;
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [k, v] of Object.entries(preset.params)) this.paramValues[k] = v;
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  setWaveA(idx: number): void {
    this.waveAIndex = Math.max(0, Math.min(WAVETABLES.length - 1, idx));
    this.waveSelectListeners.forEach((fn) => fn());
  }

  setWaveB(idx: number): void {
    this.waveBIndex = Math.max(0, Math.min(WAVETABLES.length - 1, idx));
    this.waveSelectListeners.forEach((fn) => fn());
  }

  getWaveA(): number { return this.waveAIndex; }
  getWaveB(): number { return this.waveBIndex; }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (this.waves.length === 0) {
      this.waves = createPeriodicWaves(ctx);
    }
    const voiceMods = this.modHost.spawnVoice(ctx, () => this.bpm);
    const voice = new WavetableVoice(
      ctx,
      output,
      this.waves,
      (id) => this.getParam(id),
      () => this.waveAIndex,
      () => this.waveBIndex,
      voiceMods,
    );
    const voiceParamMap: Record<string, AudioParam> = {
      'wt-amp':    voice.ampParam,
      'wt-cutoff': voice.cutoffParam,
    };
    const paramRanges: Record<string, { min: number; max: number }> = {
      'wt-amp':    { min: 0, max: 1 },
      'wt-cutoff': { min: 20, max: 12000 },
    };
    bindVoiceModulation(voiceMods, this.modHost.modulators, voiceParamMap, paramRanges, ctx);
    recordVoiceMods(voiceMods);
    return voice;
  }

  buildSequencer(_container: HTMLElement, _stepCount: number): EngineSequencer {
    return new WavetableSequencer();
  }

  randomize(): void {
    const rnd = (min: number, max: number) => min + Math.random() * (max - min);
    // Pick two different waves to morph between
    const n = WAVETABLES.length;
    const a = Math.floor(Math.random() * n);
    let b = Math.floor(Math.random() * n);
    if (b === a) b = (b + 1) % n;
    this.waveAIndex = a;
    this.waveBIndex = b;
    // Musically-useful ranges (avoid extremes that produce silence/harshness)
    this.paramValues['wt-morph']        = rnd(0.15, 0.85);
    this.paramValues['wt-detune']       = rnd(0, 20);
    this.paramValues['wt-filterCutoff'] = rnd(0.4, 0.95);
    this.paramValues['wt-filterRes']    = rnd(0, 0.5);
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    this.waveSelectListeners = [];
    this.uiCtx = ctx;

    container.appendChild(this.buildWavesSection());
    container.appendChild(this.buildFilterSection());

    if (ctx) {
      renderModulatorsPanel(container, {
        engineId: this.id,
        laneId: ctx.laneId,
        extraPrefixes: ['wt'],
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

  private buildWavesSection(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row poly-section';

    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = 'WAVES';
    row.appendChild(label);

    // Wave A selector
    const waveAWrap = document.createElement('label');
    waveAWrap.className = 'inline';
    waveAWrap.textContent = 'Wave A ';
    const waveASel = document.createElement('select');
    WAVETABLES.forEach((w, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = w.name;
      if (i === this.waveAIndex) opt.selected = true;
      waveASel.appendChild(opt);
    });
    waveASel.addEventListener('change', () => this.setWaveA(parseInt(waveASel.value, 10)));
    waveAWrap.appendChild(waveASel);
    row.appendChild(waveAWrap);

    // Wave B selector
    const waveBWrap = document.createElement('label');
    waveBWrap.className = 'inline';
    waveBWrap.textContent = 'Wave B ';
    const waveBSel = document.createElement('select');
    WAVETABLES.forEach((w, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = w.name;
      if (i === this.waveBIndex) opt.selected = true;
      waveBSel.appendChild(opt);
    });
    waveBSel.addEventListener('change', () => this.setWaveB(parseInt(waveBSel.value, 10)));
    waveBWrap.appendChild(waveBSel);
    row.appendChild(waveBWrap);

    // Morph + Detune knobs
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    knobRow.appendChild(this.makeKnob('wt-morph', (v) => `A↔B ${Math.round(v * 100)}%`));
    knobRow.appendChild(this.makeKnob('wt-detune', (v) => `${v.toFixed(0)}¢`));
    row.appendChild(knobRow);

    return row;
  }

  private buildFilterSection(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row poly-section';

    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = 'FILTER';
    row.appendChild(label);

    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    knobRow.appendChild(this.makeKnob('wt-filterCutoff', (v) => `${Math.round(v * 100)}%`));
    knobRow.appendChild(this.makeKnob('wt-filterRes',    (v) => `${Math.round(v * 100)}%`));
    row.appendChild(knobRow);

    return row;
  }

  private makeKnob(id: string, format: (v: number) => string): HTMLElement {
    const p = WAVETABLE_PARAMS.find((x) => x.id === id)!;
    const fullId = this.uiCtx?.idPrefix ? `${this.uiCtx.idPrefix}.${id}` : undefined;
    const k = createKnob({
      id: fullId,
      label: p.label,
      min: p.min,
      max: p.max,
      value: this.getParam(id),
      defaultValue: p.default,
      format,
      onChange: (v) => this.setParam(id, v),
    });
    this.uiCtx?.registerKnob(k);
    return k.el;
  }

  dispose(): void {
    this.waves = [];
    this.waveSelectListeners = [];
  }
}

export const wavetableEngine = new WavetableEngine();
registerEngine(wavetableEngine);
registerEngineFactory('wavetable', () => new WavetableEngine());
