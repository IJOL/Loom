import { describe, it, expect } from 'vitest';
import { SessionHost } from './session-host';
import type { SessionState } from './session';
import { fakeDestinations } from './fake-destinations';

(globalThis as unknown as {
  document: { getElementById: () => null; querySelector: () => null; querySelectorAll: () => never[] };
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
    seq: { bpm: 120, isPlaying: () => false, start: () => {}, sessionMode: true, meter: { num: 4, den: 4 } },
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
    destinations: fakeDestinations(),
  };
}

/** Build a host seeded with one audio "stem" lane in a 'Stems' scene, with
 *  renderWithMixer stubbed so addNoteLane can run without the DOM/mixer. */
function seededHost(): SessionHost {
  const host = new SessionHost(makeDeps());
  const state: SessionState = {
    lanes: [{ id: 'audio-stem-1', engineId: 'audio', clips: [{ id: 'c0', name: 'Drums', lengthBars: 2, notes: [] }] }],
    scenes: [{ id: 'sc-stems', name: 'Stems', clipPerLane: { 'audio-stem-1': 0 } }],
    globalQuantize: '1/1',
  };
  host.applyLoadedSessionState(state);
  (host as unknown as { renderWithMixer(): void }).renderWithMixer = () => {};
  return host;
}

const notes = [{ start: 0, duration: 24, midi: 36, velocity: 100 }];

describe('SessionHost.addNoteLane — transcription scene', () => {
  it('{newScene} lands the lane in a separate "Transcription" scene, at its own row', () => {
    const host = seededHost();
    host.addNoteLane('drums-machine', notes, 2, 'Notes: Drums', { newScene: true });

    const state = (host as unknown as { state: SessionState }).state;
    const tx = state.scenes.find((s) => s.name === 'Transcription');
    expect(tx).toBeTruthy();
    const txIdx = state.scenes.indexOf(tx!);
    expect(txIdx).toBeGreaterThan(0); // after the Stems scene

    const lane = state.lanes.find((l) => l.engineId === 'drums-machine')!;
    // Clip sits at the transcription scene's row; earlier rows are empty cells.
    expect(lane.clips[txIdx]).toBeTruthy();
    expect(lane.clips[0]).toBeNull();
    // Plays ONLY in the transcription scene (null everywhere else).
    expect(tx!.clipPerLane[lane.id]).toBe(txIdx);
    expect(state.scenes[0].clipPerLane[lane.id]).toBeNull();
  });

  it('a whole batch of {newScene} lanes shares ONE transcription scene', () => {
    const host = seededHost();
    host.addNoteLane('subtractive', notes, 2, 'Notes: Vocals', { newScene: true });
    host.addNoteLane('drums-machine', notes, 2, 'Notes: Drums', { newScene: true });

    const state = (host as unknown as { state: SessionState }).state;
    const tx = state.scenes.filter((s) => s.name === 'Transcription');
    expect(tx.length).toBe(1); // exactly one shared scene
    const txIdx = state.scenes.indexOf(tx[0]);
    const txLanes = state.lanes.filter((l) => l.id !== 'audio-stem-1');
    expect(txLanes.length).toBe(2);
    for (const l of txLanes) {
      expect(tx[0].clipPerLane[l.id]).toBe(txIdx);
      expect(l.clips[txIdx]).toBeTruthy();
    }
  });

  it('resetTranscriptionScene starts a fresh scene for the next batch', () => {
    const host = seededHost();
    host.addNoteLane('subtractive', notes, 2, 'Notes: A', { newScene: true });
    host.resetTranscriptionScene();
    host.addNoteLane('subtractive', notes, 2, 'Notes: B', { newScene: true });

    const state = (host as unknown as { state: SessionState }).state;
    expect(state.scenes.filter((s) => s.name === 'Transcription').length).toBe(2);
  });

  it('without {newScene} the lane launches alongside scene 0 (chords flow, unchanged)', () => {
    const host = seededHost();
    host.addNoteLane('subtractive', notes, 2, 'Chord', {});

    const state = (host as unknown as { state: SessionState }).state;
    expect(state.scenes.some((s) => s.name === 'Transcription')).toBe(false);
    const lane = state.lanes.find((l) => l.id !== 'audio-stem-1')!;
    expect(state.scenes[0].clipPerLane[lane.id]).toBe(0);
    expect(lane.clips[0]).toBeTruthy();
  });
});
