// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { PerfMonitor } from './perf-monitor';
import { attachPerfSources, type PerfVoiceTap } from './perf-sources';
import type { Sequencer } from '../core/sequencer';

function fakeNode() {
  const node: { _ended: (() => void) | null; addEventListener: (t: string, cb: () => void) => void; end: () => void } = {
    _ended: null,
    addEventListener(type, cb) { if (type === 'ended') node._ended = cb; },
    end() { node._ended?.(); },
  };
  return node;
}

function fakeCtx() {
  const created: ReturnType<typeof fakeNode>[] = [];
  const make = () => { const n = fakeNode(); created.push(n); return n; };
  const ctx = {
    createOscillator: make,
    createBufferSource: make,
    createConstantSource: make,
    // renderCapacity intentionally absent → unsupported path
  } as unknown as AudioContext;
  return { ctx, created, origOsc: ctx.createOscillator };
}

describe('attachPerfSources', () => {
  it('counts wrapped generator nodes and decrements on ended; marks audio unsupported without renderCapacity', () => {
    const { ctx } = fakeCtx();
    const monitor = new PerfMonitor();
    const seq = {} as Sequencer;
    const voiceTap: PerfVoiceTap = { fn: null };
    const detach = attachPerfSources({ monitor, ctx, seq, voiceTap });

    expect(monitor.snapshot().audioSupported).toBe(false);
    const osc = ctx.createOscillator() as unknown as { end: () => void };
    const buf = ctx.createBufferSource() as unknown as { end: () => void };
    // all three generator factories are wrapped (oscillator/buffer/constant)
    ctx.createConstantSource() as unknown as { end: () => void };
    expect(monitor.snapshot().genNodes).toBe(3);
    osc.end();
    expect(monitor.snapshot().genNodes).toBe(2);

    // voice tap installed
    voiceTap.fn!('bass', 0.1);
    expect(monitor.snapshot().voicesTotal).toBe(1);

    // scheduler seam installed
    expect(typeof seq.onTickStats).toBe('function');

    detach();
    expect(voiceTap.fn).toBeNull();
    expect(seq.onTickStats).toBeUndefined();
  });

  it('restores the original factory functions on detach', () => {
    const { ctx, origOsc } = fakeCtx();
    const monitor = new PerfMonitor();
    const detach = attachPerfSources({ monitor, ctx, seq: {} as Sequencer, voiceTap: { fn: null } });
    expect(ctx.createOscillator).not.toBe(origOsc); // wrapped
    detach();
    expect(ctx.createOscillator).toBe(origOsc);     // restored
  });
});
