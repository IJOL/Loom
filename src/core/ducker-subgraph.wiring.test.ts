import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { DuckerSubgraph } from './ducker-subgraph';
import { DEFAULT_SIDECHAIN_STATE } from './comp-state';

// The DUCKING ITSELF is no longer testable here. It moved into the duck-detector
// AudioWorklet, and node-web-audio-api cannot run our TS processor (test/setup.ts
// stubs AudioWorkletNode + resolves addModule), exactly like the engine renderers
// after the worklet cutover. So the coverage is split three ways:
//   • the follower's math          → audio-dsp/duck-detector.test.ts (pure, 10 cases)
//   • it ducks and stays in [0,1]  → tests/e2e/sidechain-duck.spec.ts (real Chrome)
//   • the graph contract below     → who owns duckGain.gain, and giving it back
// The contract matters because the processor emits the multiplier itself: while it
// is attached the param's intrinsic value MUST be 0, and on teardown the lane must
// get its gain back — otherwise disposing a ducker leaves a lane silent forever.

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('DuckerSubgraph graph contract', () => {
  it('a detector that cannot be built leaves the lane at unity, not silent', async () => {
    // This environment is exactly that case: test/setup.ts's AudioWorkletNode stub
    // is not a real audio node, so wiring the tap into it throws. The lane must
    // then play UN-DUCKED — the failure mode to avoid is a lane stuck at gain 0
    // because the param was handed to a processor that never arrived.
    const ctx = new OfflineAudioContext(1, 128, 44100);
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;
    const sourceTap = ctx.createGain();

    const ducker = new DuckerSubgraph(ctx, {
      sourceTap, duckGain,
      state: { ...DEFAULT_SIDECHAIN_STATE, source: 'kick', depth: 0.8 },
    });
    // Attachment waits on addModule, so it lands a microtask later.
    await tick();
    expect(duckGain.gain.value).toBe(1);
    expect(ducker).toBeDefined();
  });

  it('dispose() gives the lane its gain back', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100);
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;
    const sourceTap = ctx.createGain();

    const ducker = new DuckerSubgraph(ctx, {
      sourceTap, duckGain,
      state: { ...DEFAULT_SIDECHAIN_STATE, source: 'kick', depth: 0.9 },
    });
    await tick();
    ducker.dispose();
    expect(duckGain.gain.value).toBe(1);
  });

  it('dispose() before the module resolves still leaves the lane audible', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100);
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;
    const sourceTap = ctx.createGain();

    const ducker = new DuckerSubgraph(ctx, {
      sourceTap, duckGain,
      state: { ...DEFAULT_SIDECHAIN_STATE, source: 'kick', depth: 0.9 },
    });
    ducker.dispose();          // same tick — the attach() promise is still pending
    await tick();
    expect(duckGain.gain.value).toBe(1);
  });

  it('setState before attachment does not throw', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100);
    const duckGain = ctx.createGain();
    const sourceTap = ctx.createGain();
    const ducker = new DuckerSubgraph(ctx, {
      sourceTap, duckGain, state: { ...DEFAULT_SIDECHAIN_STATE, source: 'kick' },
    });
    expect(() => ducker.setState({ ...DEFAULT_SIDECHAIN_STATE, source: 'kick', depth: 0.3 })).not.toThrow();
    await tick();
    ducker.dispose();
  });
});
