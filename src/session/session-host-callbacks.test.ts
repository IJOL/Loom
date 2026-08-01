// @vitest-environment jsdom
// Regression: session-host-callbacks.ts's onCellClick used to gate the
// audio-vs-notes empty-cell behaviour on `lane.engineId === 'audio'` — the
// LAST spot on the clip path that recognised an audio channel by its literal
// engine id instead of what it declares via the capability door
// (src/plugins/capabilities.ts). A plugin engine whose manifest declares
// `capabilities.clipContent: 'audio'` but whose id is NOT `'audio'` (e.g.
// `audio-probe`) fell through to the notes branch: clicking an empty cell
// created a piano-roll note clip on a lane that can never play one, instead
// of opening the file picker.
import { describe, it, expect } from 'vitest';
import { SessionHost } from './session-host';
import type { SessionState } from './session';
import type { SessionInspector } from './session-inspector';
import { fakeDestinations } from './fake-destinations';
import { registerEngineCapabilities } from '../plugins/capabilities';

// The whole point of this id: it is NOT 'audio', so any check that pattern-
// matches on the literal engine id (instead of asking the capability door)
// would misclassify this lane as a notes lane.
const PLUGIN_AUDIO_ENGINE_ID = 'test-plugin-audio-engine';
registerEngineCapabilities(PLUGIN_AUDIO_ENGINE_ID, {
  clipContent: 'audio', shortLabel: 'tpa', outputTrim: 1,
});

function makeHost(): SessionHost {
  const host = new SessionHost({
    // @ts-expect-error — partial deps for unit test
    ctx: { currentTime: 0, resume: () => Promise.resolve() },
    // @ts-expect-error — partial deps
    seq: { bpm: 120, length: 16, meter: { num: 4, den: 4 }, isPlaying: () => false, start: () => {} },
    playBtn: { classList: { add: () => {} } } as never,
    resetAutomationPosition: () => {},
    triggerForLane: () => {},
    drumLanes: [],
    markTrackActive: () => {},
    extraStrips: {},
    getLaneEngineId: () => PLUGIN_AUDIO_ENGINE_ID,
    ensureLaneVoice: () => null,
    mixerDeps: {} as never,
    midiLabel: () => '',
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
    destinations: fakeDestinations(),
  });
  // The notes-branch (the pre-fix bug path) reaches into the inspector; the
  // audio-branch (the fix) never touches it. Stubbing it lets this test fail
  // on the REAL assertion (a note clip got created) instead of crashing on
  // an unrelated undefined-inspector TypeError either way.
  host.inspector = {
    setSelectedClip() {}, openInspector() {},
  } as unknown as SessionInspector;
  const state: SessionState = {
    name: 'Test', masterInserts: [],
    musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false },
    sends: [],
    lanes: [{ inserts: [], id: 'plugin-audio-1', engineId: PLUGIN_AUDIO_ENGINE_ID, clips: [] }],
    scenes: [{ id: 's1', name: 'Scene 1', clipPerLane: {} }],
    globalQuantize: '1/1',
  };
  host.applyLoadedSessionState(state);
  (host as unknown as { buildCallbacks(): void }).buildCallbacks();
  return host;
}

describe('onCellClick — a plugin audio-channel engine (id != "audio")', () => {
  it('opens the file picker, not a note clip, for an empty cell', () => {
    const host = makeHost();
    const cbs = (host as unknown as {
      callbacks: { onCellClick(laneId: string, clipIdx: number): void };
    }).callbacks;

    const inputsBefore = document.body.querySelectorAll('input[type="file"]').length;
    cbs.onCellClick('plugin-audio-1', 0);

    // The bug: onCellClick fell through to the notes branch and placed an
    // empty note clip via placeClipEnsuringScene.
    const lane = host.state.lanes.find((l) => l.id === 'plugin-audio-1')!;
    expect(lane.clips[0]).toBeFalsy();

    // The fix: the audio branch appended a hidden file-picker <input> instead.
    const inputsAfter = document.body.querySelectorAll('input[type="file"]').length;
    expect(inputsAfter).toBe(inputsBefore + 1);
  });
});
