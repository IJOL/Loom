import { describe, it, expect } from 'vitest';
import { DrumsEngine } from './drums-engine';
import { validateSpec } from './engine-params';
import { OfflineAudioContext } from 'node-web-audio-api';
import { FxBus } from '../core/fx';
import type { ModulatorVoice } from '../modulation/types';

describe('DrumsEngine.params', () => {
  const engine = new DrumsEngine();

  it('every spec validates', () => {
    for (const spec of engine.params) {
      expect(() => validateSpec(spec)).not.toThrow();
    }
  });

  it('has master + per-voice specs', () => {
    const ids = engine.params.map(p => p.id);
    expect(ids).toContain('master.level');
    expect(ids).toContain('master.tune');
    expect(ids).toContain('kick.level');
    expect(ids).toContain('snare.level');
    expect(ids).toContain('closedHat.level');
    expect(ids).toContain('openHat.level');
  });

  it('all params are continuous', () => {
    for (const spec of engine.params) {
      expect(spec.kind).toBe('continuous');
    }
  });
});

describe('DrumsEngine getBaseValue (no instance) returns defaults', () => {
  const engine = new DrumsEngine();

  it('returns default for kick.level', () => {
    expect(engine.getBaseValue('kick.level')).toBe(1);
  });

  it('returns 0 for unknown id', () => {
    expect(engine.getBaseValue('not.real')).toBe(0);
  });

  it('setBaseValue without instance is a no-op (no throw)', () => {
    expect(() => engine.setBaseValue('kick.level', 0.8)).not.toThrow();
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
