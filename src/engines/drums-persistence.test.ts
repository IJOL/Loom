import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { DrumsEngine } from './drums-engine';
import { ChannelStrip, FxBus } from '../core/fx';
import { mirrorParamChange, mirrorDrumMutes } from '../session/session-engine-state';
import type { SessionState } from '../session/session';

function makeEngine() {
  const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  const strip = new ChannelStrip(ctx, ctx.destination, fx);
  const engine = new DrumsEngine();
  engine.setSharedFx(fx);
  engine.setBusStrip(strip);
  engine.createVoice(ctx, strip.input);
  return engine;
}

describe('per-voice params persist + restore via engineState', () => {
  it('mirrorParamChange + replay restores a per-voice edit', () => {
    const state = { lanes: [{ id: 'drums-1', engineState: {} }] } as unknown as SessionState;

    // 1. Edit + mirror (what the rack knob onChange does)
    const a = makeEngine();
    a.setBaseValue('kick.tune', 1.6);
    mirrorParamChange(state, 'drums-1', 'kick.tune', 1.6);
    a.setBaseValue('snare.rev', 0.5);
    mirrorParamChange(state, 'drums-1', 'snare.rev', 0.5);

    // 2. Fresh engine + replay engineState.params (what applyEngineState does)
    const b = makeEngine();
    const params = (state.lanes[0] as { engineState: { params?: Record<string, number> } })
      .engineState.params!;
    for (const [id, v] of Object.entries(params)) b.setBaseValue(id, v);

    expect(b.getInstance()!.getVoiceParam('kick', 'tune')).toBeCloseTo(1.6, 5);
    expect(b.getInstance()!.channels.snare.serialize().sendB).toBeCloseTo(0.5, 5);
  });

  it('kit baseline then param override = override wins (load ordering)', () => {
    const e = makeEngine();
    // ordering: applyPreset (kit) runs first in applyLoadedSessionState, then
    // applyEngineState replays params — overrides must survive.
    e.getInstance()!.loadKitDefaults('808');         // kit baseline (preset recall)
    e.setBaseValue('kick.startFreq', 333);           // engineState override
    expect(e.getBaseValue('kick.startFreq')).toBe(333);
  });

  it('per-voice mute persists: mirrorDrumMutes -> setDrumVoiceMutes restores', () => {
    const state = { lanes: [{ id: 'drums-1', engineState: {} }] } as unknown as SessionState;

    const a = makeEngine();
    a.setDrumVoiceMute('snare', true);                       // what the M button does
    mirrorDrumMutes(state, 'drums-1', a.getDrumVoiceMutes());

    const saved = (state.lanes[0] as { engineState: { drumMutes?: Record<string, boolean> } })
      .engineState.drumMutes!;
    expect(saved.snare).toBe(true);

    const b = makeEngine();
    b.setDrumVoiceMutes(saved);                              // what applyEngineState does
    expect(b.getInstance()!.channels.snare.isMuted()).toBe(true);
    expect(b.getInstance()!.channels.kick.isMuted()).toBe(false);
  });
});
