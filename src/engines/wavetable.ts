import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, ParamDef, EngineUIContext } from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { createPeriodicWaves, WAVETABLES } from './wavetable-tables';
import { createKnob } from '../core/knob';

const WAVETABLE_PARAMS: ParamDef[] = [
  { id: 'wt-morph',        label: 'Morph',     min: 0,     max: 1, default: 0.5 },
  { id: 'wt-detune',       label: 'Detune',    min: 0,     max: 50, default: 0, unit: '¢' },
  { id: 'wt-attack',       label: 'Attack',    min: 0.001, max: 2, default: 0.01, curve: 'exponential', unit: 's' },
  { id: 'wt-decay',        label: 'Decay',     min: 0.001, max: 2, default: 0.3,  curve: 'exponential', unit: 's' },
  { id: 'wt-sustain',      label: 'Sustain',   min: 0,     max: 1, default: 0.7 },
  { id: 'wt-release',      label: 'Release',   min: 0.005, max: 4, default: 0.3,  curve: 'exponential', unit: 's' },
  { id: 'wt-filterCutoff', label: 'Cutoff',    min: 0,     max: 1, default: 0.8 },
  { id: 'wt-filterRes',    label: 'Resonance', min: 0,     max: 1, default: 0.1 },
  { id: 'wt-filterEnv',    label: 'Filt Env',  min: 0,     max: 1, default: 0.3 },
];

class WavetableVoice implements Voice {
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private gainA: GainNode;
  private gainB: GainNode;
  private filter: BiquadFilterNode;
  private amp: GainNode;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private waves: PeriodicWave[],
    private getParam: (id: string) => number,
    private getWaveAIndex: () => number,
    private getWaveBIndex: () => number,
  ) {
    this.oscA = ctx.createOscillator();
    this.oscB = ctx.createOscillator();
    this.gainA = ctx.createGain();
    this.gainB = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;

    this.oscA.connect(this.gainA).connect(this.filter);
    this.oscB.connect(this.gainB).connect(this.filter);
    this.filter.connect(this.amp).connect(output);
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const velMul = options.accent ? 1.3 : 1.0;
    const morph = this.getParam('wt-morph');
    const detune = this.getParam('wt-detune');
    const attack = Math.max(0.001, this.getParam('wt-attack'));
    const decay = Math.max(0.001, this.getParam('wt-decay'));
    const sustain = this.getParam('wt-sustain');
    const release = Math.max(0.005, this.getParam('wt-release'));
    const cutoff = this.getParam('wt-filterCutoff');
    const res = this.getParam('wt-filterRes');
    const filterEnv = this.getParam('wt-filterEnv');

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

    const baseHz = 60 * Math.pow(220, cutoff);
    const peakHz = Math.min(baseHz * Math.pow(8, filterEnv * velMul), 18000);
    const sustainHz = Math.max(40, baseHz + (peakHz - baseHz) * sustain);
    this.filter.Q.setValueAtTime(0.5 + res * 20, time);
    this.filter.frequency.setValueAtTime(baseHz, time);
    this.filter.frequency.linearRampToValueAtTime(peakHz, time + attack);
    this.filter.frequency.exponentialRampToValueAtTime(sustainHz, time + attack + decay);

    const peakAmp = 0.35 * velMul;
    const sustainAmp = Math.max(0.0001, peakAmp * sustain);
    this.amp.gain.setValueAtTime(0, time);
    this.amp.gain.linearRampToValueAtTime(peakAmp, time + attack);
    this.amp.gain.linearRampToValueAtTime(sustainAmp, time + attack + decay);

    const releaseStart = Math.max(time + attack + decay, time + options.gateDuration);
    this.amp.gain.setValueAtTime(sustainAmp, releaseStart);
    this.amp.gain.exponentialRampToValueAtTime(0.001, releaseStart + release);
    this.filter.frequency.setValueAtTime(sustainHz, releaseStart);
    this.filter.frequency.exponentialRampToValueAtTime(Math.max(baseHz, 40), releaseStart + release);

    const stopTime = releaseStart + release + 0.05;
    this.oscA.start(time);
    this.oscB.start(time);
    this.oscA.stop(stopTime);
    this.oscB.stop(stopTime);
  }

  release(_time: number): void {}
  connect(_dest: AudioNode): void {}

  dispose(): void {
    try { this.oscA.stop(); } catch {}
    try { this.oscB.stop(); } catch {}
    this.oscA.disconnect();
    this.oscB.disconnect();
    this.filter.disconnect();
    this.amp.disconnect();
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

  applyPreset(_name: string): void {}

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
    return new WavetableVoice(
      ctx,
      output,
      this.waves,
      (id) => this.getParam(id),
      () => this.waveAIndex,
      () => this.waveBIndex,
    );
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
    this.paramValues['wt-attack']       = rnd(0.005, 0.2);
    this.paramValues['wt-decay']        = rnd(0.05, 0.8);
    this.paramValues['wt-sustain']      = rnd(0.3, 0.9);
    this.paramValues['wt-release']      = rnd(0.05, 1.2);
    this.paramValues['wt-filterCutoff'] = rnd(0.4, 0.95);
    this.paramValues['wt-filterRes']    = rnd(0, 0.5);
    this.paramValues['wt-filterEnv']    = rnd(0, 0.6);
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    this.waveSelectListeners = [];
    this.uiCtx = ctx;

    container.appendChild(this.buildWavesSection());
    container.appendChild(this.buildAmpSection());
    container.appendChild(this.buildFilterSection());
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

  private buildAmpSection(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row poly-section';

    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = 'AMP ENV';
    row.appendChild(label);

    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    knobRow.appendChild(this.makeKnob('wt-attack',  (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`));
    knobRow.appendChild(this.makeKnob('wt-decay',   (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`));
    knobRow.appendChild(this.makeKnob('wt-sustain', (v) => `${Math.round(v * 100)}%`));
    knobRow.appendChild(this.makeKnob('wt-release', (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`));
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
    knobRow.appendChild(this.makeKnob('wt-filterEnv',    (v) => `${Math.round(v * 100)}%`));
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
