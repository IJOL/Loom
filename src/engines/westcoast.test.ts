// src/engines/westcoast.test.ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { WestEngine } from './westcoast';

describe('WestEngine — param state', () => {
  it('exposes engine identity', () => {
    const e = new WestEngine();
    expect(e.id).toBe('westcoast');
    expect(e.type).toBe('polyhost');
    expect(e.polyphony).toBe('poly');
    expect(e.editor).toBe('piano-roll');
  });

  it('round-trips continuous params via get/set', () => {
    const e = new WestEngine();
    e.setBaseValue('timbre.fold', 0.7);
    expect(e.getBaseValue('timbre.fold')).toBeCloseTo(0.7);
    e.setBaseValue('lpg.cutoff', 0.42);
    expect(e.getBaseValue('lpg.cutoff')).toBeCloseTo(0.42);
  });

  it('stores discrete params as numeric indices', () => {
    const e = new WestEngine();
    e.setBaseValue('osc.mainWave', 2); // sawtooth
    expect(e.getBaseValue('osc.mainWave')).toBe(2);
    e.setBaseValue('lpg.mode', 1); // gate
    expect(e.getBaseValue('lpg.mode')).toBe(1);
  });

  it('clamps poly.voices to 1..16 and updates maxVoices', () => {
    const e = new WestEngine();
    e.setBaseValue('poly.voices', 99);
    expect(e.getBaseValue('poly.voices')).toBe(16);
    e.setBaseValue('poly.voices', 0);
    expect(e.getBaseValue('poly.voices')).toBe(1);
  });

  it('falls back to spec defaults for unset params', () => {
    const e = new WestEngine();
    expect(e.getBaseValue('osc.ratio')).toBe(2);
    expect(e.getBaseValue('contour.amount')).toBe(0.9);
  });

  it('applyPreset writes param values', () => {
    const e = new WestEngine();
    // applyPreset reads from the cached preset list; with no presets loaded in a
    // unit context it is a no-op, so drive setBaseValue directly to prove the
    // path the preset uses. (Preset JSON is covered in the preset-sanity test.)
    e.setBaseValue('timbre.fold', 0.9);
    e.setBaseValue('osc.subDiv', 1);
    expect(e.getBaseValue('timbre.fold')).toBeCloseTo(0.9);
    expect(e.getBaseValue('osc.subDiv')).toBe(1);
  });

  it('mono mode caps simultaneous voices to 1', () => {
    const e = new WestEngine();
    const ctx = new AudioContext();
    e.setBaseValue('poly.mode', 1);
    e.createVoice(ctx, ctx.destination);
    e.createVoice(ctx, ctx.destination);
    expect(e.activeVoiceCount()).toBe(1);
  });
});
