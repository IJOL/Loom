// src/polysynth/polysynth-presets.test.ts
import { describe, it, expect } from 'vitest';
import { polyParamsToFlat } from './polysynth-presets';
import { POLY_DEFAULTS, type PolySynthParams } from './polysynth';

describe('polyParamsToFlat', () => {
  it('converts the nested PolySynthParams tree to the dot-id flat vocabulary', () => {
    const flat = polyParamsToFlat(POLY_DEFAULTS);
    // sample of the flat keys the WorkletLaneEngine / subtractive specs consume
    expect(flat['filter.cutoff']).toBe(POLY_DEFAULTS.filter.cutoff);
    expect(flat['amp.attack']).toBe(POLY_DEFAULTS.amp.attack);
    expect(flat['sub.level']).toBe(POLY_DEFAULTS.sub.level);
    expect(flat['master.tune']).toBe(POLY_DEFAULTS.master.tune);
  });

  it('maps the oscillator WAVE string to its numeric index', () => {
    const flat = polyParamsToFlat(POLY_DEFAULTS);
    // POLY_DEFAULTS osc1 = sawtooth (index 0), osc2 = square (index 1).
    expect(flat['osc1.wave']).toBe(0);
    expect(flat['osc2.wave']).toBe(1);
    const tri: PolySynthParams = JSON.parse(JSON.stringify(POLY_DEFAULTS));
    tri.osc1.wave = 'triangle';   // index 2
    tri.osc2.wave = 'sine';       // index 3
    const f2 = polyParamsToFlat(tri);
    expect(f2['osc1.wave']).toBe(2);
    expect(f2['osc2.wave']).toBe(3);
  });

  it('round-trips a user preset (flat → poly → flat is stable on shared fields)', () => {
    const user: PolySynthParams = JSON.parse(JSON.stringify(POLY_DEFAULTS));
    user.filter.cutoff = 0.8;
    user.filter.resonance = 0.6;
    user.osc1.wave = 'triangle';
    user.amp.release = 1.25;
    const flat = polyParamsToFlat(user);
    expect(flat['filter.cutoff']).toBe(0.8);
    expect(flat['filter.resonance']).toBe(0.6);
    expect(flat['osc1.wave']).toBe(2);
    expect(flat['amp.release']).toBe(1.25);
  });
});
