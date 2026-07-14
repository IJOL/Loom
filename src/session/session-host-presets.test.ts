import { describe, it, expect, vi } from 'vitest';
import { SessionHost } from './session-host';
import type { SessionState } from './session';

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
    const state: SessionState = {
      lanes: [
        { id: 'subtractive-1', engineId: 'subtractive', clips: [], enginePresetName: 'factory:PAD Warm' },
        { id: 'subtractive-2', engineId: 'subtractive', clips: [], enginePresetName: 'factory:LEAD Soft Sine' },
        { id: 'tb-303-1',      engineId: 'tb303',       clips: [] /* no preset */ },
      ],
      scenes: [],
      globalQuantize: '1/1',
    };
    host.applyLoadedSessionState(state);
    // The load-time migration canonicalises `factory:` → `engine:` (built-in
    // presets share one vocabulary), so applyPresetForLane sees `engine:`.
    expect(applied).toEqual([
      'subtractive-1=engine:PAD Warm',
      'subtractive-2=engine:LEAD Soft Sine',
    ]);
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
    const state: SessionState = {
      lanes: [{ id: 'audio-1', engineId: 'audio', clips: [] }],
      scenes: [],
      globalQuantize: '1/1',
    };
    host.applyLoadedSessionState(state);
    expect(silenceAll).toHaveBeenCalledTimes(1);
    expect(silenceAll).toHaveBeenCalledWith(3.5);
  });
});
