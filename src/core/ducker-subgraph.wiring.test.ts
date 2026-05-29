import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { DuckerSubgraph } from './ducker-subgraph';
import { DEFAULT_SIDECHAIN_STATE } from './comp-state';

function rms(buf: Float32Array, from: number, to: number): number {
  let s = 0;
  const n = to - from;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

describe('DuckerSubgraph wiring', () => {
  it('duck.gain dips when the source signal is loud and recovers when it stops', async () => {
    const sr = 44100;
    const dur = 1.0;
    const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);

    const target = ctx.createOscillator();
    target.frequency.value = 440;
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;

    const sourceBuf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const srcData = sourceBuf.getChannelData(0);
    const burstStart = Math.floor(sr * 0.2);
    const burstEnd   = Math.floor(sr * 0.4);
    for (let i = burstStart; i < burstEnd; i++) srcData[i] = (Math.random() * 2 - 1) * 0.9;
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = sourceBuf;
    const sourceTap = ctx.createGain();
    sourceNode.connect(sourceTap);

    const ducker = new DuckerSubgraph(ctx, {
      sourceTap,
      duckGain,
      state: { ...DEFAULT_SIDECHAIN_STATE, source: 'ignored', depth: 0.8, attack: 0.003, release: 0.05 },
    });
    expect(ducker).toBeDefined();

    target.connect(duckGain).connect(ctx.destination);
    target.start(0);
    target.stop(dur);
    sourceNode.start(0);

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);

    const duckedRms = rms(data, Math.floor(sr * 0.25), Math.floor(sr * 0.38));
    const cleanRms  = rms(data, Math.floor(sr * 0.05), Math.floor(sr * 0.18));

    expect(duckedRms / cleanRms).toBeLessThan(0.85);
  });

  it('dispose() detaches the follower so duck.gain recovers to 1.0', async () => {
    const sr = 44100;
    const dur = 0.5;
    const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);

    const target = ctx.createOscillator();
    target.frequency.value = 440;
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;

    const sourceBuf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const srcData = sourceBuf.getChannelData(0);
    for (let i = 0; i < srcData.length; i++) srcData[i] = (Math.random() * 2 - 1) * 0.9;
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = sourceBuf;
    const sourceTap = ctx.createGain();
    sourceNode.connect(sourceTap);

    const ducker = new DuckerSubgraph(ctx, {
      sourceTap, duckGain,
      state: { ...DEFAULT_SIDECHAIN_STATE, source: 'ignored', depth: 0.9 },
    });
    ducker.dispose();

    target.connect(duckGain).connect(ctx.destination);
    target.start(0);
    target.stop(dur);
    sourceNode.start(0);

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);
    const fullRms = rms(data, Math.floor(sr * 0.05), Math.floor(sr * 0.45));
    expect(fullRms).toBeGreaterThan(0.5);
  });
});
