// The MIDI import should consider the TRACK NAME, not only the GM program, when
// picking a default engine — GM programs in real files are often wrong/junk (a
// track NAMED "Guitar" carrying program 25, a track NAMED "Drums" on a melodic
// program). The name decides the engine family; within that engine the GM
// program still picks the preset (falling back to a name match, then the first).

import { describe, it, expect, vi } from 'vitest';

vi.mock('../engines/registry', () => ({
  listEngines: () => [
    { id: 'subtractive',   presets: [{ name: 'KEY Acoustic Piano', gm: [0], params: {} }, { name: 'PAD Warm', gm: [89], params: {} }] },
    { id: 'karplus',       presets: [{ name: 'Nylon Guitar', gm: [24], params: {} }, { name: 'Steel String', gm: [25], params: {} }] },
    { id: 'fm',            presets: [{ name: 'EP Classic Tine', gm: [4], params: {} }, { name: 'BELL Tubular', gm: [14], params: {} }] },
    { id: 'drums-machine', presets: [{ name: 'KIT Standard', gm: [0], params: {} }] },
  ],
}));

import { engineHintFromName, suggestDefaultMapping } from './gm-lookup';
import type { ParsedMidi } from './midi-parse';

const note = { startTick: 0, duration: 48, midi: 60, velocity: 90, channel: 0 };

describe('engineHintFromName', () => {
  it('maps guitar-named tracks to karplus', () => {
    expect(engineHintFromName('Guitar 2')).toBe('karplus');
    expect(engineHintFromName('GTR lead')).toBe('karplus');
  });
  it('maps drum-named tracks to drums-machine (even on a melodic program)', () => {
    expect(engineHintFromName('Drums')).toBe('drums-machine');
    expect(engineHintFromName('Perc')).toBe('drums-machine');
  });
  it('maps pads/strings/piano to subtractive and bells/rhodes to fm', () => {
    expect(engineHintFromName('Warm Pad')).toBe('subtractive');
    expect(engineHintFromName('Strings 1')).toBe('subtractive');
    expect(engineHintFromName('Piano')).toBe('subtractive');
    expect(engineHintFromName('Tubular Bells')).toBe('fm');
    expect(engineHintFromName('Warm Rhodes')).toBe('fm');
  });
  it('returns null when the name carries no instrument keyword', () => {
    expect(engineHintFromName('Effects')).toBeNull();
    expect(engineHintFromName('Track 5')).toBeNull();
  });
});

describe('suggestDefaultMapping prefers the track name over the GM program', () => {
  const parsed: ParsedMidi = {
    division: 96, bpm: null,
    tracks: [
      { index: 0, name: 'Guitar 2', program: 25,  notes: [note] }, // guitar name → karplus
      { index: 1, name: 'Drums',    program: 25,  notes: [note] }, // drum name on a melodic program → drums
      { index: 2, name: 'Effects',  program: 122, notes: [note] }, // no keyword → GM fallback
    ],
  };

  it('routes a Guitar-named track to karplus, preset chosen by GM program within karplus', () => {
    const r = suggestDefaultMapping(parsed, [0]);
    expect(r.presetPerTrack[0].engineId).toBe('karplus');
    expect(r.presetPerTrack[0].presetName).toBe('Steel String'); // gm:25 inside karplus
  });

  it('routes a Drums-named track to drums-machine despite a melodic program', () => {
    const r = suggestDefaultMapping(parsed, [1]);
    expect(r.presetPerTrack[1].engineId).toBe('drums-machine');
  });

  it('falls back to the GM program when the name has no instrument keyword', () => {
    const r = suggestDefaultMapping(parsed, [2]);
    expect(r.presetPerTrack[2].engineId).toBe('poly'); // prog 122 unmatched → poly/Init
  });
});
