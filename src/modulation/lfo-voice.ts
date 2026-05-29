// src/modulation/lfo-voice.ts
// Web Audio LFO voice with a JS-mirrored phase so the rAF UI loop can
// poll currentValue() for knob animation.

import type { ModulatorState, ModulatorVoice } from './types';
import { computeWaveform } from './waveform';
import { effectiveRateHz } from './rate-sync';

export class LFOVoice implements ModulatorVoice {
  output: AudioNode;

  private ctx: AudioContext;
  private osc!: OscillatorNode;
  private gain: GainNode;
  private dc: ConstantSourceNode;
  private state: ModulatorState;
  private bpmGetter: () => number;
  private startedAt: number;

  constructor(ctx: AudioContext, state: ModulatorState, bpm: () => number) {
    this.ctx = ctx;
    this.state = state;
    this.bpmGetter = bpm;
    this.gain = ctx.createGain();
    this.gain.gain.value = state.bipolar !== false ? 1 : 0.5;
    this.dc = ctx.createConstantSource();
    this.dc.offset.value = state.bipolar !== false ? 0 : 0.5;
    this.dc.start();
    this.dc.connect(this.gain);
    this.startedAt = ctx.currentTime;
    this.createOsc(this.startedAt);
    this.output = this.gain;
  }

  private createOsc(time: number): void {
    if (this.osc) {
      try { this.osc.stop(); } catch { /* already stopped */ }
      this.osc.disconnect();
    }
    this.osc = this.ctx.createOscillator();
    this.osc.type = (this.state.waveform ?? 'sine') as OscillatorType;
    this.osc.frequency.value = effectiveRateHz(this.state, this.bpmGetter());
    this.osc.connect(this.gain);
    this.osc.start(time);
  }

  trigger(time: number, _opts?: { gateDuration: number; accent?: boolean }): void {
    // Free-run mode keeps the LFO's intrinsic phase across notes — the
    // classic analog-synth behavior. 'note' mode resets the phase on every
    // trigger so the LFO peak lands at note-on.
    if ((this.state.trigger ?? 'free') !== 'note') return;
    this.startedAt = time;
    this.createOsc(time);
  }

  release(_time: number): void { /* LFOs free-run */ }

  /** Push the latest state.{rateHz, waveform, syncToBpm, syncRatio} into the
   *  live OscillatorNode. Called from the engine's modulators-panel onChange
   *  hook and as a side-effect of currentValue() so a rate tweak during
   *  playback actually changes what you HEAR (not just the knob arc). */
  syncFromState(): void {
    const rate = effectiveRateHz(this.state, this.bpmGetter());
    if (Math.abs(this.osc.frequency.value - rate) > 1e-4) {
      this.osc.frequency.value = rate;
    }
    const wave = (this.state.waveform ?? 'sine') as OscillatorType;
    if (this.osc.type !== wave) this.osc.type = wave;
  }

  currentValue(): number {
    // Side-effect: keep the live oscillator in sync with state mutations
    // while the rAF modulation tick polls us each frame during playback.
    this.syncFromState();
    const t = this.ctx.currentTime - this.startedAt;
    const rate = effectiveRateHz(this.state, this.bpmGetter());
    const phase = t * rate;
    return computeWaveform(this.state.waveform ?? 'sine', phase, this.state.bipolar !== false);
  }

  dispose(): void {
    try { this.osc.stop(); } catch { /* */ }
    try { this.dc.stop(); } catch { /* */ }
    this.osc.disconnect();
    this.dc.disconnect();
    this.gain.disconnect();
  }
}
