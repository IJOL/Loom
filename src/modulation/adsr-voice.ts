// src/modulation/adsr-voice.ts
// ConstantSourceNode whose offset is automated on every trigger to follow
// the ADSR curve. JS mirror via computeAdsrAt for UI polling.

import type { ModulatorState, ModulatorVoice } from './types';
import { computeAdsrAt } from './adsr-curve';

export class ADSRVoice implements ModulatorVoice {
  output: AudioNode;
  private ctx: AudioContext;
  private src: ConstantSourceNode;
  private state: ModulatorState;
  private triggeredAt = 0;
  private gateDur = 0;

  constructor(ctx: AudioContext, state: ModulatorState) {
    this.ctx = ctx;
    this.state = state;
    this.src = ctx.createConstantSource();
    this.src.offset.value = 0;
    this.src.start();
    this.output = this.src;
  }

  trigger(time: number, opts: { gateDuration: number; accent?: boolean }): void {
    const { attackSec = 0.01, decaySec = 0.1, sustain = 0.7, releaseSec = 0.3 } = this.state;
    const o = this.src.offset;
    o.cancelScheduledValues(time);
    o.setValueAtTime(0, time);
    o.linearRampToValueAtTime(1, time + attackSec);
    o.linearRampToValueAtTime(sustain, time + attackSec + decaySec);
    const releaseAt = Math.max(time + attackSec + decaySec, time + opts.gateDuration);
    o.setValueAtTime(sustain, releaseAt);
    o.linearRampToValueAtTime(0, releaseAt + releaseSec);
    this.triggeredAt = time;
    this.gateDur = opts.gateDuration;
  }

  release(_time: number): void { /* envelope finishes via scheduled ramps */ }

  currentValue(): number {
    const t = this.ctx.currentTime - this.triggeredAt;
    return computeAdsrAt(t, this.state, this.gateDur);
  }

  dispose(): void {
    try { this.src.stop(); } catch { /* */ }
    this.src.disconnect();
  }
}
