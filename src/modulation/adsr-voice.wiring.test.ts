// src/modulation/adsr-voice.wiring.test.ts
// Layer-4: ADSRVoice connected to a gain should follow the A→D→S envelope
// while gated and decay to ~0 after release.

import { describe, it, expect } from 'vitest';
import { ADSRVoice } from './adsr-voice';
import { makeDefaultADSR } from './types';
import { rms } from '../../test/dsp-asserts';

async function renderAdsrIntoGain(
  attack: number, decay: number, sustain: number, release: number,
  gateDur: number, totalDur: number,
): Promise<Float32Array> {
  const SR = 44100;
  const ctx = new OfflineAudioContext(1, Math.round(SR * totalDur), SR);

  const src = ctx.createConstantSource();
  src.offset.value = 1.0;
  const target = ctx.createGain();
  target.gain.value = 0.0;
  src.connect(target);
  target.connect(ctx.destination);
  src.start(0);

  const state = makeDefaultADSR('adsr1');
  state.attackSec = attack;
  state.decaySec = decay;
  state.sustain = sustain;
  state.releaseSec = release;
  const adsr = new ADSRVoice(ctx as unknown as AudioContext, state);

  const depthGain = ctx.createGain();
  depthGain.gain.value = 1.0;
  adsr.output.connect(depthGain);
  depthGain.connect(target.gain);

  adsr.trigger(0, { gateDuration: gateDur });
  adsr.release(gateDur);

  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

function meanIn(buf: Float32Array, startSec: number, endSec: number, sr: number): number {
  const s = Math.max(0, Math.floor(startSec * sr));
  const e = Math.min(buf.length, Math.floor(endSec * sr));
  let sum = 0;
  for (let i = s; i < e; i++) sum += buf[i];
  return (e - s) > 0 ? sum / (e - s) : 0;
}

describe('ADSRVoice wiring', () => {
  it('attack ramps from 0 toward peak', async () => {
    const buf = await renderAdsrIntoGain(0.1, 0.1, 0.7, 0.1, 0.5, 0.8);
    const SR = 44100;
    const early = meanIn(buf, 0,    0.02, SR);
    const peakish = meanIn(buf, 0.08, 0.12, SR);
    expect(peakish).toBeGreaterThan(early + 0.1);
  });

  it('decay falls from peak toward sustain', async () => {
    const buf = await renderAdsrIntoGain(0.01, 0.1, 0.5, 0.1, 0.5, 0.8);
    const SR = 44100;
    const justAfterAttack = meanIn(buf, 0.015, 0.025, SR);
    const afterDecay      = meanIn(buf, 0.15,  0.18,  SR);
    expect(justAfterAttack).toBeGreaterThan(afterDecay + 0.1);
  });

  it('sustain holds a level above zero while gated', async () => {
    const buf = await renderAdsrIntoGain(0.01, 0.05, 0.7, 0.1, 0.5, 0.8);
    const SR = 44100;
    const sustain = meanIn(buf, 0.3, 0.45, SR);
    expect(sustain).toBeGreaterThan(0.3);
    expect(sustain).toBeLessThan(0.9);
  });

  it('release decays toward 0 after gate ends', async () => {
    const buf = await renderAdsrIntoGain(0.01, 0.05, 0.5, 0.1, 0.3, 0.7);
    const SR = 44100;
    const beforeRelease = meanIn(buf, 0.25, 0.29, SR);
    const afterRelease  = meanIn(buf, 0.55, 0.65, SR);
    expect(afterRelease).toBeLessThan(beforeRelease * 0.3);
  });

  it('not gating produces near-silent output', async () => {
    const SR = 44100;
    const ctx = new OfflineAudioContext(1, Math.round(SR * 0.3), SR);
    const src = ctx.createConstantSource();
    src.offset.value = 1.0;
    const target = ctx.createGain();
    target.gain.value = 0.0;
    src.connect(target).connect(ctx.destination);
    src.start(0);

    const state = makeDefaultADSR('adsr1');
    const adsr = new ADSRVoice(ctx as unknown as AudioContext, state);
    adsr.output.connect(target.gain);
    // No trigger.

    const ab = await ctx.startRendering();
    const buf = new Float32Array(ab.getChannelData(0));
    expect(rms(buf)).toBeLessThan(0.02);
  });
});
