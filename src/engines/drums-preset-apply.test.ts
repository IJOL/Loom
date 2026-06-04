import { describe, it, expect, vi } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { DrumsEngine } from './drums-engine';
import { ChannelStrip, FxBus } from '../core/fx';
import * as loader from '../presets/preset-loader';

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

describe('DrumsEngine.applyPreset (kit + per-voice overrides)', () => {
  it('loads the kit baseline then layers per-voice overrides', () => {
    const engine = makeEngine();
    vi.spyOn(loader, 'getCachedPresets').mockReturnValue([
      { name: 'Techno Punch', gm: [24],
        params: { kitId: '909', 'kick.tune': 0.9, 'snare.snap': 0.8 } as Record<string, number | string> },
    ] as never);
    engine.applyPreset('Techno Punch');
    const dm = engine.getInstance()!;
    expect(dm.kitId).toBe('909');                       // kit baseline loaded
    expect(dm.getVoiceParam('kick', 'tune')).toBeCloseTo(0.9, 5); // override applied
    expect(dm.getVoiceParam('snare', 'snap')).toBeCloseTo(0.8, 5);
    // an untouched voice keeps the 909 default (kick attack = clickAmount 0.7)
    expect(dm.getVoiceParam('kick', 'attack')).toBeCloseTo(0.7, 5);
  });

  it('a kit-only preset just loads defaults (back-compat)', () => {
    const engine = makeEngine();
    vi.spyOn(loader, 'getCachedPresets').mockReturnValue([
      { name: 'KIT TR-808', gm: [25], params: { kitId: '808' } as Record<string, number | string> },
    ] as never);
    engine.getInstance()!.setVoiceParam('kick', 'startFreq', 999); // pre-existing tweak
    engine.applyPreset('KIT TR-808');
    const dm = engine.getInstance()!;
    expect(dm.kitId).toBe('808');
    expect(dm.getVoiceParam('kick', 'startFreq')).toBe(150); // reset to 808 default
  });
});
