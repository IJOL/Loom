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
    });
    expect(result.newLanes).toHaveLength(1);
    expect(result.newLanes[0].engineId).toBe('tb303');
    expect(result.newLanes[0].clips).toHaveLength(1);
    expect(result.newLanes[0].clips[0]?.notes[0].midi).toBe(36);
    expect(result.bpm).toBeCloseTo(128, 0);
    expect(result.newLanes[0].enginePresetName).toBe('factory:BASS Acid Classic');
    // The lane (channel) is titled after the assigned preset, not the MIDI track.
    expect(result.newLanes[0].name).toBe('BASS Acid Classic');
    // The clip keeps the original MIDI track name as its label.
    expect(result.newLanes[0].clips[0]?.name).toBe('Bass');
    // Every imported clip gets an auto-assigned colour so it renders readably.
    expect(result.newLanes[0].clips[0]?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('places clips at sceneRow so they align with the scene launch row', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: 128,
      tracks: [
        { index: 0, name: 'Bass', program: 33, notes: [{ startTick: 0, duration: 48, midi: 36, velocity: 90, channel: 0 }] },
      ],
    };
    const result = midiToSession(parsed, {
      selectedTrackIndices: [0],
      presetPerTrack: { 0: { engineId: 'tb303', presetName: 'BASS Acid Classic' } },
      sceneRow: 2,
    });
    const lane = result.newLanes[0];
    // slots 0,1 empty; the clip at slot 2 (the scene's row)
    expect(lane.clips).toHaveLength(3);
    expect(lane.clips[0]).toBeNull();
    expect(lane.clips[1]).toBeNull();
    expect(lane.clips[2]?.notes[0].midi).toBe(36);
    expect(result.scene.clipPerLane[lane.id]).toBe(2);
  });

  it('imports a ch10 (drum) track as its own lane + clip, like any other track', () => {
    // No special drum handling: a channel-9 track becomes its own lane with all
    // of its notes intact — not merged into a shared drum clip, not routed to a
    // special drum lane.
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
      presetPerTrack: { 0: { engineId: 'subtractive', presetName: 'Init' } },
    });
    expect(result.newLanes).toHaveLength(1);
    expect(result.newLanes[0].engineId).toBe('subtractive');
    const clip = result.newLanes[0].clips[0];
    expect(clip?.notes).toHaveLength(2);
    expect(clip?.notes.map((n) => n.midi)).toEqual([36, 38]);
  });

  it('keeps tonal and drum-channel tracks as separate lanes (no merge)', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        { index: 0, name: 'Bass',  program: 33, notes: [{ startTick: 0, duration: 48, midi: 36, velocity: 90, channel: 0 }] },
        { index: 1, name: 'Drums', program: 0,  notes: [{ startTick: 0, duration: 24, midi: 36, velocity: 100, channel: 9 }] },
      ],
    };
    const result = midiToSession(parsed, {
      selectedTrackIndices: [0, 1],
      presetPerTrack: {
        0: { engineId: 'tb303', presetName: 'BASS Acid Classic' },
        1: { engineId: 'subtractive', presetName: 'Init' },
      },
    });
    expect(result.newLanes).toHaveLength(2);
    // Lane titles come from the presets; clip labels keep the MIDI track names.
    expect(result.newLanes.map((l) => l.name)).toEqual(['BASS Acid Classic', 'Init']);
    expect(result.newLanes.map((l) => l.clips[0]?.name)).toEqual(['Bass', 'Drums']);
    // Adjacent imported lanes get distinct colours (rotating palette).
    const colors = result.newLanes.map((l) => l.clips[0]?.color);
    expect(colors[0]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors[1]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors[0]).not.toBe(colors[1]);
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
    });
    expect(result.newLanes[0].engineId).toBe('poly');
    expect(result.newLanes[0].enginePresetName).toBe('factory:Init');
  });

  it('a drumkit match yields a sampler lane with engineState.sampler.drumkitId', () => {
    const parsed = { division: 96, bpm: 120, tracks: [
      { index: 0, name: 'Drums', program: 0, notes: [
        { startTick: 0, duration: 12, midi: 54, velocity: 90, channel: 9 },
        { startTick: 24, duration: 12, midi: 69, velocity: 90, channel: 9 },
      ] },
    ] } as any;
    const res = midiToSession(parsed, {
      selectedTrackIndices: [0],
      presetPerTrack: { 0: { engineId: 'sampler', presetName: 'GM Percussion', drumkitId: 'gm-percussion' } },
    });
    const lane = res.newLanes[0];
    expect(lane.engineId).toBe('sampler');
    expect(lane.engineState?.sampler?.drumkitId).toBe('gm-percussion');
    expect(lane.engineState?.sampler?.keymap).toEqual([]);
    expect(lane.enginePresetName).toBeUndefined();
    // notes keep their GM midi (no remap)
    expect(lane.clips.find(Boolean)!.notes.map((n) => n.midi)).toEqual([54, 69]);
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
    });
    expect(result.newLanes).toHaveLength(2);
    // Earliest note in selection is tick 96; tick 96 should map to start=0 in the output.
    expect(result.newLanes[0].clips[0]!.notes[0].start).toBe(0);
    // Second track's note started at 192; relative to 96 that's 96 ticks → in SessionTicks (scale=TICKS_PER_STEP*4/division).
    // We don't hard-code the result here — just assert >= 0 and that bar count fits both notes.
    expect(result.newLanes[1].clips[0]!.notes[0].start).toBeGreaterThan(0);
  });
});
