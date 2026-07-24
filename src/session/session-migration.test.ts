import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState } from './session-migration';
import { DEFAULT_MUSICALITY, testSessionState } from './session';
import type { SessionClip, SessionState } from './session';
import { effectiveGlobalLoop } from '../core/global-loop';

describe('migrateLoadedSessionState', () => {
  it('passes through a modern state untouched', () => {
    const s: SessionState = {
      ...testSessionState(),
      lanes: [{ id: 'bass', engineId: 'tb303', clips: [
        { id: 'c1', lengthBars: 1, notes: [{ midi: 36, start: 0, duration: 24, velocity: 80 }], color: '#a8c8e8', gridResolution: '1/16' },
      ], inserts: [] }],
    };
    const out = migrateLoadedSessionState(s);
    expect(out.lanes[0].engineId).toBe('tb303');
    expect(out.lanes[0].clips[0]!.notes).toHaveLength(1);
  });

  it('leaves user:/engine:/sampler: preset names untouched', () => {
    const s: SessionState = {
      ...testSessionState(),
      lanes: [
        { id: 'a', engineId: 'subtractive', clips: [], inserts: [], enginePresetName: 'user:My Pad' },
        { id: 'b', engineId: 'fm',          clips: [], inserts: [], enginePresetName: 'engine:EP Classic' },
        { id: 'c', engineId: 'sampler',     clips: [], inserts: [], enginePresetName: 'sampler:preset:Grand Piano' },
      ],
    };
    const out = migrateLoadedSessionState(s);
    expect(out.lanes.map((l) => l.enginePresetName)).toEqual([
      'user:My Pad', 'engine:EP Classic', 'sampler:preset:Grand Piano',
    ]);
  });

  // D10 backward-compat: sampler lanes materialised by the old `onSliceToBank`
  // carry a "modern" clip (`notes` + `sample` + `waveformRef`) with no
  // `instrumentId` — they are IndexedDB-only. The passthrough must preserve
  // those audio fields verbatim so the bank/waveform survive a load.
  it('preserves sample + waveformRef + notes on a modern (sliced) sampler clip', () => {
    const clip: SessionClip = {
      id: 'loopclip', lengthBars: 2, color: '#a8e8b8', gridResolution: '1/16',
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
      ...testSessionState(),
      lanes: [{ id: 'sampler1', engineId: 'sampler', clips: [clip], inserts: [] }],
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

describe('global-loop fields', () => {
  it('scenes without global-loop fields default to disabled', () => {
    const s: SessionState = { ...testSessionState(), scenes: [{ id: 's1', clipPerLane: {} }] };
    const migrated = migrateLoadedSessionState(s);
    expect(effectiveGlobalLoop(migrated.scenes[0]).enabled).toBe(false);
  });
});

// Save FILES written before 2026-07-19 (commit 6bf2446 made these fields
// required at construction) can still be sitting in Downloads/localStorage
// without them. The normaliser is the boundary where foreign JSON becomes a
// spec-true SessionState — a missing field must never leak through and crash
// destination listing (`slots is not iterable`) or the load itself.
describe('pre-required-fields save files (foreign JSON)', () => {
  /** A state as an old build saved it: required fields stripped. */
  const oldSave = (mutate: (s: Record<string, unknown>) => void): SessionState => {
    const s = JSON.parse(JSON.stringify(testSessionState())) as Record<string, unknown>;
    mutate(s);
    return s as unknown as SessionState;
  };

  it('backfills lane.inserts to [] when a lane lacks it (tb303-bs.json case)', () => {
    const s = oldSave((raw) => {
      const lanes = raw.lanes as Record<string, unknown>[];
      lanes.push({ id: 'audio-stem-1', engineId: 'audio', clips: [] }); // no inserts key
    });
    const out = migrateLoadedSessionState(s);
    expect(out.lanes.every((l) => Array.isArray(l.inserts))).toBe(true);
  });

  it('backfills masterInserts to []', () => {
    const s = oldSave((raw) => { delete raw.masterInserts; });
    expect(migrateLoadedSessionState(s).masterInserts).toEqual([]);
  });

  it('backfills missing sends with the two default buses', () => {
    const s = oldSave((raw) => { delete raw.sends; });
    const out = migrateLoadedSessionState(s);
    expect(out.sends.map((b) => b.id)).toEqual(['A', 'B']);
  });

  it('backfills a send bus that lacks its inserts rack', () => {
    const s = oldSave((raw) => {
      (raw.sends as Record<string, unknown>[])[0] = { id: 'A', label: 'Send A', returnLevel: 1, muted: false };
    });
    const out = migrateLoadedSessionState(s);
    expect(out.sends.every((b) => Array.isArray(b.inserts))).toBe(true);
  });

  it('backfills missing musicality (and does not crash forcing the lock off)', () => {
    const s = oldSave((raw) => { delete raw.musicality; });
    expect(migrateLoadedSessionState(s).musicality).toEqual({ ...DEFAULT_MUSICALITY, lock: false });
  });

  it('backfills a missing project name', () => {
    const s = oldSave((raw) => { delete raw.name; });
    expect(migrateLoadedSessionState(s).name).toBe('Untitled');
  });

  it('backfills clip color (stable per id) and gridResolution', () => {
    const s = oldSave((raw) => {
      (raw.lanes as Record<string, unknown>[]).push({
        id: 'bass', engineId: 'tb303', inserts: [],
        clips: [{ id: 'c-old', lengthBars: 1, notes: [] }, null],
      });
    });
    const out = migrateLoadedSessionState(s);
    const clip = out.lanes.find((l) => l.id === 'bass')!.clips[0]!;
    expect(clip.gridResolution).toBe('1/16');
    expect(typeof clip.color).toBe('string');
    // Deterministic: reloading the same save yields the same color.
    const again = migrateLoadedSessionState(oldSave((raw) => {
      (raw.lanes as Record<string, unknown>[]).push({
        id: 'bass', engineId: 'tb303', inserts: [],
        clips: [{ id: 'c-old', lengthBars: 1, notes: [] }],
      });
    }));
    expect(again.lanes.find((l) => l.id === 'bass')!.clips[0]!.color).toBe(clip.color);
  });
});

describe('migration forces the scale lock off', () => {
  it('keeps an existing key/scale/style but forces the scale lock OFF on load', () => {
    const s: SessionState = {
      ...testSessionState(),
      musicality: { key: 0, scale: 'major', style: 'house', lock: true },
    };
    const out = migrateLoadedSessionState(s);
    // A loaded session must never start with the lock ON — not even from a
    // save that had lock:true. The user opts in per working session.
    expect(out.musicality).toEqual({ key: 0, scale: 'major', style: 'house', lock: false });
  });

  it('a session already built with DEFAULT_MUSICALITY is otherwise untouched', () => {
    const s = testSessionState();
    const out = migrateLoadedSessionState(s);
    expect(out.musicality).toEqual(DEFAULT_MUSICALITY);
  });
});
