import { describe, it, expect } from 'vitest';
import { SessionHost } from './session-host';

// SessionHost.toggleMasterFx reflects the flag into the DOM (#master-fx-panel /
// .master-fx-toggle); under vitest's default 'node' env there is no document, so
// stub a minimal one whose lookups return null. The unit asserts ONLY the flag
// (the DOM effect is covered by the Playwright e2e in Tarea 9).
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

function makeDeps(): ConstructorParameters<typeof SessionHost>[0] {
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
    getLaneEngineId: () => 'subtractive',
    ensureLaneVoice: () => null,
    showPolyEditor: () => {},
    setActiveEngineLane: () => {},
    polysynth: {} as never,
    mixerDeps: {} as never,
    midiLabel: () => '',
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
  };
}

describe('SessionHost — master FX panel flag', () => {
  it('masterFxOpen is false by default', () => {
    const host = new SessionHost(makeDeps());
    expect(host.masterFxOpen).toBe(false);
  });

  it('toggleMasterFx() flips the flag false → true → false', () => {
    const host = new SessionHost(makeDeps());
    expect(host.masterFxOpen).toBe(false);
    host.toggleMasterFx();
    expect(host.masterFxOpen).toBe(true);
    host.toggleMasterFx();
    expect(host.masterFxOpen).toBe(false);
  });
});
