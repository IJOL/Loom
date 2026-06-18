import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { DrumsEngine } from './drums-engine';
import { ChannelStrip, FxBus } from '../core/fx';

function makeEngine() {
  const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  const strip = new ChannelStrip(ctx, ctx.destination, fx);
  const engine = new DrumsEngine();
  engine.setSharedFx(fx);
  engine.setBusStrip(strip);
  engine.createVoice(ctx, strip.input); // allocates the DrumMachine instance
  return engine;
}

describe('DrumsEngine per-voice routing', () => {
  it('synth param round-trips through the DrumMachine store', () => {
    const engine = makeEngine();
    engine.setBaseValue('kick.tune', 1.7);
    expect(engine.getBaseValue('kick.tune')).toBeCloseTo(1.7, 5);
    expect(engine.getInstance()!.getVoiceParam('kick', 'tune')).toBeCloseTo(1.7, 5);
  });

  it('per-voice rev send writes that voice ChannelStrip only', () => {
    const engine = makeEngine();
    engine.setBaseValue('kick.rev', 0.6);
    const dm = engine.getInstance()!;
    expect(dm.channels.kick.serialize().sendB).toBeCloseTo(0.6, 5);
    expect(dm.channels.snare.serialize().sendB).toBe(0); // untouched
  });

  it('per-voice level + eq route to the voice strip', () => {
    const engine = makeEngine();
    engine.setBaseValue('snare.level', 1.3);
    engine.setBaseValue('snare.eq.low', 6);
    const snare = engine.getInstance()!.channels.snare;
    expect(snare.serialize().level).toBeCloseTo(1.3, 5);
    expect(snare.getEqGainParam('low').value).toBeCloseTo(6, 5);
  });

  it('getBaseValue for an untouched per-voice param reads the kit default', () => {
    const engine = makeEngine();
    engine.getInstance()!.loadKitDefaults('808'); // 808 kick startFreq 150
    expect(engine.getBaseValue('kick.startFreq')).toBe(150);
  });
});
