import { describe, it, expect, vi } from 'vitest';
import { SessionHost } from './session-host';
import { rehydrateLane } from './session-host-persistence';
import { mirrorParamChange } from './session-engine-state';
import type { SessionState, SessionLane } from './session';
import { fakeDestinations } from './fake-destinations';

// Minimal DOM stub so SessionHost.render() (which calls document.getElementById)
// is a no-op under the node test environment.
(globalThis as unknown as { document: { getElementById: () => null; querySelector: () => null; querySelectorAll: () => never[] } }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

function makeMinimalDeps(
  applied: string[],
  extra?: Partial<ConstructorParameters<typeof SessionHost>[0]>,
): ConstructorParameters<typeof SessionHost>[0] {
  return {
    // @ts-expect-error — partial deps for unit test
    ctx: { currentTime: 0, resume: () => Promise.resolve() },
    // @ts-expect-error — partial deps
    seq: { bpm: 120, isPlaying: () => false, start: () => {}, sessionMode: true },
    bank: { slots: [] } as never,
    playBtn: { textContent: '' } as never,
    resetAutomationPosition: () => {},
    triggerForLane: () => {},
    drums: {} as never,
    drumLanes: [],
    markTrackActive: () => {},
    ensureExtraPoly: () => ({}) as never,
    extraStrips: {},
    getLaneEngineId: () => 'subtractive',
    ensureLaneVoice: () => null,
    showPolyEditor: () => {},
    polysynth: {} as never,
    mixerDeps: {} as never,
    midiLabel: () => '',
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
    destinations: fakeDestinations(),
    applyPresetForLane: (laneId: string, presetName: string) => {
      applied.push(`${laneId}=${presetName}`);
    },
    ...extra,
  };
}

describe('SessionHost.applyLoadedSessionState — preset application', () => {
  it('calls deps.applyPresetForLane for every lane with enginePresetName', () => {
    const applied: string[] = [];
    const host = new SessionHost(makeMinimalDeps(applied));
    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [
        { inserts: [], id: 'subtractive-1', engineId: 'subtractive', clips: [], enginePresetName: 'engine:PAD Warm' },
        { inserts: [], id: 'subtractive-2', engineId: 'subtractive', clips: [], enginePresetName: 'engine:LEAD Soft Sine' },
        { inserts: [], id: 'tb-303-1',      engineId: 'tb303',       clips: [] /* no preset */ },
      ],
      scenes: [],
      globalQuantize: '1/1',
    };
    host.applyLoadedSessionState(state);
    // enginePresetName already carries the canonical `engine:` prefix — every
    // built-in preset uses one vocabulary.
    expect(applied).toEqual([
      'subtractive-1=engine:PAD Warm',
      'subtractive-2=engine:LEAD Soft Sine',
    ]);
  });
});

// A lane preset is applied by `deps.applyPresetForLane`, and that path MIRRORS
// the preset's base values into `lane.engineState.params` — otherwise a preset
// picked live never reaches a save (nothing else writes those params for a
// melodic lane: `enginePresetName` is only ever set by engine-swap, the drum-kit
// picker and the MIDI importer). On LOAD the same call runs BEFORE
// applyEngineState replays the SAVED params, so an unsuppressed mirror would
// overwrite the very tweak it is about to restore. Both load-time callers must
// therefore apply presets inside `withoutParamMirror`.
//
// SAVED and PRESET below are just two distinguishable markers; the assertion is
// "the value that survives is the one the save carried", never a magnitude.
const SAVED = 0.8;
const PRESET = 0.2;

function laneWithSavedParam(): SessionLane {
  return {
    inserts: [], id: 'subtractive-1', engineId: 'subtractive', clips: [],
    enginePresetName: 'engine:PAD Warm',
    engineState: { params: { 'filter.cutoff': SAVED } },
  };
}

describe('preset application on load leaves the saved params alone', () => {
  it('applyLoadedSessionState: a mirroring applyPresetForLane cannot beat engineState.params', () => {
    let host!: SessionHost;
    const deps = makeMinimalDeps([], {
      // Stands in for the real (mirroring) apply path in main.ts.
      applyPresetForLane: (laneId: string) => {
        mirrorParamChange(host.state, laneId, 'filter.cutoff', PRESET);
      },
    });
    host = new SessionHost(deps);
    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [laneWithSavedParam()],
      scenes: [],
      globalQuantize: '1/1',
    };

    host.applyLoadedSessionState(state);

    expect(host.state.lanes[0].engineState?.params?.['filter.cutoff']).toBe(SAVED);
  });

  it('rehydrateLane (duplicate-lane path): same ordering, same guard', () => {
    const lane = laneWithSavedParam();
    const self = {
      deps: {
        ctx: {} as AudioContext,
        ensureLaneResource: () => {},
        applyPresetForLane: (laneId: string) => {
          mirrorParamChange({ lanes: [lane] } as unknown as SessionState, laneId, 'filter.cutoff', PRESET);
        },
      },
    } as unknown as SessionHost;

    rehydrateLane(self, lane);

    expect(lane.engineState?.params?.['filter.cutoff']).toBe(SAVED);
  });
});

describe('SessionHost.applyLoadedSessionState — silences live voices on load', () => {
  it('calls liveVoices.silenceAll(ctx.currentTime) so a playing audio/stem clip stops on Load/demo-switch', () => {
    const silenceAll = vi.fn();
    const deps = makeMinimalDeps([], {
      // @ts-expect-error — partial ctx for unit test; currentTime is what matters
      ctx: { currentTime: 3.5, resume: () => Promise.resolve() },
      liveVoices: { silenceAll, silenceLane: vi.fn(), record: vi.fn() } as never,
    });
    const host = new SessionHost(deps);
    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [{ inserts: [], id: 'audio-1', engineId: 'audio', clips: [] }],
      scenes: [],
      globalQuantize: '1/1',
    };
    host.applyLoadedSessionState(state);
    expect(silenceAll).toHaveBeenCalledTimes(1);
    expect(silenceAll).toHaveBeenCalledWith(3.5);
  });
});
