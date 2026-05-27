import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { createPeriodicWaves, WAVETABLES } from './wavetable-tables';
import type { KnobHandle } from '../core/knob';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import type { ModulatorVoice } from '../modulation/types';
import { recordVoiceMods } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { wireEngineParams } from './engine-ui';

const WAVE_OPTIONS = WAVETABLES.map((w, i) => ({ value: String(i), label: w.name }));

const WT_PARAMS: EngineParamSpec[] = [
  { id: 'osc.waveA',        label: 'Wave A',    kind: 'discrete', min: 0, max: WAVE_OPTIONS.length - 1, default: 2, options: WAVE_OPTIONS },
  { id: 'osc.waveB',        label: 'Wave B',    kind: 'discrete', min: 0, max: WAVE_OPTIONS.length - 1, default: 3, options: WAVE_OPTIONS },
  { id: 'osc.morph',        label: 'Morph',     kind: 'continuous', min: 0,    max: 1,  default: 0.0 },
  { id: 'osc.detune',       label: 'Detune',    kind: 'continuous', min: -50,  max: 50, default: 0, unit: '¢' },
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0,    max: 1,  default: 0.55 },
  { id: 'filter.resonance', label: 'Res',       kind: 'continuous', min: 0,    max: 1,  default: 0.2 },
  { id: 'amp.attack',       label: 'Attack',    kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', curve: 'exponential' },
  { id: 'amp.decay',        label: 'Decay',     kind: 'continuous', min: 0.001, max: 2, default: 0.3,  unit: 's', curve: 'exponential' },
  { id: 'amp.sustain',      label: 'Sustain',   kind: 'continuous', min: 0,    max: 1,  default: 0.7 },
  { id: 'amp.release',      label: 'Release',   kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's', curve: 'exponential' },
];

class WavetableVoice implements Voice {
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private gainA: GainNode;
  private gainB: GainNode;
  public readonly filter: BiquadFilterNode;
  public readonly ampGain: GainNode;
  private envAmp!: ConstantSourceNode;
  private envCutoff!: ConstantSourceNode;
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
    this.ampGain = ctx.createGain();

    // Internal envelope sources — modulators sum on top of these via the
    // destination AudioParams (ampGain.gain, filter.frequency).
    this.envAmp = ctx.createConstantSource();
    this.envAmp.offset.value = 0;
    this.envAmp.start();
    this.envAmp.connect(this.ampGain.gain);

    this.envCutoff = ctx.createConstantSource();
    this.envCutoff.offset.value = 0;
    this.envCutoff.start();
    this.envCutoff.connect(this.filter.frequency);

    this.ampGain.gain.value = 0;
    this.filter.frequency.value = 0;

    this.oscA.connect(this.gainA).connect(this.filter);
    this.oscB.connect(this.gainB).connect(this.filter);
    this.filter.connect(this.ampGain).connect(output);
  }

  getAudioParams(): Map<string, AudioParam> {
    return new Map<string, AudioParam>([
      ['amp.gain',         this.ampGain.gain],
      ['filter.cutoff',    this.filter.frequency],
      ['filter.resonance', this.filter.Q],
    ]);
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    // Fire modulator voices first so their AudioParam contributions land
    // before the oscillators start.
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
    }

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const velMul = options.accent ? 1.3 : 1.0;
    const morph = this.getParam('osc.morph');
    const detune = this.getParam('osc.detune');
    const cutoff = this.getParam('filter.cutoff');
    const res = this.getParam('filter.resonance');

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

    // Static cutoff base + Q. ADSR routed to filter.cutoff supplies envelope
    // motion; LFOs routed to filter.cutoff add wobble. Base value is written
    // onto envCutoff.offset so modulator sums stack cleanly on the destination.
    const baseHz = 60 * Math.pow(220, cutoff);
    this.filter.Q.setValueAtTime(0.5 + res * 20, time);
    this.envCutoff.offset.setValueAtTime(baseHz, time);

    // Amp base stays at 0; the modulator-driven amp envelope (or default ADSR
    // routed to amp.gain) supplies gating. envAmp.offset is the internal env
    // contribution slot — left at 0 here since wavetable's amp env is driven
    // entirely by the ADSR modulator on amp.gain.
    this.envAmp.offset.setValueAtTime(0, time);

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
    try { this.envAmp.stop(); } catch {}
    try { this.envCutoff.stop(); } catch {}
    this.oscA.disconnect();
    this.oscB.disconnect();
    this.filter.disconnect();
    this.ampGain.disconnect();
    this.envAmp.disconnect();
    this.envCutoff.disconnect();
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

export class WavetableEngine implements SynthEngine {
  readonly id = 'wavetable';
  readonly name = 'Wavetable';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly params = WT_PARAMS;
  readonly editor = 'piano-roll' as const;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  private waves: PeriodicWave[] = [];
  private paramValues: Record<string, number> = {};
  private waveAIndex = 2; // Sawtooth
  private waveBIndex = 3; // Square

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  private modHost = new ModulationHostImpl([
    {
      ...makeDefaultADSR('adsr1'),
      connections: [
        { id: 'c-amp',    paramId: 'amp.gain',      depth: 1.0 },
        { id: 'c-cutoff', paramId: 'filter.cutoff', depth: 0.5 },
      ],
    },
    makeDefaultLFO('lfo1'),
  ]);

  /** Persistence + cross-module access to modulator state. */
  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of WT_PARAMS) {
      this.paramValues[p.id] = p.default;
    }
  }

  getBaseValue(id: string): number {
    if (id === 'osc.waveA') return this.waveAIndex;
    if (id === 'osc.waveB') return this.waveBIndex;
    return this.paramValues[id] ?? WT_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id === 'osc.waveA') { this.setWaveA(Math.round(v)); return; }
    if (id === 'osc.waveB') { this.setWaveB(Math.round(v)); return; }
    this.paramValues[id] = v;
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [k, v] of Object.entries(preset.params)) this.paramValues[k] = v;
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  setWaveA(idx: number): void {
    this.waveAIndex = Math.max(0, Math.min(WAVETABLES.length - 1, idx));
  }

  setWaveB(idx: number): void {
    this.waveBIndex = Math.max(0, Math.min(WAVETABLES.length - 1, idx));
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
      (id) => this.getBaseValue(id),
      () => this.waveAIndex,
      () => this.waveBIndex,
      voiceMods,
    );
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
    this.paramValues['osc.morph']        = rnd(0.15, 0.85);
    this.paramValues['osc.detune']       = rnd(0, 20);
    this.paramValues['filter.cutoff']    = rnd(0.4, 0.95);
    this.paramValues['filter.resonance'] = rnd(0, 0.5);
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    const row = document.createElement('div');
    row.className = 'row poly-section';
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    row.appendChild(knobRow);
    container.appendChild(row);

    wireEngineParams(this, ctx, knobRow, {
      formatter: (id, v) => {
        if (id === 'osc.morph') return `${Math.round(v * 100)}%`;
        if (id === 'osc.detune') return `${v.toFixed(0)}¢`;
        if (id.startsWith('filter.')) return `${Math.round(v * 100)}%`;
        if (id.startsWith('amp.') && (id.endsWith('.attack') || id.endsWith('.decay') || id.endsWith('.release'))) {
          return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
        }
        return `${Math.round(v * 100)}%`;
      },
    });

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

  dispose(): void {
    this.waves = [];
  }
}

export const wavetableEngine = new WavetableEngine();
registerEngine(wavetableEngine);
registerEngineFactory('wavetable', () => new WavetableEngine());
