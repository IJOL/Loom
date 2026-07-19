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

function makeDeps(): { deps: MidiImportUiDeps; resetSession: ReturnType<typeof vi.fn>; launchScene: ReturnType<typeof vi.fn>; prepareLanes: ReturnType<typeof vi.fn>; order: string[] } {
  const session: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
    lanes: [{ id: 'old-lane', engineId: 'tb303', clips: [], inserts: [] }],
    scenes: [{ id: 'old-scene', name: 'Old', clipPerLane: {} }],
    globalQuantize: '1/1',
  };
  // The real resetSession (main.ts) routes through applyLoadedSessionState(empty),
  // which clears session.lanes/scenes; mirror that side effect here.
  const resetSession = vi.fn(() => { session.lanes = []; session.scenes = []; });
  const launchScene = vi.fn();
  // Record the order of the resource/render/launch steps so we can assert lane
  // resources are allocated (prepareLanes) BEFORE the mixer renders.
  const order: string[] = [];
  const prepareLanes = vi.fn(() => { order.push('prepareLanes'); });
  const onSessionChanged = vi.fn(() => { order.push('onSessionChanged'); });
  const deps = {
    session,
    setBpm: vi.fn(),
    setTempoMap: vi.fn(),
    audioContext: {} as AudioContext,
    auditionOutput: {} as AudioNode,
    onSessionChanged,
    launchScene: vi.fn(() => { order.push('launchScene'); launchScene(); }),
    flashButton: vi.fn(),
    onImported: vi.fn(),
    resetSession,
    prepareLanes,
  } as unknown as MidiImportUiDeps;
  return { deps, resetSession, launchScene, prepareLanes, order };
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

  // Regression: renderWithMixer (onSessionChanged) asks the allocator for every
  // lane's strip and THROWS on a missing one. The new lanes only get resources in
  // prepareLanes, so it must run BEFORE onSessionChanged or the import crashes at
  // stripFor (Replace's full reset disposes the old resources that used to mask it).
  for (const action of ['replace', 'add'] as const) {
    it(`${action}: allocates lane resources (prepareLanes) before rendering (onSessionChanged)`, () => {
      const { deps, prepareLanes, order } = makeDeps();
      applyMidiImport(action, makeParsed(), [0], presetPerTrack, deps);
      expect(prepareLanes).toHaveBeenCalledTimes(1);
      expect(order.indexOf('prepareLanes')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('prepareLanes')).toBeLessThan(order.indexOf('onSessionChanged'));
    });
  }
});
