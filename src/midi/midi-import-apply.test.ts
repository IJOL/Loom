// Regression: importing a MIDI with "Replace" must FULLY reset the previous
// session (dispose old lane resources + their modulators/LFOs, close open
// editors, stop transport, wipe the arrangement) before seeding the imported
// lanes — exactly like the "New session" button. Before the fix, Replace just
// reassigned session.lanes/scenes, leaving the old engines + modular LFOs alive
// in the LaneResourceMap and the old synth/clip editor open.
//
// "Add" must NOT reset — it appends to the live session.

import { describe, it, expect, vi } from 'vitest';
import { applyMidiImport } from './midi-import-ui';
import type { MidiImportUiDeps } from './midi-import-ui';
import type { ParsedMidi } from './midi-parse';
import type { GMMatch } from './gm-lookup';
import type { SessionState } from '../session/session';

function makeParsed(): ParsedMidi {
  return {
    division: 480,
    bpm: 120,
    tracks: [
      { index: 0, name: 'Bass', program: 33, notes: [
        { startTick: 0, duration: 240, midi: 40, velocity: 100, channel: 0 },
      ] },
    ],
  };
}

function makeDeps(): { deps: MidiImportUiDeps; resetSession: ReturnType<typeof vi.fn>; launchScene: ReturnType<typeof vi.fn> } {
  const session: SessionState = {
    lanes: [{ id: 'old-lane', engineId: 'tb303', clips: [] }],
    scenes: [{ id: 'old-scene', name: 'Old', clipPerLane: {} }],
    globalQuantize: '1/1',
  } as SessionState;
  // The real resetSession (main.ts) routes through applyLoadedSessionState(empty),
  // which clears session.lanes/scenes; mirror that side effect here.
  const resetSession = vi.fn(() => { session.lanes = []; session.scenes = []; });
  const launchScene = vi.fn();
  const deps = {
    session,
    setBpm: vi.fn(),
    setTempoMap: vi.fn(),
    audioContext: {} as AudioContext,
    auditionOutput: {} as AudioNode,
    onSessionChanged: vi.fn(),
    launchScene,
    flashButton: vi.fn(),
    onImported: vi.fn(),
    resetSession,
  } as unknown as MidiImportUiDeps;
  return { deps, resetSession, launchScene };
}

const presetPerTrack: Record<number, GMMatch> = { 0: { engineId: 'subtractive', presetName: 'Init' } };

describe('applyMidiImport', () => {
  it('Replace fully resets the previous session before seeding imported lanes', () => {
    const { deps, resetSession, launchScene } = makeDeps();
    applyMidiImport('replace', makeParsed(), [0], presetPerTrack, deps);

    expect(resetSession, 'resetSession called once on Replace').toHaveBeenCalledTimes(1);
    // Old lane/scene are gone; only the imported lane/scene remain.
    expect(deps.session.lanes.some((l) => l.id === 'old-lane')).toBe(false);
    expect(deps.session.lanes.length).toBe(1);
    expect(deps.session.scenes.length).toBe(1);
    expect(deps.session.scenes[0].id).not.toBe('old-scene');
    expect(launchScene).toHaveBeenCalledTimes(1);
  });

  it('Add appends to the live session without resetting', () => {
    const { deps, resetSession } = makeDeps();
    applyMidiImport('add', makeParsed(), [0], presetPerTrack, deps);

    expect(resetSession, 'resetSession NOT called on Add').not.toHaveBeenCalled();
    expect(deps.session.lanes.some((l) => l.id === 'old-lane'), 'old lane preserved').toBe(true);
    expect(deps.session.lanes.length).toBe(2); // old + imported
    expect(deps.session.scenes.length).toBe(2); // old + imported
  });
});
