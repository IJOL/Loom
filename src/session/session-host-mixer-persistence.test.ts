import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SessionHost } from './session-host';
import { ChannelStrip, FxBus } from '../core/fx';

// Regression: a save dropped the per-lane mixer entirely. getStateForSave only
// collected engineState (params/modulators/noteFx) + sends; the per-lane
// ChannelStrip (level/pan/EQ/sendA/sendB/mute/comp) was never serialized, and
// load never restored it — "Save doesn't save the full mixer state".

// Minimal DOM stub so any incidental document access is a no-op under node.
(globalThis as unknown as { document: unknown }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

function makeCtx(): { ctx: AudioContext; fx: FxBus } {
  const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  return { ctx, fx };
}

function makeHost(strip: ChannelStrip, ctx: AudioContext): SessionHost {
  const engine = { id: 'tb303' };
  const laneResources = {
    get: (id: string) => (id === 'tb-303-1' ? { engine, strip } : undefined),
    ids: () => ['tb-303-1'],
    dispose: () => {},
  };
  return new SessionHost(
    { laneResources, ctx } as unknown as ConstructorParameters<typeof SessionHost>[0],
  );
}

describe('SessionHost mixer persistence (Save/Load the full per-lane mixer)', () => {
  it('getStateForSave captures the per-lane ChannelStrip into lane.mixer', () => {
    const { ctx, fx } = makeCtx();
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    strip.setLevel(0.3);
    strip.setSendA(0.4);
    strip.setSendB(0.6);
    strip.setEqLow(3);
    strip.setEqMid(-2);
    strip.setEqHigh(5);
    strip.setMuted(true);

    const host = makeHost(strip, ctx);
    host.state.lanes = [{ id: 'tb-303-1', engineId: 'tb303', clips: [] }];

    const saved = host.getStateForSave();
    const mixer = saved.lanes[0].mixer;

    // pan is set via setTargetAtTime, so panner.pan.value never converges in an
    // OfflineAudioContext that isn't rendered — not observable here. The single
    // serialize() carries every field (incl. pan), so level/sends/EQ/mute prove
    // the wiring; the serialize↔restore round-trip itself is covered in fx.test.ts.
    expect(mixer, 'lane.mixer is persisted').toBeDefined();
    expect(mixer!.level).toBeCloseTo(0.3, 4);
    expect(mixer!.sendA).toBeCloseTo(0.4, 4);
    expect(mixer!.sendB).toBeCloseTo(0.6, 4);
    expect(mixer!.eqLow).toBeCloseTo(3, 4);
    expect(mixer!.eqMid).toBeCloseTo(-2, 4);
    expect(mixer!.eqHigh).toBeCloseTo(5, 4);
    expect(mixer!.muted).toBe(true);
  });

  it('applyEngineState restores lane.mixer onto the live ChannelStrip', () => {
    const { ctx, fx } = makeCtx();

    // Source strip → serialize → the persisted mixer state.
    const src = new ChannelStrip(ctx, ctx.destination, fx);
    src.setLevel(0.25);
    src.setSendA(0.3);
    src.setSendB(0.7);
    src.setEqLow(2);
    src.setEqMid(-1);
    src.setEqHigh(4);
    src.setMuted(true);
    const mixerState = src.serialize();

    // Destination strip starts at defaults; load must push the saved values in.
    const dst = new ChannelStrip(ctx, ctx.destination, fx);
    const host = makeHost(dst, ctx);
    host.state.lanes = [{ id: 'tb-303-1', engineId: 'tb303', clips: [], mixer: mixerState }];

    host.applyEngineState();

    const after = dst.serialize();
    expect(after.level).toBeCloseTo(0.25, 4);
    expect(after.sendA).toBeCloseTo(0.3, 4);
    expect(after.sendB).toBeCloseTo(0.7, 4);
    expect(after.eqLow).toBeCloseTo(2, 4);
    expect(after.eqMid).toBeCloseTo(-1, 4);
    expect(after.eqHigh).toBeCloseTo(4, 4);
    expect(after.muted).toBe(true);
  });
});
