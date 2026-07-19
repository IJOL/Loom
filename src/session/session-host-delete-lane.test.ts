// src/session/session-host-delete-lane.test.ts
//
// Covers review Finding 2: onDeleteLane mutates state.lanes and disposes the
// lane's audio resources directly (it does not route through
// ensureLaneResource/swapLaneEngine), so nothing invalidated the automation
// destination registry after a lane delete — pickers kept offering destinations
// for a lane that no longer exists.
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

function makeDeps(onDestinationsChanged?: () => void):
  ConstructorParameters<typeof SessionHost>[0]
{
  return {
    // @ts-expect-error — partial deps for unit test
    ctx: { currentTime: 0, resume: () => Promise.resolve() },
    // @ts-expect-error — partial deps
    seq: { bpm: 120, isPlaying: () => false, start: () => {}, sessionMode: true },
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
    laneResources: { dispose: () => {}, ids: () => [], get: () => undefined } as never,
    onDestinationsChanged,
  };
}

function makeState(): SessionState {
  return {
    lanes: [
      { id: 'subtractive-1', engineId: 'subtractive', clips: [] },
    ],
    scenes: [],
    globalQuantize: '1/1',
  };
}

describe('SessionHost.onDeleteLane — announces destination-set changes', () => {
  it('calls onDestinationsChanged after deleting a lane with no content (no confirm needed)', async () => {
    let calls = 0;
    const onDestinationsChanged = () => { calls++; };
    const host = new SessionHost(makeDeps(onDestinationsChanged));
    host.applyLoadedSessionState(makeState());
    (host as unknown as { buildCallbacks(): void }).buildCallbacks();
    const cbs = (host as unknown as { callbacks: { onDeleteLane(id: string): Promise<void> } }).callbacks;

    // applyLoadedSessionState itself announces once at the end of load — reset
    // the counter so this assertion is specific to onDeleteLane's own announce,
    // not a false positive carried over from the setup call above.
    calls = 0;

    await cbs.onDeleteLane('subtractive-1');

    expect(host.state.lanes.find((l) => l.id === 'subtractive-1')).toBeUndefined();
    expect(calls).toBeGreaterThan(0);
  });
});
