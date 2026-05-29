import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { CompBlock } from './comp-block';
import { DEFAULT_COMP_STATE } from './comp-state';

function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

async function renderSine(active: boolean): Promise<number> {
  const sr = 44100;
  const dur = 0.5;
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 440;
  const amp = ctx.createGain();
  amp.gain.value = 0.95;

  const block = new CompBlock(ctx, {
    ...DEFAULT_COMP_STATE,
    bypass: !active,
    threshold: -30,
    ratio: 8,
    attack: 0.001,
    release: 0.1,
    knee: 0,
    makeup: 1,
  });

  osc.connect(amp).connect(block.input);
  block.output.connect(ctx.destination);
  osc.start(0);
  osc.stop(dur);

  const rendered = await ctx.startRendering();
  return rms(rendered.getChannelData(0));
}

describe('CompBlock DSP', () => {
  it('active compressor reduces RMS vs bypass on a sustained loud sine', async () => {
    const bypassedRms = await renderSine(false);
    const activeRms   = await renderSine(true);
    expect(activeRms / bypassedRms).toBeLessThan(0.85);
  });

  it('bypass=true is a pass-through (rendered RMS within 1% of un-blocked)', async () => {
    const sr = 44100;
    const dur = 0.25;

    async function renderRaw(): Promise<number> {
      const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      amp.gain.value = 0.5;
      osc.frequency.value = 440;
      osc.connect(amp).connect(ctx.destination);
      osc.start(0);
      osc.stop(dur);
      const r = await ctx.startRendering();
      return rms(r.getChannelData(0));
    }

    async function renderBypassed(): Promise<number> {
      const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      amp.gain.value = 0.5;
      osc.frequency.value = 440;
      const block = new CompBlock(ctx, { ...DEFAULT_COMP_STATE, bypass: true, makeup: 1 });
      osc.connect(amp).connect(block.input);
      block.output.connect(ctx.destination);
      osc.start(0);
      osc.stop(dur);
      const r = await ctx.startRendering();
      return rms(r.getChannelData(0));
    }

    const raw = await renderRaw();
    const bypassed = await renderBypassed();
    expect(Math.abs(bypassed - raw) / raw).toBeLessThan(0.01);
  });
});
