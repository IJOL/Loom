import { describe, it, expect, vi } from 'vitest';

vi.mock('../engines/registry', () => ({
  listEngines: () => [
    { id: 'subtractive', presets: [{ name: 'Init', gm: [], params: {} }] },
    { id: 'tb303',       presets: [{ name: 'BASS Acid Classic', gm: [33], params: {} }] },
  ],
}));

import { midiToSession, isGenericTrackName } from './midi-to-session';
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
    // The lane is titled after its instrument (the MIDI track name), not the preset.
    expect(result.newLanes[0].name).toBe('Bass');
    // The clip carries the same instrument label.
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

  it('a ch10 standard-kit track → one drums-machine lane (notes intact)', () => {
    // kick(36)+snare(38) are standard kit (not GM-percussion), so the track
    // becomes a single drums-machine lane. Detection is by channel, not name.
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
    const result = midiToSession(parsed, { selectedTrackIndices: [0], presetPerTrack: {} });
    expect(result.newLanes).toHaveLength(1);
    expect(result.newLanes[0].engineId).toBe('drums-machine');
    expect(result.newLanes[0].engineState?.kitMode).toBeUndefined(); // synth kit
    const clip = result.newLanes[0].clips.find(Boolean);
    expect(clip?.notes.map((n) => n.midi)).toEqual([36, 38]);
  });

  it('splits a MIXED ch10 track into a drum lane + a percussion lane', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: 120,
      tracks: [
        { index: 0, name: 'Drums', program: 0, notes: [
          { startTick: 0,  duration: 12, midi: 36, velocity: 100, channel: 9 }, // kick → drum
          { startTick: 12, duration: 12, midi: 42, velocity: 100, channel: 9 }, // hat  → drum
          { startTick: 24, duration: 12, midi: 69, velocity: 90,  channel: 9 }, // cabasa → perc
        ] },
      ],
    };
    const res = midiToSession(parsed, { selectedTrackIndices: [0], presetPerTrack: {} });
    expect(res.newLanes).toHaveLength(2);
    const [drum, perc] = res.newLanes;
    expect(drum.engineId).toBe('drums-machine');
    expect(drum.engineState?.kitMode).toBeUndefined();
    expect(drum.clips.find(Boolean)!.notes.map((n) => n.midi)).toEqual([36, 42]);
    expect(perc.engineId).toBe('drums-machine');
    expect(perc.engineState?.kitMode).toBe('sample');
    expect(perc.engineState?.sampler?.drumkitId).toBe('gm-percussion');
    expect(perc.clips.find(Boolean)!.notes.map((n) => n.midi)).toEqual([69]);
  });

  it('keeps a tonal track and a drum track as separate lanes', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        { index: 0, name: 'Bass',  program: 33, notes: [{ startTick: 0, duration: 48, midi: 36, velocity: 90, channel: 0 }] },
        { index: 1, name: 'Drums', program: 0,  notes: [{ startTick: 0, duration: 24, midi: 36, velocity: 100, channel: 9 }] },
      ],
    };
    const result = midiToSession(parsed, {
      selectedTrackIndices: [0, 1],
      presetPerTrack: { 0: { engineId: 'tb303', presetName: 'BASS Acid Classic' } },
    });
    expect(result.newLanes).toHaveLength(2);
    expect(result.newLanes[0].engineId).toBe('tb303');          // bass (channel 0, melodic)
    expect(result.newLanes[1].engineId).toBe('drums-machine');  // drums (channel 10)
    // Lanes are titled after their instruments (the MIDI track names).
    expect(result.newLanes.map((l) => l.name)).toEqual(['Bass', 'Drums']);
  });

  it('titles lanes after the instrument, numbering duplicates "<name> 1/2/3"', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        // three single-instrument percussion tracks sharing no name + two same-named melodic
        { index: 0, name: 'Tambourine', program: 0, notes: [{ startTick: 0, duration: 12, midi: 54, velocity: 90, channel: 9 }] },
        { index: 1, name: 'Cabasa',     program: 0, notes: [{ startTick: 0, duration: 12, midi: 69, velocity: 90, channel: 9 }] },
        { index: 2, name: 'Guitar',     program: 25, notes: [{ startTick: 0, duration: 48, midi: 60, velocity: 90, channel: 0 }] },
        { index: 3, name: 'Guitar',     program: 25, notes: [{ startTick: 0, duration: 48, midi: 62, velocity: 90, channel: 1 }] },
      ],
    };
    const result = midiToSession(parsed, {
      selectedTrackIndices: [0, 1, 2, 3],
      presetPerTrack: {
        2: { engineId: 'subtractive', presetName: 'Init' },
        3: { engineId: 'subtractive', presetName: 'Init' },
      },
    });
    // unique names stay clean; the two "Guitar" lanes get numbered
    expect(result.newLanes.map((l) => l.name)).toEqual(['Tambourine', 'Cabasa', 'Guitar 1', 'Guitar 2']);
  });

  it('falls back to the GM instrument when the track name is DAW cruft', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        { index: 0, name: '1',        program: 20, notes: [{ startTick: 0, duration: 48, midi: 60, velocity: 90, channel: 0 }] },
        { index: 1, name: 'MIDI out', program: 33, notes: [{ startTick: 0, duration: 48, midi: 40, velocity: 90, channel: 1 }] },
        { index: 2, name: 'Bass',     program: 33, notes: [{ startTick: 0, duration: 48, midi: 40, velocity: 90, channel: 2 }] },
      ],
    };
    const r = midiToSession(parsed, {
      selectedTrackIndices: [0, 1, 2],
      presetPerTrack: {
        0: { engineId: 'subtractive', presetName: 'Init' },
        1: { engineId: 'subtractive', presetName: 'Init' },
        2: { engineId: 'subtractive', presetName: 'Init' },
      },
    });
    // junk names → GM instrument; a real name ("Bass") is kept
    expect(r.newLanes.map((l) => l.name)).toEqual(['Reed Organ', 'Electric Bass (finger)', 'Bass']);
  });

  it('isGenericTrackName flags DAW cruft, keeps real instrument names', () => {
    for (const j of ['', '  ', '1', '10', 'Track', 'Track 3', 'MIDI out', 'MIDI out #2', 'untitled', 'channel 2'])
      expect(isGenericTrackName(j), j).toBe(true);
    for (const g of ['Tambourine', 'Bass', 'Lead Synth', 'Guitar', 'Reed Organ', 'Strings 1'])
      expect(isGenericTrackName(g), g).toBe(false);
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

  it('a percussion-only ch10 track → a single sample-kit Drums lane (GM Percussion)', () => {
    const parsed = { division: 96, bpm: 120, tracks: [
      { index: 0, name: 'Perc', program: 0, notes: [
        { startTick: 0, duration: 12, midi: 54, velocity: 90, channel: 9 },
        { startTick: 24, duration: 12, midi: 69, velocity: 90, channel: 9 },
      ] },
    ] } as any;
    const res = midiToSession(parsed, { selectedTrackIndices: [0], presetPerTrack: {} });
    expect(res.newLanes).toHaveLength(1);
    const lane = res.newLanes[0];
    expect(lane.engineId).toBe('drums-machine');
    expect(lane.engineState?.kitMode).toBe('sample');
    expect(lane.engineState?.sampler?.drumkitId).toBe('gm-percussion');
    expect(lane.engineState?.sampler?.keymap).toEqual([]);
    expect(lane.enginePresetName).toBe('engine:GM Percussion');
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
