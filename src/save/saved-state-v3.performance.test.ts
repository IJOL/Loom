import { describe, it, expect } from 'vitest';
import { parseSavedStateV3 } from './saved-state-v3';

describe('parseSavedStateV3 with arrangement + mode', () => {
  it('accepts a v3 save that includes the new arrangement and mode fields', () => {
    const raw = {
      schemaVersion: 3, bpm: 130, swing: 0, masterVol: 0.5,
      kit: '808', wave: 'sawtooth',
      synthParams: {},
      sessionState: { lanes: [], scenes: [], globalQuantize: '1/1' },
      mode: 'performance',
      arrangement: {
        bpm: 130, durationSec: 4,
        lanes: [{ laneId: 'tb-303-1', clipEvents: [], automation: [] }],
        globalAutomation: [],
      },
    };
    const s = parseSavedStateV3(raw);
    expect(s).not.toBeNull();
    expect((s as any).mode).toBe('performance');
    expect((s as any).arrangement?.durationSec).toBe(4);
  });

  it('a v3 save without arrangement still parses; arrangement is undefined', () => {
    const raw = {
      schemaVersion: 3, bpm: 120, swing: 0, masterVol: 0.5,
      kit: 'tr909', wave: 'square',
      synthParams: {}, sessionState: { lanes: [], scenes: [], globalQuantize: '1/1' },
    };
    const s = parseSavedStateV3(raw);
    expect(s).not.toBeNull();
    expect((s as any).arrangement).toBeUndefined();
    expect((s as any).mode).toBeUndefined();
  });
});

import { buildSavedStateV3, applyLoadedStateV3 } from './saved-state-v3';

describe('SavedStateV3 persists mode + arrangement', () => {
  it('buildSavedStateV3 includes mode and arrangement from the deps accessors', () => {
    const arr = { bpm: 130, durationSec: 4, lanes: [], globalAutomation: [] };
    const deps = {
      seq: { bpm: 130, swing: 0 },
      volInput: { value: '0.5' },
      sessionHost: { getStateForSave: () => ({ lanes: [], scenes: [], globalQuantize: '1/1' }) },
      lanes: { resources: new Map() },
      getMode: () => 'performance',
      getArrangement: () => arr,
    } as any;
    const s = buildSavedStateV3(deps);
    expect((s as any).mode).toBe('performance');
    expect((s as any).arrangement?.durationSec).toBe(4);
  });

  it('buildSavedStateV3 omits mode/arrangement when no accessors are provided', () => {
    const deps = {
      seq: { bpm: 120, swing: 0 },
      volInput: { value: '0.5' },
      sessionHost: { getStateForSave: () => ({ lanes: [], scenes: [], globalQuantize: '1/1' }) },
      lanes: { resources: new Map() },
    } as any;
    const s = buildSavedStateV3(deps);
    expect((s as any).mode).toBeUndefined();
    expect((s as any).arrangement).toBeUndefined();
  });

  it('applyLoadedStateV3 restores arrangement + mode via the deps setters', () => {
    let appliedMode: string | undefined;
    let appliedArr: { durationSec?: number } | undefined;
    const deps = {
      seq: { bpm: 0 }, volInput: { value: '' }, bpmInput: { value: '' },
      swingInput: { value: '' }, waveSel: { value: '' },
      sessionHost: { applyLoadedSessionState: () => {} },
      lanes: { resources: new Map() },
      refreshKnobsFromSynth: () => {}, renderLanes: () => {},
      fx: { setBpmSync: () => {} }, master: { gain: { value: 0 } },
      setMode: (m: string) => { appliedMode = m; },
      setArrangement: (a: { durationSec?: number }) => { appliedArr = a; },
    } as any;
    const save = {
      schemaVersion: 3, bpm: 130, swing: 0, masterVol: 0.5, kit: '808', wave: 'sawtooth',
      synthParams: {}, sessionState: { lanes: [], scenes: [], globalQuantize: '1/1' },
      mode: 'performance',
      arrangement: { bpm: 130, durationSec: 4, lanes: [], globalAutomation: [] },
    } as any;
    applyLoadedStateV3(save, deps);
    expect(appliedMode).toBe('performance');
    expect(appliedArr?.durationSec).toBe(4);
  });
});
