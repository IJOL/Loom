import { describe, it, expect, vi } from 'vitest';

vi.mock('../engines/registry', () => ({
  listEngines: () => [
    { id: 'subtractive', presets: [{ name: 'S1', gm: [33, 81], params: {} }, { name: 'S2', gm: [33], params: {} }] },
    { id: 'tb303',       presets: [{ name: 'T1', gm: [33],     params: {} }, { name: 'T2', gm: [81], params: {} }] },
    { id: 'drums-machine', presets: [{ name: 'KIT Standard', gm: [0], params: {} }, { name: 'KIT 808', gm: [25], params: {} }] },
  ],
}));

import { findGMMatches, firstMatchForGM, pickPresetForGM, firstDrumKitForGM, pickDrumKitForGM, suggestDefaultMapping } from './gm-lookup';
import type { ParsedMidi } from './midi-parse';

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

describe('firstDrumKitForGM', () => {
  it('only returns drums-engine matches', () => {
    expect(firstDrumKitForGM(0)).toEqual({ engineId: 'drums-machine', presetName: 'KIT Standard' });
  });

  it('falls back to KIT Standard when no match', () => {
    expect(firstDrumKitForGM(99)).toEqual({ engineId: 'drums-machine', presetName: 'KIT Standard' });
  });
});

describe('pickDrumKitForGM', () => {
  it('picks a drums match', () => {
    expect(pickDrumKitForGM(25, () => 0)).toEqual({ engineId: 'drums-machine', presetName: 'KIT 808' });
  });

  it('falls back to KIT Standard', () => {
    expect(pickDrumKitForGM(99, () => 0)).toEqual({ engineId: 'drums-machine', presetName: 'KIT Standard' });
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
    expect(result.drumKitMatch).toBeNull();
  });

  it('routes drum-channel tracks to drumKitMatch instead of presetPerTrack', () => {
    const result = suggestDefaultMapping(parsed, [2]);
    expect(result.presetPerTrack[2]).toBeUndefined();
    expect(result.drumKitMatch).toEqual({ engineId: 'drums-machine', presetName: 'KIT 808' });
  });

  it('handles selection of all tracks', () => {
    const result = suggestDefaultMapping(parsed, [0, 1, 2]);
    expect(Object.keys(result.presetPerTrack)).toEqual(['0', '1']);
    expect(result.drumKitMatch).toEqual({ engineId: 'drums-machine', presetName: 'KIT 808' });
  });

  it('ignores indices not present in parsed.tracks', () => {
    const result = suggestDefaultMapping(parsed, [99]);
    expect(result.presetPerTrack).toEqual({});
    expect(result.drumKitMatch).toBeNull();
  });
});
