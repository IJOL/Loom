// @vitest-environment jsdom
//
// A user preset belongs to ONE engine. Before this store existed, "Save As…"
// snapshotted the twenty-three SUBTRACTIVE dot-ids off whatever engine the
// active lane happened to run, so saving on an FM lane wrote a bag of
// subtractive ids that FM has never heard of — and filed it where every
// subtractive lane would offer it.

import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineParamSpec } from '../engines/engine-params';
import { STRIP_PARAM_SPECS } from '../core/channel-strip-params';
import {
  snapshotEngineParams, loadUserPresets, saveUserPreset, deleteUserPreset,
  LEGACY_POLY_PRESETS_KEY, USER_PRESETS_KEY,
} from './user-preset-store';

/** The minimum of a SynthEngine that a snapshot reads. */
function fakeEngine(params: EngineParamSpec[], values: Record<string, number>) {
  return {
    params: [...params, ...STRIP_PARAM_SPECS],
    getBaseValue: (id: string): number => values[id] ?? 0,
  };
}

const FM_PARAMS: EngineParamSpec[] = [
  { id: 'op1.ratio', label: 'Op1 Ratio', kind: 'continuous', min: 0, max: 16, default: 1 },
  { id: 'op1.level', label: 'Op1 Lvl', kind: 'continuous', min: 0, max: 1, default: 0.8 },
  { id: 'algorithm', label: 'Algorithm', kind: 'discrete', min: 0, max: 7, default: 0 },
];

beforeEach(() => localStorage.clear());

describe('snapshotEngineParams', () => {
  it('captures the ids the engine declares, not another engine\'s', () => {
    const fm = fakeEngine(FM_PARAMS, { 'op1.ratio': 3, 'op1.level': 0.5, algorithm: 4 });

    const snap = snapshotEngineParams(fm);

    expect(snap).toEqual({ 'op1.ratio': 3, 'op1.level': 0.5, algorithm: 4 });
    // The bug this file exists for: subtractive's vocabulary must not appear.
    expect(snap).not.toHaveProperty('filter.cutoff');
    expect(snap).not.toHaveProperty('osc1.wave');
  });

  it('leaves the mixer out of the sound', () => {
    // STRIP_PARAM_SPECS are spread into every engine's params, but level, pan,
    // sends and EQ are the desk, not the patch: recalling a preset must not
    // move the fader.
    const fm = fakeEngine(FM_PARAMS, { 'op1.ratio': 3, 'bus.level': 0.2, 'bus.pan': -1 });

    const snap = snapshotEngineParams(fm);

    for (const id of Object.keys(snap)) expect(id.startsWith('bus.')).toBe(false);
  });
});

describe('user presets are filed under their engine', () => {
  it('a preset saved on fm is not offered on subtractive', () => {
    saveUserPreset('fm', 'Bells', { 'op1.ratio': 3 });

    expect(Object.keys(loadUserPresets('fm'))).toEqual(['Bells']);
    expect(loadUserPresets('subtractive')).toEqual({});
  });

  it('two engines may hold a preset of the same name', () => {
    saveUserPreset('fm', 'Lead', { 'op1.ratio': 3 });
    saveUserPreset('wavetable', 'Lead', { morph: 0.75 });

    expect(loadUserPresets('fm').Lead).toEqual({ 'op1.ratio': 3 });
    expect(loadUserPresets('wavetable').Lead).toEqual({ morph: 0.75 });
  });

  it('deleting one engine\'s preset leaves the other\'s alone', () => {
    saveUserPreset('fm', 'Lead', { 'op1.ratio': 3 });
    saveUserPreset('wavetable', 'Lead', { morph: 0.75 });

    deleteUserPreset('fm', 'Lead');

    expect(loadUserPresets('fm')).toEqual({});
    expect(loadUserPresets('wavetable').Lead).toEqual({ morph: 0.75 });
  });
});

describe('presets saved before this store still load', () => {
  // There are no migrations in this project: the old key is read where it
  // stands, flattened on the way out, and never rewritten.
  const legacy = {
    'My Bass': {
      master: { tune: 0 },
      osc1: { wave: 'square', level: 0.9, octave: 0, semi: 0, detune: 0 },
      osc2: { wave: 'sawtooth', level: 0.2, octave: 0, semi: 0, detune: 7 },
      sub: { level: 0.4, octave: -1 },
      noise: { level: 0, color: 0.6 },
      filter: {
        type: 'lowpass', cutoff: 0.33, resonance: 0.8, envAmount: 0.5,
        keyTrack: 0, drive: 0, attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2,
      },
      amp: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.2 },
    },
  };

  it('reads the old subtractive presets, flattened to dot-ids', () => {
    localStorage.setItem(LEGACY_POLY_PRESETS_KEY, JSON.stringify(legacy));

    const presets = loadUserPresets('subtractive');

    expect(Object.keys(presets)).toEqual(['My Bass']);
    expect(presets['My Bass']['filter.cutoff']).toBe(0.33);
    expect(presets['My Bass']['osc1.wave']).toBe(1);   // 'square' → index
  });

  it('offers them only to subtractive', () => {
    localStorage.setItem(LEGACY_POLY_PRESETS_KEY, JSON.stringify(legacy));

    expect(loadUserPresets('fm')).toEqual({});
  });

  it('does not rewrite the old key when a new preset is saved', () => {
    localStorage.setItem(LEGACY_POLY_PRESETS_KEY, JSON.stringify(legacy));

    saveUserPreset('subtractive', 'Newer', { 'filter.cutoff': 0.9 });

    expect(JSON.parse(localStorage.getItem(LEGACY_POLY_PRESETS_KEY)!)).toEqual(legacy);
    expect(Object.keys(loadUserPresets('subtractive')).sort()).toEqual(['My Bass', 'Newer']);
  });

  it('a new preset of the same name wins over the legacy one', () => {
    localStorage.setItem(LEGACY_POLY_PRESETS_KEY, JSON.stringify(legacy));

    saveUserPreset('subtractive', 'My Bass', { 'filter.cutoff': 0.9 });

    expect(loadUserPresets('subtractive')['My Bass']['filter.cutoff']).toBe(0.9);
  });

  it('writes new presets under its own key', () => {
    saveUserPreset('fm', 'Bells', { 'op1.ratio': 3 });

    expect(JSON.parse(localStorage.getItem(USER_PRESETS_KEY)!)).toEqual({
      fm: { Bells: { 'op1.ratio': 3 } },
    });
  });
});
