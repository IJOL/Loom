import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState } from './session-migration';
import { DEFAULT_MUSICALITY } from './session';
import type { SessionClip, SessionState } from './session';
import { VOICE_MIDI } from '../engines/drum-gm-map';

it('seeds default sends and remaps legacy lane send knobs', () => {
  const s = {
    lanes: [{ id: 'bass', engineId: 'tb303', clips: [],
      engineState: { params: { 'mix.bass.rev': 0.5, 'mix.bass.dly': 0.2 } } }],
    scenes: [], globalQuantize: '1/1',
  } as unknown as SessionState;
  const out = migrateLoadedSessionState(s);
  expect(out.sends?.map((b) => b.id)).toEqual(['A', 'B']);
  expect(out.lanes[0].engineState!.params!['mix.bass.sendB']).toBe(0.5);
  expect(out.lanes[0].engineState!.params!['mix.bass.sendA']).toBe(0.2);
});

function emptyState(): SessionState {
  return { lanes: [], scenes: [], globalQuantize: '1/1' };
}

describe('migrateLoadedSessionState', () => {
  it('passes through a modern state untouched', () => {
    const s: SessionState = {
      lanes: [{ id: 'bass', engineId: 'tb303', clips: [
        { id: 'c1', lengthBars: 1, notes: [{ midi: 36, start: 0, duration: 24, velocity: 80 }] },
      ] }],
      scenes: [], globalQuantize: '1/1',
    };
    const out = migrateLoadedSessionState(s);
    expect(out.lanes[0].engineId).toBe('tb303');
    expect(out.lanes[0].clips[0]!.notes).toHaveLength(1);
  });

  it('strips legacy lane.kind and lane.expanded fields', () => {
    const s = {
      ...emptyState(),
      lanes: [{ id: 'drums', engineId: 'drums-machine', clips: [],
        kind: 'drum-bus', expanded: true }],
    } as unknown as SessionState;
    const out = migrateLoadedSessionState(s);
    expect((out.lanes[0] as unknown as Record<string, unknown>).kind).toBeUndefined();
    expect((out.lanes[0] as unknown as Record<string, unknown>).expanded).toBeUndefined();
  });

  it('guesses engineId from lane id when missing', () => {
    const s = {
      ...emptyState(),
      lanes: [
        { id: 'bass',   clips: [] },
        { id: 'drums',  clips: [] },
        { id: 'main',   clips: [] },
        { id: 'poly3',  clips: [] },
      ],
    } as unknown as SessionState;
    const out = migrateLoadedSessionState(s);
    expect(out.lanes[0].engineId).toBe('tb303');
    expect(out.lanes[1].engineId).toBe('drums-machine');
    expect(out.lanes[2].engineId).toBe('subtractive');
    expect(out.lanes[3].engineId).toBe('subtractive');
  });

  it('converts legacy bassSteps clips to notes via bassStepsToNotes', () => {
    const s = {
      ...emptyState(),
      lanes: [{ id: 'bass', engineId: 'tb303', clips: [
        { id: 'c1', lengthBars: 1,
          bassSteps: [
            { on: true,  note: 36, accent: false, slide: false },
            { on: false, note: 0,  accent: false, slide: false },
          ],
        },
      ] }],
    } as unknown as SessionState;
    const out = migrateLoadedSessionState(s);
    const notes = out.lanes[0].clips[0]!.notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(36);
  });

  it('converts legacy drumSteps to notes via GM map', () => {
    const s = {
      ...emptyState(),
      lanes: [{ id: 'drums', engineId: 'drums-machine', clips: [
        { id: 'c1', lengthBars: 1,
          drumSteps: {
            kick:  [{ on: true,  accent: false }, { on: false, accent: false }],
            snare: [{ on: false, accent: false }, { on: true,  accent: false }],
          },
        },
      ] }],
    } as unknown as SessionState;
    const out = migrateLoadedSessionState(s);
    const notes = out.lanes[0].clips[0]!.notes;
    expect(notes.find((n) => n.midi === VOICE_MIDI.kick)!.start).toBe(0);
    expect(notes.find((n) => n.midi === VOICE_MIDI.snare)!.start).toBeGreaterThan(0);
  });

  // D10 backward-compat: sampler lanes materialised by the old `onSliceToBank`
  // carry a "modern" clip (`notes` + `sample` + `waveformRef`) with no
  // `instrumentId` — they are IndexedDB-only. The modern passthrough branch
  // must preserve those audio fields verbatim so the bank/waveform survive a load.
  it('preserves sample + waveformRef + notes on a modern (sliced) sampler clip', () => {
    const clip: SessionClip = {
      id: 'loopclip', lengthBars: 2, color: '#a8e8b8',
      notes: [
        { midi: 36, start: 0,  duration: 24, velocity: 90 },
        { midi: 37, start: 24, duration: 24, velocity: 90 },
      ],
      sample: {
        sampleId: 'whole-loop', mode: 'loop', originalBpm: 174,
        warp: true, trimStart: 0, trimEnd: 2.2,
      },
      waveformRef: {
        sampleId: 'whole-loop',
        slices: [
          { start: 0,   end: 1.1, note: 36 },
          { start: 1.1, end: 2.2, note: 37 },
        ],
      },
    };
    const s: SessionState = {
      lanes: [{ id: 'sampler1', engineId: 'sampler', clips: [clip] }],
      scenes: [], globalQuantize: '1/1',
    };
    const out = migrateLoadedSessionState(s);
    const migrated = out.lanes[0].clips[0]!;
    expect(migrated.notes).toHaveLength(2);
    expect(migrated.notes[1].midi).toBe(37);
    expect(migrated.sample).toEqual(clip.sample);
    expect(migrated.waveformRef).toEqual(clip.waveformRef);
    // No instrumentId is invented — sliced clips stay IndexedDB-only.
    expect(out.lanes[0].engineState?.sampler?.instrumentId).toBeUndefined();
  });
});

describe('migration backfills musicality', () => {
  it('adds DEFAULT_MUSICALITY when an old save has none', () => {
    const s = { lanes: [], scenes: [], globalQuantize: 'immediate' } as SessionState;
    const out = migrateLoadedSessionState(s);
    expect(out.musicality).toEqual(DEFAULT_MUSICALITY);
  });
  it('keeps an existing key/scale/style but forces the scale lock OFF on load', () => {
    const s = { lanes: [], scenes: [], globalQuantize: 'immediate',
      musicality: { key: 0, scale: 'major', style: 'house', lock: true } } as SessionState;
    const out = migrateLoadedSessionState(s);
    // A loaded session must never start with the lock ON — not even from an
    // old save that had lock:true. The user opts in per working session.
    expect(out.musicality).toEqual({ key: 0, scale: 'major', style: 'house', lock: false });
  });
});
