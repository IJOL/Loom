import { describe, it, expect } from 'vitest';
import { SessionHost } from './session-host';
import type { SessionState } from './session';

(globalThis as unknown as {
  document: {
    getElementById: () => null;
    querySelector: () => null;
    querySelectorAll: () => never[];
  };
}).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

interface ActiveLaneRecord { laneId: string }

function makeDeps(records: ActiveLaneRecord[], engineByLane: Record<string, string>):
  ConstructorParameters<typeof SessionHost>[0]
{
  return {
    // @ts-expect-error — partial deps for unit test
    ctx: { currentTime: 0, resume: () => Promise.resolve() },
    // @ts-expect-error — partial deps
    seq: { bpm: 120, isPlaying: () => false, start: () => {}, sessionMode: true },
    bank: { slots: [] } as never,
    playBtn: { textContent: '' } as never,
    resetAutomationPosition: () => {},
    triggerForLane: () => {},
    drumLanes: [],
    markTrackActive: () => {},
    ensureExtraPoly: () => ({}) as never,
    extraStrips: {},
    getLaneEngineId: (laneId) => engineByLane[laneId] ?? 'subtractive',
    ensureLaneVoice: () => null,
    showPolyEditor: () => {},
    setActiveEngineLane: (laneId: string) => { records.push({ laneId }); },
    polysynth: {} as never,
    mixerDeps: {} as never,
    midiLabel: () => '',
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
  };
}

describe('SessionHost.onEditLane — active engine lane tracking', () => {
  it('calls setActiveEngineLane with FM lane id when an FM lane inspector is opened', () => {
    const records: ActiveLaneRecord[] = [];
    const host = new SessionHost(makeDeps(records, {
      'subtractive-1': 'subtractive',
      'fm-4-op-1':     'fm',
    }));
    const state: SessionState = {
      lanes: [
        { id: 'subtractive-1', engineId: 'subtractive', clips: [] },
        { id: 'fm-4-op-1',     engineId: 'fm',          clips: [] },
      ],
      scenes: [],
      globalQuantize: '1/1',
    };
    host.applyLoadedSessionState(state);
    (host as unknown as { buildCallbacks(): void }).buildCallbacks();
    const cbs = (host as unknown as { callbacks: { onEditLane(id: string): void } }).callbacks;

    cbs.onEditLane('fm-4-op-1');

    expect(records.map(r => r.laneId)).toContain('fm-4-op-1');
  });

  it('calls setActiveEngineLane for Wavetable lanes too', () => {
    const records: ActiveLaneRecord[] = [];
    const host = new SessionHost(makeDeps(records, {
      'wavetable-1': 'wavetable',
    }));
    host.applyLoadedSessionState({
      lanes: [{ id: 'wavetable-1', engineId: 'wavetable', clips: [] }],
      scenes: [],
      globalQuantize: '1/1',
    });
    (host as unknown as { buildCallbacks(): void }).buildCallbacks();
    const cbs = (host as unknown as { callbacks: { onEditLane(id: string): void } }).callbacks;

    cbs.onEditLane('wavetable-1');

    expect(records.map(r => r.laneId)).toContain('wavetable-1');
  });

  it('calls setActiveEngineLane for Karplus lanes too', () => {
    const records: ActiveLaneRecord[] = [];
    const host = new SessionHost(makeDeps(records, {
      'karplus-1': 'karplus',
    }));
    host.applyLoadedSessionState({
      lanes: [{ id: 'karplus-1', engineId: 'karplus', clips: [] }],
      scenes: [],
      globalQuantize: '1/1',
    });
    (host as unknown as { buildCallbacks(): void }).buildCallbacks();
    const cbs = (host as unknown as { callbacks: { onEditLane(id: string): void } }).callbacks;

    cbs.onEditLane('karplus-1');

    expect(records.map(r => r.laneId)).toContain('karplus-1');
  });
});
