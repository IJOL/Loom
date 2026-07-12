import { describe, it, expect } from 'vitest';
import { buildSavedStateV3, applyLoadedStateV3 } from './saved-state-v3';

// The master-bus compressor (THR/RAT/ATK/REL/KNEE/MKUP + bypass) lives at the
// tail of the master chain, separate from the MasterBusStrip (which is EQ/pan/
// mute only). A save must round-trip its state so a loaded session sounds like
// the saved one instead of resetting the compressor to its constructed defaults.

const COMP = {
  threshold: -18, ratio: 6, attack: 0.01, release: 0.4,
  knee: 12, makeup: 1.5, bypass: false,
};

describe('SavedStateV3 persists the master compressor', () => {
  it('buildSavedStateV3 serializes masterComp from deps.masterComp.getState()', () => {
    const deps = {
      seq: { bpm: 120, swing: 0, meter: { num: 4, den: 4 } },
      volInput: { value: '0.5' },
      sessionHost: { getStateForSave: () => ({ lanes: [], scenes: [], globalQuantize: '1/1' }) },
      lanes: { resources: new Map() },
      masterComp: { getState: () => ({ ...COMP }) },
    } as any;
    const s = buildSavedStateV3(deps);
    expect((s as any).masterComp).toEqual(COMP);
  });

  it('buildSavedStateV3 omits masterComp when no compressor dep is provided', () => {
    const deps = {
      seq: { bpm: 120, swing: 0, meter: { num: 4, den: 4 } },
      volInput: { value: '0.5' },
      sessionHost: { getStateForSave: () => ({ lanes: [], scenes: [], globalQuantize: '1/1' }) },
      lanes: { resources: new Map() },
    } as any;
    const s = buildSavedStateV3(deps);
    expect((s as any).masterComp).toBeUndefined();
  });

  it('applyLoadedStateV3 restores the master compressor via deps.masterComp.setState()', () => {
    let applied: unknown;
    const deps = {
      seq: { bpm: 0 }, volInput: { value: '' }, bpmInput: { value: '' },
      swingInput: { value: '' }, meterSel: { value: '' },
      sessionHost: { applyLoadedSessionState: () => {} },
      lanes: { resources: new Map() },
      refreshKnobsFromSynth: () => {}, renderLanes: () => {},
      fx: {}, master: { gain: { value: 0 } },
      masterComp: { setState: (s: unknown) => { applied = s; } },
    } as any;
    const save = {
      schemaVersion: 3, bpm: 120, swing: 0, masterVol: 0.5, kit: '808', wave: 'sawtooth',
      synthParams: {}, sessionState: { lanes: [], scenes: [], globalQuantize: '1/1' },
      masterComp: { ...COMP },
    } as any;
    applyLoadedStateV3(save, deps);
    expect(applied).toEqual(COMP);
  });

  it('applyLoadedStateV3 tolerates a save without masterComp (older files)', () => {
    let called = false;
    const deps = {
      seq: { bpm: 0 }, volInput: { value: '' }, bpmInput: { value: '' },
      swingInput: { value: '' }, meterSel: { value: '' },
      sessionHost: { applyLoadedSessionState: () => {} },
      lanes: { resources: new Map() },
      refreshKnobsFromSynth: () => {}, renderLanes: () => {},
      fx: {}, master: { gain: { value: 0 } },
      masterComp: { setState: () => { called = true; } },
    } as any;
    const save = {
      schemaVersion: 3, bpm: 120, swing: 0, masterVol: 0.5, kit: '808', wave: 'sawtooth',
      synthParams: {}, sessionState: { lanes: [], scenes: [], globalQuantize: '1/1' },
    } as any;
    applyLoadedStateV3(save, deps);
    expect(called).toBe(false);
  });
});
