// Karplus-Strong physical-modeling engine.
//
// Classic pluck: short noise burst injected into a delay line of length
// 1/freq seconds, with a low-pass filter in the feedback loop that gradually
// damps the high harmonics — the wave decays into a plucked-string timbre.
//
// Web Audio realization: noise BufferSource → DelayNode → BiquadFilter (LP)
// → GainNode (loop gain < 1) → back into the DelayNode. Output tapped after
// the delay so the user hears the resonance, not just the excitation.

import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import type { KnobHandle } from '../core/knob';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorVoice } from '../modulation/types';
import { recordVoiceMods, getCurrentLaneForVoice } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations } from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import { wireEngineParams } from './engine-ui';

// Unified-param schema. Dot-namespaced ids that map consistently between
// knob layer and voice AudioParam destinations (no more ks-* split between
// the knob layer and per-voice param map).
const KARPLUS_PARAMS: EngineParamSpec[] = [
  // String resonator
  { id: 'string.damping',    label: 'Damping',    kind: 'continuous', min: 0,     max: 1,   default: 0.5 },
  { id: 'string.brightness', label: 'Brightness', kind: 'continuous', min: 0,     max: 1,   default: 0.65 },
  // Excitation burst
  { id: 'excite.time',       label: 'Excite',     kind: 'continuous', min: 0.001, max: 0.1, default: 0.01, unit: 's' },
  { id: 'excite.tone',       label: 'Noise Tone', kind: 'continuous', min: 0,     max: 1,   default: 0.5 },
  // Amp envelope
  { id: 'amp.attack',        label: 'Attack',     kind: 'continuous', min: 0.001, max: 0.5, default: 0.005, unit: 's' },
  { id: 'amp.release',       label: 'Release',    kind: 'continuous', min: 0.05,  max: 4,   default: 0.5,   unit: 's' },
  { id: 'amp.level',         label: 'Level',      kind: 'continuous', min: 0,     max: 1,   default: 0.8 },
];

class KarplusVoice implements Voice {
  private noise: AudioBufferSourceNode;
  private noiseGain: GainNode;
  public readonly noiseFilter: BiquadFilterNode;
  private delay: DelayNode;
  public readonly loopFilter: BiquadFilterNode;
  private loopGain: GainNode;
  public readonly amp: GainNode;
  private envAmp!: ConstantSourceNode;
  private disposed = false;

  /** Set by KarplusEngine.createVoice for dispose-time cleanup. */
  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

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

    // Internal amp envelope source. Per-note envelope writes to envAmp.offset,
    // and external modulators sum on top via getAudioParams().get('amp.level').
    this.envAmp = ctx.createConstantSource();
    this.envAmp.offset.value = 0;
    this.envAmp.start();
    this.envAmp.connect(this.amp.gain);

    // Excitation path: noise → noiseGain → noiseFilter → delay input
    this.noise.connect(this.noiseGain).connect(this.noiseFilter).connect(this.delay);
    // Feedback loop: delay → loopFilter → loopGain → delay (with implicit 1-sample delay)
    this.delay.connect(this.loopFilter).connect(this.loopGain).connect(this.delay);
    // Output: tap the delay output (post-filter is fine too)
    this.delay.connect(this.amp).connect(output);
  }

  getAudioParams(): Map<string, AudioParam> {
    const m = new Map<string, AudioParam>();
    m.set('amp.level', this.amp.gain);
    m.set('string.damping', this.loopFilter.frequency);
    m.set('excite.tone', this.noiseFilter.frequency);
    return m;
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    if (this.disposed) return;
    // Fire modulator voices first so their AudioParam contributions land
    // before the pluck excitation.
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
    }

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const velMul = options.accent ? 1.4 : 1.0;

    const damping    = this.getParam('string.damping');     // 0..1, 0 = ringy, 1 = dead
    const brightness = this.getParam('string.brightness');  // 0..1, loop LP cutoff scale
    const exciteDur  = Math.max(0.001, this.getParam('excite.time'));
    const noiseTone  = this.getParam('excite.tone');        // 0 = dark, 1 = bright
    const attack     = Math.max(0.001, this.getParam('amp.attack'));
    const release    = Math.max(0.05, this.getParam('amp.release'));
    const level      = this.getParam('amp.level');

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

    // Amp envelope on the internal ConstantSource — modulators on amp.level
    // sum into this same destination via getAudioParams().
    const peakAmp = 1.4 * level * velMul;
    this.envAmp.offset.cancelScheduledValues(time);
    this.envAmp.offset.setValueAtTime(0, time);
    this.envAmp.offset.linearRampToValueAtTime(peakAmp, time + attack);

    // Release: ramp BOTH amp env and loopGain to zero, so the internal loop
    // dies instead of ringing silently and accumulating across rapid notes.
    const releaseStart = time + options.gateDuration;
    this.envAmp.offset.cancelScheduledValues(releaseStart);
    this.envAmp.offset.setValueAtTime(peakAmp, releaseStart);
    this.envAmp.offset.exponentialRampToValueAtTime(0.0001, releaseStart + release);
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
    if (this.disposed) return;
    // Cancel pending envelopes and fade out the carrier + feedback loop.
    // cancelAndHoldAtTime snapshots the current value at `time` (handles
    // mid-ramp correctly — unlike reading param.value, which is unreliable
    // when automation is in flight). Then ramp linearly to 0 over 5 ms for
    // a quick perceptual gate cut.
    const RELEASE_S = 0.005;
    this.envAmp.offset.cancelAndHoldAtTime(time);
    this.envAmp.offset.linearRampToValueAtTime(0, time + RELEASE_S);
    this.loopGain.gain.cancelAndHoldAtTime(time);
    this.loopGain.gain.linearRampToValueAtTime(0, time + RELEASE_S);
    for (const mv of this.voiceMods.values()) mv.release(time);
  }
  connect(_dest: AudioNode): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
    try { this.noise.stop(); } catch {}
    try { this.envAmp.stop(); } catch {}
    this.noise.disconnect();
    this.noiseGain.disconnect();
    this.noiseFilter.disconnect();
    this.delay.disconnect();
    this.loopFilter.disconnect();
    this.loopGain.disconnect();
    this.amp.disconnect();
    this.envAmp.disconnect();
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

export class KarplusEngine implements SynthEngine {
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

  constructor() {
    for (const p of KARPLUS_PARAMS) this.paramValues[p.id] = p.default;
  }

  getBaseValue(id: string): number {
    return this.paramValues[id] ?? KARPLUS_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    this.paramValues[id] = v;
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [k, v] of Object.entries(preset.params)) this.paramValues[k] = v;
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  /** Cached so the modulation-panel onChange callback can re-apply bindings. */
  private currentLaneId: string | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    const voiceMods = this.modHost.spawnVoice(ctx, () => this.bpm);
    const voice = new KarplusVoice(ctx, output, (id) => this.getBaseValue(id), voiceMods);
    recordVoiceMods(voiceMods);
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      voice.binder = bindVoiceModulators({ laneId, engine: this, voice, voiceMods, ctx });
      this.currentLaneId = laneId;
    }
    return voice;
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new KarplusSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    const fmt = (id: string, v: number): string => {
      if (id === 'amp.release') return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
      if (id === 'excite.time' || id === 'amp.attack') return `${Math.round(v * 1000)}ms`;
      return `${Math.round(v * 100)}%`;
    };

    const section = (label: string, filter: (id: string) => boolean): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'row poly-section';
      const lab = document.createElement('div');
      lab.className = 'section-label';
      lab.textContent = label;
      row.appendChild(lab);
      const knobRow = document.createElement('div');
      knobRow.className = 'knob-row';
      row.appendChild(knobRow);
      wireEngineParams(this, ctx, knobRow, { filter, formatter: fmt });
      return row;
    };

    container.appendChild(section('STRING', (id) => id.startsWith('string.')));
    container.appendChild(section('EXCITE', (id) => id.startsWith('excite.')));
    container.appendChild(section('AMP',    (id) => id.startsWith('amp.')));

    renderModulatorsPanel(container, {
      engineId: this.id,
      laneId: ctx.laneId,
      host: this.modHost,
      registry: ctx.registry as Map<string, KnobHandle>,
      registerKnob: (k) => ctx.registerKnob(k),
      lookupLaneDisplayName: ctx.lookupLaneDisplayName,
      onChange: () => {
        container.innerHTML = '';
        this.buildParamUI(container, ctx);
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
      },
    });
  }

  randomize(): void {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    this.paramValues['string.damping']    = rnd(0.05, 0.55);   // mostly ringy
    this.paramValues['string.brightness'] = rnd(0.3, 0.9);
    this.paramValues['excite.time']       = rnd(0.002, 0.03);
    this.paramValues['excite.tone']       = rnd(0.2, 0.85);
    this.paramValues['amp.attack']        = rnd(0.001, 0.02);
    this.paramValues['amp.release']       = rnd(0.3, 2.5);
    this.paramValues['amp.level']         = rnd(0.6, 0.9);
  }

  dispose(): void {}
}

export const karplusEngine = new KarplusEngine();
registerEngine(karplusEngine);
registerEngineFactory('karplus', () => new KarplusEngine());
