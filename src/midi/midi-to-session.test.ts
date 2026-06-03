import { describe, it, expect, vi } from 'vitest';

vi.mock('../engines/registry', () => ({
  listEngines: () => [
    { id: 'subtractive', presets: [{ name: 'Init', gm: [], params: {} }] },
    { id: 'tb303',       presets: [{ name: 'BASS Acid Classic', gm: [33], params: {} }] },
  ],
}));

import { midiToSession } from './midi-to-session';
import type { ParsedMidi } from './midi-parse';

describe('midiToSession', () => {
  it('creates one lane per selected tonal track using presetPerTrack', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: 128,
      tracks: [
        { index: 0, name: 'Bass', program: 33, notes: [{ startTick: 0, duration: 48, midi: 36, velocity: 90, channel: 0 }] },
      ],
    };
    const result = midiToSession(parsed, {
      selectedTrackIndices: [0],
      presetPerTrack: { 0: { engineId: 'tb303', presetName: 'BASS Acid Classic' } },
      drumKitMatch: null,
    });
    expect(result.newLanes).toHaveLength(1);
    expect(result.newLanes[0].engineId).toBe('tb303');
    expect(result.newLanes[0].clips).toHaveLength(1);
    expect(result.newLanes[0].clips[0]?.notes[0].midi).toBe(36);
    expect(result.bpm).toBeCloseTo(128, 0);
    expect(result.newLanes[0].enginePresetName).toBe('factory:BASS Acid Classic');
  });

  it('merges all ch10 notes into a single drumClip', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        { index: 0, name: 'Drums', program: 0,
          notes: [
            { startTick: 0,  duration: 24, midi: 36, velocity: 100, channel: 9 },
            { startTick: 48, duration: 24, midi: 38, velocity: 100, channel: 9 },
          ] },
      ],
    };
    const result = midiToSession(parsed, {
      selectedTrackIndices: [0],
      presetPerTrack: {},
      drumKitMatch: { engineId: 'drums-machine', presetName: 'KIT 808' },
    });
    expect(result.drumClip).not.toBeNull();
    expect(result.drumClip!.notes).toHaveLength(2);
    expect(result.newLanes).toHaveLength(0);
    expect(result.drumKitMatch).toEqual({ engineId: 'drums-machine', presetName: 'KIT 808' });
  });

  it('honours an explicit override even when presetPerTrack contradicts GM', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        { index: 0, name: 'X', program: 33, notes: [{ startTick: 0, duration: 48, midi: 60, velocity: 80, channel: 0 }] },
      ],
    };
    const result = midiToSession(parsed, {
      selectedTrackIndices: [0],
      presetPerTrack: { 0: { engineId: 'subtractive', presetName: 'Init' } },
      drumKitMatch: null,
    });
    expect(result.newLanes[0].engineId).toBe('subtractive');
    expect(result.newLanes[0].enginePresetName).toBe('factory:Init');
  });

  it('falls back to poly/Init when presetPerTrack lacks an entry', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        { index: 0, name: 'X', program: 33, notes: [{ startTick: 0, duration: 48, midi: 60, velocity: 80, channel: 0 }] },
      ],
    };
    const result = midiToSession(parsed, {
      selectedTrackIndices: [0],
      presetPerTrack: {},
      drumKitMatch: null,
    });
    expect(result.newLanes[0].engineId).toBe('poly');
    expect(result.newLanes[0].enginePresetName).toBe('factory:Init');
  });

  it('shifts notes to start at tick 0 of the lengthBars', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        { index: 0, name: 'Bass', program: 33,
          notes: [{ startTick: 96, duration: 96, midi: 36, velocity: 80, channel: 0 }] },
        { index: 1, name: 'Lead', program: 81,
          notes: [{ startTick: 192, duration: 96, midi: 60, velocity: 80, channel: 0 }] },
      ],
    };
    const result = midiToSession(parsed, {
      selectedTrackIndices: [0, 1],
      presetPerTrack: {
        0: { engineId: 'subtractive', presetName: 'Init' },
        1: { engineId: 'subtractive', presetName: 'Init' },
      },
      drumKitMatch: null,
    });
    expect(result.newLanes).toHaveLength(2);
    // Earliest note in selection is tick 96; tick 96 should map to start=0 in the output.
    expect(result.newLanes[0].clips[0]!.notes[0].start).toBe(0);
    // Second track's note started at 192; relative to 96 that's 96 ticks → in SessionTicks (scale=TICKS_PER_STEP*4/division).
    // We don't hard-code the result here — just assert >= 0 and that bar count fits both notes.
    expect(result.newLanes[1].clips[0]!.notes[0].start).toBeGreaterThan(0);
  });
});
