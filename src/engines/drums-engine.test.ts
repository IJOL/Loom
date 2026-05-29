import { describe, it, expect } from 'vitest';
import { DrumsEngine } from './drums-engine';
import { validateSpec } from './engine-params';
import { OfflineAudioContext } from 'node-web-audio-api';
import { ChannelStrip, FxBus } from '../core/fx';
import type { ModulatorVoice } from '../modulation/types';

describe('DrumsEngine.params', () => {
  const engine = new DrumsEngine();

  it('every spec validates', () => {
    for (const spec of engine.params) {
      expect(() => validateSpec(spec)).not.toThrow();
    }
  });

  it('exposes only bus.* specs (per-voice params live on the drum-grid, not here)', () => {
    const ids = engine.params.map(p => p.id);
    expect(ids).toContain('bus.level');
    expect(ids).toContain('bus.pan');
    expect(ids).toContain('bus.reverbSend');
    expect(ids).toContain('bus.delaySend');
    expect(ids).toContain('bus.eq.low');
    expect(ids).toContain('bus.eq.mid');
    expect(ids).toContain('bus.eq.high');
    expect(ids).not.toContain('kick.level');
    expect(ids).not.toContain('snare.level');
    expect(ids).not.toContain('master.level');
    expect(ids).not.toContain('master.tune');
  });

  it('all params are continuous', () => {
    for (const spec of engine.params) {
      expect(spec.kind).toBe('continuous');
    }
  });
});

describe('DrumsEngine getBaseValue (no instance) returns defaults', () => {
  const engine = new DrumsEngine();

  it('returns default for bus.level', () => {
    expect(engine.getBaseValue('bus.level')).toBe(1);
  });

  it('returns 0 for unknown id', () => {
    expect(engine.getBaseValue('not.real')).toBe(0);
  });

  it('setBaseValue without bus strip is a no-op (no throw)', () => {
    expect(() => engine.setBaseValue('bus.level', 0.8)).not.toThrow();
  });
});

describe('DrumsEngine BPM sync for modulator voices', () => {
  // Drums historically hardcoded `() => 120` when spawning modulator voices, so
  // LFOs never followed runtime tempo changes — distinct from every other
  // engine which uses `() => this.bpm`. This regression test captures the
  // contract.
  it('passes engine.bpm getter (not a constant) to modulators.spawnVoice', () => {
    const engine = new DrumsEngine();
    const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
    engine.setSharedFx(new FxBus(ctx, ctx.destination));

    let captured: (() => number) | null = null;
    const host = engine.modulators;
    const orig = host.spawnVoice.bind(host);
    host.spawnVoice = (c: AudioContext, bpm: () => number): Map<string, ModulatorVoice> => {
      captured = bpm;
      return orig(c, bpm);
    };

    engine.bpm = 174;
    const voice = engine.createVoice(ctx, ctx.destination);
    expect(captured).not.toBeNull();
    expect(captured!()).toBe(174);

    engine.bpm = 96;
    expect(captured!()).toBe(96);

    voice.dispose();
  });
});

describe('DrumsEngine bus EQ', () => {
  it('exposes bus.eq.low/mid/high AudioParams once setBusStrip is called', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    const engine = new DrumsEngine();
    engine.setSharedFx(fx);
    engine.setBusStrip(strip);
    const voice = engine.createVoice(ctx, strip.input);
    const params = voice.getAudioParams();
    expect(params.has('bus.eq.low')).toBe(true);
    expect(params.has('bus.eq.mid')).toBe(true);
    expect(params.has('bus.eq.high')).toBe(true);
  });

  it('setBaseValue("bus.eq.low", v) routes to the strip\'s EQ gain', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    const engine = new DrumsEngine();
    engine.setSharedFx(fx);
    engine.setBusStrip(strip);
    engine.createVoice(ctx, strip.input);
    engine.setBaseValue('bus.eq.low', 9);
    expect(strip.getEqGainParam('low').value).toBeCloseTo(9, 5);
  });
});
