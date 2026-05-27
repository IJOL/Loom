// Karplus-Strong physical-modeling engine.
//
// Classic pluck: short noise burst injected into a delay line of length
// 1/freq seconds, with a low-pass filter in the feedback loop that gradually
// damps the high harmonics — the wave decays into a plucked-string timbre.
//
// Web Audio realization: noise BufferSource → DelayNode → BiquadFilter (LP)
// → GainNode (loop gain < 1) → back into the DelayNode. Output tapped after
// the delay so the user hears the resonance, not just the excitation.

import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, ParamDef, EngineUIContext } from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { createKnob, type KnobHandle } from '../core/knob';
import { ModulationHostImpl, bindVoiceModulation } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorVoice } from '../modulation/types';
import { renderModulatorsPanel } from '../modulation/modulation-ui';

const KARPLUS_PARAMS: ParamDef[] = [
  { id: 'ks-damping',    label: 'Damping',    min: 0,    max: 1, default: 0.5 },
  { id: 'ks-brightness', label: 'Brightness', min: 0,    max: 1, default: 0.65 },
  { id: 'ks-excite',     label: 'Excite',     min: 0.001,max: 0.1, default: 0.01, unit: 's' },
  { id: 'ks-noiseTone',  label: 'Noise Tone', min: 0,    max: 1, default: 0.5 },
  { id: 'ks-attack',     label: 'Attack',     min: 0.001,max: 0.5, default: 0.005, unit: 's' },
  { id: 'ks-release',    label: 'Release',    min: 0.05, max: 4, default: 0.5, unit: 's' },
  { id: 'ks-level',      label: 'Level',      min: 0,    max: 1, default: 0.8 },
];

class KarplusVoice implements Voice {
  private noise: AudioBufferSourceNode;
  private noiseGain: GainNode;
  private noiseFilter: BiquadFilterNode;
  private delay: DelayNode;
  private loopFilter: BiquadFilterNode;
  private loopGain: GainNode;
  private amp: GainNode;
  private disposed = false;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private getParam: (id: string) => number,
    private voiceMods: Map<string, ModulatorVoice>,
  ) {
    // Pre-generate a small burst of white noise; voice trims start/stop later.
    const burst = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = burst.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = burst;
    this.noise.loop = false;

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'lowpass';
    this.noiseFilter.frequency.value = 8000;

    this.delay = ctx.createDelay(0.1); // max ~10 Hz fundamental
    this.loopFilter = ctx.createBiquadFilter();
    this.loopFilter.type = 'lowpass';
    this.loopFilter.frequency.value = 6000;
    this.loopFilter.Q.value = 0.5;     // <1 to avoid resonance amplification in the loop
    this.loopGain = ctx.createGain();
    this.loopGain.gain.value = 0;      // stays at 0 until trigger sets it
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;

    // Excitation path: noise → noiseGain → noiseFilter → delay input
    this.noise.connect(this.noiseGain).connect(this.noiseFilter).connect(this.delay);
    // Feedback loop: delay → loopFilter → loopGain → delay (with implicit 1-sample delay)
    this.delay.connect(this.loopFilter).connect(this.loopGain).connect(this.delay);
    // Output: tap the delay output (post-filter is fine too)
    this.delay.connect(this.amp).connect(output);
  }

  /** Final amp gain — most musical destination for LFO/ADSR. */
  get ampParam(): AudioParam { return this.amp.gain; }
  /** Loop-filter cutoff — drives damping/cutoff wobble (classic Karplus mod). */
  get dampingParam(): AudioParam { return this.loopFilter.frequency; }
  /** Noise excitation pre-filter cutoff — color the attack burst. */
  get exciteToneParam(): AudioParam { return this.noiseFilter.frequency; }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    if (this.disposed) return;
    // Fire modulator voices first so their AudioParam contributions land
    // before the pluck excitation.
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
    }

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const velMul = options.accent ? 1.4 : 1.0;

    const damping    = this.getParam('ks-damping');     // 0..1, 0 = ringy, 1 = dead
    const brightness = this.getParam('ks-brightness');  // 0..1, loop LP cutoff scale
    const exciteDur  = Math.max(0.001, this.getParam('ks-excite'));
    const noiseTone  = this.getParam('ks-noiseTone');   // 0 = dark, 1 = bright
    const attack     = Math.max(0.001, this.getParam('ks-attack'));
    const release    = Math.max(0.05, this.getParam('ks-release'));
    const level      = this.getParam('ks-level');

    // Loop tuning: delay = 1/freq, plus 1-sample compensation handled by Web Audio
    const period = 1 / Math.max(20, freq);
    this.delay.delayTime.setValueAtTime(period, time);

    // Loop filter cutoff: enough headroom over the fundamental for body.
    const loopHz = Math.min(this.ctx.sampleRate * 0.45, freq * (3 + brightness * 15));
    this.loopFilter.frequency.setValueAtTime(loopHz, time);

    // Loop gain: SAFE range — 0.78 (very damped) to 0.93 (long sustain).
    // Above 0.95 the loop stacks across notes and sounds like feedback.
    const loopG = 0.78 + (1 - damping) * 0.15;   // 0.78 .. 0.93
    // Physical-string decay: even during a sustained note, the string loses
    // energy. Without this, holding a long gate makes the loop sit at peak
    // forever and any second trigger superimposes on top, sounding like
    // runaway feedback. Decay to ~70% of loopG over ~3 seconds.
    this.loopGain.gain.setValueAtTime(loopG, time);
    this.loopGain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, loopG * 0.7),
      time + 3,
    );

    // Noise tone: dark (200 Hz) → bright (12 kHz)
    const noiseHz = 200 * Math.pow(60, noiseTone);
    this.noiseFilter.frequency.setValueAtTime(noiseHz, time);

    // Excitation envelope (short burst with quick decay). Scaled below 1 so the
    // delay doesn't get loaded with a huge initial impulse that takes seconds
    // to damp out even after loopGain decay.
    const exciteAmp = 1.0 * velMul;
    this.noiseGain.gain.setValueAtTime(0, time);
    this.noiseGain.gain.linearRampToValueAtTime(exciteAmp, time + 0.0005);
    this.noiseGain.gain.setValueAtTime(exciteAmp, time + exciteDur);
    this.noiseGain.gain.linearRampToValueAtTime(0, time + exciteDur + 0.001);

    // Amp envelope. Karplus output (delay tap) is quieter than osc-based
    // engines so we scale generously here — multiple voices can still mix
    // without clipping because the loop now decays naturally.
    const peakAmp = 1.4 * level * velMul;
    this.amp.gain.setValueAtTime(0, time);
    this.amp.gain.linearRampToValueAtTime(peakAmp, time + attack);

    // Release: ramp BOTH amp and loopGain to zero, so the internal loop dies
    // instead of ringing silently and accumulating across rapid notes.
    const releaseStart = time + options.gateDuration;
    this.amp.gain.cancelScheduledValues(releaseStart);
    this.amp.gain.setValueAtTime(peakAmp, releaseStart);
    this.amp.gain.exponentialRampToValueAtTime(0.0001, releaseStart + release);
    // Fast kill of the internal loop at release — under 200 ms regardless of
    // release length, so the string can't keep echoing under the muted amp
    // and accumulate with subsequent notes.
    this.loopGain.gain.cancelScheduledValues(releaseStart);
    this.loopGain.gain.setValueAtTime(0.001 + (loopG * 0.7), releaseStart);
    this.loopGain.gain.linearRampToValueAtTime(0, releaseStart + Math.min(0.2, release));

    const stopTime = releaseStart + release + 0.1;
    this.noise.start(time);
    this.noise.stop(time + Math.min(1, exciteDur + 0.05));
    // Schedule disposal via setTimeout (engines are voices-per-trigger; cleanup
    // prevents leaking AudioNodes that never get garbage-collected).
    const delayMs = Math.max(0, (stopTime - this.ctx.currentTime) * 1000);
    setTimeout(() => this.dispose(), delayMs);
  }

  release(time: number): void {
    for (const mv of this.voiceMods.values()) mv.release(time);
  }
  connect(_dest: AudioNode): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.noise.stop(); } catch {}
    this.noise.disconnect();
    this.noiseGain.disconnect();
    this.noiseFilter.disconnect();
    this.delay.disconnect();
    this.loopFilter.disconnect();
    this.loopGain.disconnect();
    this.amp.disconnect();
    for (const mv of this.voiceMods.values()) mv.dispose();
  }
}

class KarplusSequencer implements EngineSequencer {
  getStepAt(_i: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_s: number): void {}
  serialize(): unknown { return null; }
  deserialize(_d: unknown): void {}
  dispose(): void {}
}

class KarplusEngine implements SynthEngine {
  readonly id = 'karplus';
  readonly name = 'Karplus (Physical)';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly presets: import('./engine-types').EnginePreset[] = [];
  readonly params = KARPLUS_PARAMS;

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  private modHost = new ModulationHostImpl([
    makeDefaultLFO('lfo1'),
    makeDefaultADSR('adsr1'),
  ]);

  /** Persistence + cross-module access to modulator state. */
  get modulators(): ModulationHostImpl { return this.modHost; }

  private paramValues: Record<string, number> = {};
  private uiCtx?: EngineUIContext;

  constructor() {
    for (const p of KARPLUS_PARAMS) this.paramValues[p.id] = p.default;
  }

  setParam(id: string, value: number): void { this.paramValues[id] = value; }
  getParam(id: string): number { return this.paramValues[id] ?? 0; }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [k, v] of Object.entries(preset.params)) this.paramValues[k] = v;
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    const voiceMods = this.modHost.spawnVoice(ctx, () => this.bpm);
    const voice = new KarplusVoice(ctx, output, (id) => this.getParam(id), voiceMods);
    const voiceParamMap: Record<string, AudioParam> = {
      'ks-amp':       voice.ampParam,
      'ks-loop-cut':  voice.dampingParam,
      'ks-excite-cut': voice.exciteToneParam,
    };
    const paramRanges: Record<string, { min: number; max: number }> = {
      'ks-amp':        { min: 0,   max: 1     },
      'ks-loop-cut':   { min: 100, max: 12000 },
      'ks-excite-cut': { min: 100, max: 12000 },
    };
    bindVoiceModulation(voiceMods, this.modHost.modulators, voiceParamMap, paramRanges, ctx);
    return voice;
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new KarplusSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    this.uiCtx = ctx;

    container.appendChild(this.buildStringSection());
    container.appendChild(this.buildExciteSection());
    container.appendChild(this.buildAmpSection());

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

  randomize(): void {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    this.paramValues['ks-damping']    = rnd(0.05, 0.55);   // mostly ringy
    this.paramValues['ks-brightness'] = rnd(0.3, 0.9);
    this.paramValues['ks-excite']     = rnd(0.002, 0.03);
    this.paramValues['ks-noiseTone']  = rnd(0.2, 0.85);
    this.paramValues['ks-attack']     = rnd(0.001, 0.02);
    this.paramValues['ks-release']    = rnd(0.3, 2.5);
    this.paramValues['ks-level']      = rnd(0.6, 0.9);
  }

  private buildStringSection(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row poly-section';
    const lab = document.createElement('div');
    lab.className = 'section-label';
    lab.textContent = 'STRING';
    row.appendChild(lab);
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    knobRow.appendChild(this.makeKnob('ks-damping',    (v) => `${Math.round(v * 100)}%`));
    knobRow.appendChild(this.makeKnob('ks-brightness', (v) => `${Math.round(v * 100)}%`));
    row.appendChild(knobRow);
    return row;
  }

  private buildExciteSection(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row poly-section';
    const lab = document.createElement('div');
    lab.className = 'section-label';
    lab.textContent = 'EXCITE';
    row.appendChild(lab);
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    knobRow.appendChild(this.makeKnob('ks-excite',    (v) => `${Math.round(v * 1000)}ms`));
    knobRow.appendChild(this.makeKnob('ks-noiseTone', (v) => `${Math.round(v * 100)}%`));
    row.appendChild(knobRow);
    return row;
  }

  private buildAmpSection(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row poly-section';
    const lab = document.createElement('div');
    lab.className = 'section-label';
    lab.textContent = 'AMP';
    row.appendChild(lab);
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    knobRow.appendChild(this.makeKnob('ks-attack',  (v) => `${Math.round(v * 1000)}ms`));
    knobRow.appendChild(this.makeKnob('ks-release', (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`));
    knobRow.appendChild(this.makeKnob('ks-level',   (v) => `${Math.round(v * 100)}%`));
    row.appendChild(knobRow);
    return row;
  }

  private makeKnob(id: string, format: (v: number) => string): HTMLElement {
    const p = KARPLUS_PARAMS.find((x) => x.id === id)!;
    const fullId = this.uiCtx?.idPrefix ? `${this.uiCtx.idPrefix}.${id}` : undefined;
    const k = createKnob({
      id: fullId,
      label: p.label,
      min: p.min, max: p.max,
      value: this.getParam(id),
      defaultValue: p.default,
      format,
      onChange: (v) => this.setParam(id, v),
    });
    this.uiCtx?.registerKnob(k);
    return k.el;
  }

  dispose(): void {}
}

export const karplusEngine = new KarplusEngine();
registerEngine(karplusEngine);
registerEngineFactory('karplus', () => new KarplusEngine());
