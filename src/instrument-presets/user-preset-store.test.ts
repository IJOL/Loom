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
  snapshotEngineParams, loadUserPresets, saveUserPreset, deleteUserPreset, USER_PRESETS_KEY,
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
    saveUserPreset('fm', 'Bells', { params: { 'op1.ratio': 3 } });

    expect(Object.keys(loadUserPresets('fm'))).toEqual(['Bells']);
    expect(loadUserPresets('subtractive')).toEqual({});
  });

  it('two engines may hold a preset of the same name', () => {
    saveUserPreset('fm', 'Lead', { params: { 'op1.ratio': 3 } });
    saveUserPreset('wavetable', 'Lead', { params: { morph: 0.75 } });

    expect(loadUserPresets('fm').Lead.params).toEqual({ 'op1.ratio': 3 });
    expect(loadUserPresets('wavetable').Lead.params).toEqual({ morph: 0.75 });
  });

  it('deleting one engine\'s preset leaves the other\'s alone', () => {
    saveUserPreset('fm', 'Lead', { params: { 'op1.ratio': 3 } });
    saveUserPreset('wavetable', 'Lead', { params: { morph: 0.75 } });

    deleteUserPreset('fm', 'Lead');

    expect(loadUserPresets('fm')).toEqual({});
    expect(loadUserPresets('wavetable').Lead.params).toEqual({ morph: 0.75 });
  });
});

describe('storage', () => {
  it('writes under one key, keyed by engine', () => {
    saveUserPreset('fm', 'Bells', { params: { 'op1.ratio': 3 } });

    expect(JSON.parse(localStorage.getItem(USER_PRESETS_KEY)!)).toEqual({
      fm: { Bells: { params: { 'op1.ratio': 3 } } },
    });
  });

  it('survives a key holding something that is not JSON', () => {
    localStorage.setItem(USER_PRESETS_KEY, 'not json {');

    expect(loadUserPresets('fm')).toEqual({});
  });

  it('deleting a name that was never saved reports so', () => {
    expect(deleteUserPreset('fm', 'nothing here')).toBe(false);
  });
});
