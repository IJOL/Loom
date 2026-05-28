import { describe, it, expect } from 'vitest';
import { SessionHost } from './session-host';
import type { SessionState } from './session';

// Minimal DOM stub so SessionHost.render() (which calls document.getElementById)
// is a no-op under the node test environment.
(globalThis as unknown as { document: { getElementById: () => null; querySelector: () => null; querySelectorAll: () => never[] } }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

function makeMinimalDeps(applied: string[]): ConstructorParameters<typeof SessionHost>[0] {
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
    expect(applied).toEqual([
      'subtractive-1=factory:PAD Warm',
      'subtractive-2=factory:LEAD Soft Sine',
    ]);
  });
});

describe('SessionHost onLaunchScene — preset application', () => {
  it('applies scene.presetPerLane when a scene is launched', () => {
    const applied: string[] = [];
    const host = new SessionHost(makeMinimalDeps(applied));
    host.applyLoadedSessionState({
      lanes: [
        { id: 'subtractive-1', engineId: 'subtractive', clips: [] },
      ],
      scenes: [
        {
          id: 's1', name: 'A', clipPerLane: {},
          presetPerLane: { 'subtractive-1': 'factory:LEAD Bright Saw' },
        },
      ],
      globalQuantize: '1/1',
    });
    // Drop the boot-time applies (none in this state) and the launch's call.
    applied.length = 0;
    // Build callbacks without going through init() (which touches the DOM toolbar).
    (host as unknown as { buildCallbacks(): void }).buildCallbacks();
    // Reach into the host's callbacks to launch scene 0 without rendering DOM.
    const cbs = (host as unknown as { callbacks: { onLaunchScene(i: number): void } }).callbacks;
    cbs.onLaunchScene(0);
    expect(applied).toEqual(['subtractive-1=factory:LEAD Bright Saw']);
  });
});
