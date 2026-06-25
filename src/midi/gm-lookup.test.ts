import { describe, it, expect, vi } from 'vitest';

vi.mock('../engines/registry', () => ({
  listEngines: () => [
    { id: 'subtractive', presets: [{ name: 'S1', gm: [33, 81], params: {} }, { name: 'S2', gm: [33], params: {} }] },
    { id: 'tb303',       presets: [{ name: 'T1', gm: [33],     params: {} }, { name: 'T2', gm: [81], params: {} }] },
    { id: 'drums-machine', presets: [{ name: 'KIT Standard', gm: [0], params: {} }, { name: 'KIT 808', gm: [25], params: {} }] },
  ],
}));

import { findGMMatches, firstMatchForGM, firstMelodicMatchForGM, pickPresetForGM, suggestDefaultMapping, isPercussionTrack, looksMelodic, isDrumkitTrack } from './gm-lookup';
import type { ParsedMidi } from './midi-parse';

const note = (midi: number, channel: number) => ({ startTick: 0, duration: 1, midi, velocity: 80, channel });
const pTrack = (index: number, name: string, notes: any[]) => ({ index, name, program: 0, notes });

describe('looksMelodic / isDrumkitTrack', () => {
  it('looksMelodic accepts melodic names, rejects percussion ones', () => {
    for (const m of ['melody 1', 'Bassline', 'Chords 2', 'Lead Synth', 'Pad 3', 'Strings', 'Piano'])
      expect(looksMelodic(m), m).toBe(true);
    for (const p of ['bassdrum', 'cymbal', 'Drumkit', 'Snare', 'Hi-Hat', 'Conga', 'kick', ''])
      expect(looksMelodic(p), p).toBe(false);
  });
  it('a channel-10 track with a melodic name is NOT a drum kit (e.g. melody on ch10)', () => {
    expect(isDrumkitTrack(pTrack(0, 'melody 1', [note(60, 9), note(64, 9), note(67, 9)]))).toBe(false);
    expect(isDrumkitTrack(pTrack(0, 'Drums', [note(36, 9), note(38, 9)]))).toBe(true);
    expect(isDrumkitTrack(pTrack(0, 'Lead', [note(60, 0)]))).toBe(false); // melodic channel
  });
  it('firstMelodicMatchForGM never returns a drum kit (program 0 is tagged on KIT presets)', () => {
    expect(firstMelodicMatchForGM(0).engineId).not.toBe('drums-machine');
  });
  it('a melodic track (program 0, no program) does NOT auto-map to a drum kit', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: 120,
      tracks: [pTrack(0, 'melody 1', [note(60, 0), note(64, 0), note(67, 0)])],
    } as any;
    const { presetPerTrack } = suggestDefaultMapping(parsed, [0]);
    expect(presetPerTrack[0].engineId).not.toBe('drums-machine');
  });
});

describe('isPercussionTrack', () => {
  it('true when the majority of notes are on channel 9', () => {
    expect(isPercussionTrack(pTrack(0, 'Drums', [note(36, 9), note(38, 9), note(60, 9)]))).toBe(true);
  });
  it('false for a melodic track', () => {
    expect(isPercussionTrack(pTrack(1, 'Bass', [note(40, 0), note(43, 0)]))).toBe(false);
  });
});

describe('suggestDefaultMapping percussion default', () => {
  it('assigns the GM Percussion drumkit to a channel-9 track', () => {
    const parsed = { division: 96, bpm: 120, tracks: [pTrack(0, 'Drums', [note(36, 9), note(42, 9)])] } as any;
    const { presetPerTrack } = suggestDefaultMapping(parsed, [0]);
    expect(presetPerTrack[0]).toMatchObject({ engineId: 'sampler', presetName: 'GM Percussion', drumkitId: 'gm-percussion' });
  });
});

describe('findGMMatches', () => {
  it('returns every preset across engines tagged with the program', () => {
    const matches = findGMMatches(33);
    expect(matches).toHaveLength(3);
    expect(matches).toEqual(expect.arrayContaining([
      { engineId: 'subtractive', presetName: 'S1' },
      { engineId: 'subtractive', presetName: 'S2' },
      { engineId: 'tb303', presetName: 'T1' },
    ]));
  });

  it('returns empty for unmatched program', () => {
    expect(findGMMatches(127)).toEqual([]);
  });
});

describe('firstMatchForGM', () => {
  it('returns the first match across engines', () => {
    expect(firstMatchForGM(81)).toEqual({ engineId: 'subtractive', presetName: 'S1' });
  });

  it('falls back to poly/Init when no match', () => {
    expect(firstMatchForGM(127)).toEqual({ engineId: 'poly', presetName: 'Init' });
  });
});

describe('pickPresetForGM', () => {
  it('picks the first match when rng returns 0', () => {
    expect(pickPresetForGM(81, () => 0.0)).toEqual({ engineId: 'subtractive', presetName: 'S1' });
  });

  it('picks the second match when rng returns 0.99', () => {
    expect(pickPresetForGM(81, () => 0.99)).toEqual({ engineId: 'tb303', presetName: 'T2' });
  });

  it('falls back to poly/Init when no match', () => {
    expect(pickPresetForGM(127, () => 0)).toEqual({ engineId: 'poly', presetName: 'Init' });
  });
});

describe('suggestDefaultMapping', () => {
  const parsed: ParsedMidi = {
    division: 96, bpm: null,
    tracks: [
      { index: 0, name: 'Bass',  program: 33, notes: [{ startTick: 0, duration: 48, midi: 36, velocity: 90, channel: 0 }] },
      { index: 1, name: 'Lead',  program: 81, notes: [{ startTick: 0, duration: 48, midi: 60, velocity: 90, channel: 0 }] },
      { index: 2, name: 'Drums', program: 25, notes: [{ startTick: 0, duration: 12, midi: 36, velocity: 100, channel: 9 }] },
    ],
  };

  it('builds a presetPerTrack from first matches', () => {
    const result = suggestDefaultMapping(parsed, [0, 1]);
    expect(result.presetPerTrack[0]).toEqual({ engineId: 'subtractive', presetName: 'S1' });
    expect(result.presetPerTrack[1]).toEqual({ engineId: 'subtractive', presetName: 'S1' });
  });

  it('routes a channel-9 drum track to the GM Percussion sample kit', () => {
    // Channel 10 (0-based 9) is the GM percussion channel: such a track now
    // defaults to the GM Percussion sampler drumkit so its drum notes sound,
    // overriding any name hint / program lookup.
    const result = suggestDefaultMapping(parsed, [2]);
    expect(result.presetPerTrack[2]).toEqual({ engineId: 'sampler', presetName: 'GM Percussion', drumkitId: 'gm-percussion' });
  });

  it('maps every selected track, drum-channel included', () => {
    const result = suggestDefaultMapping(parsed, [0, 1, 2]);
    expect(Object.keys(result.presetPerTrack)).toEqual(['0', '1', '2']);
    expect(result.presetPerTrack[2]).toEqual({ engineId: 'sampler', presetName: 'GM Percussion', drumkitId: 'gm-percussion' });
  });

  it('ignores indices not present in parsed.tracks', () => {
    const result = suggestDefaultMapping(parsed, [99]);
    expect(result.presetPerTrack).toEqual({});
  });
});
