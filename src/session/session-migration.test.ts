import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState } from './session-migration';
import { DEFAULT_MUSICALITY } from './session';
import type { SessionClip, SessionState } from './session';
import { effectiveGlobalLoop } from '../core/global-loop';

it('seeds default sends when a loaded state has none', () => {
  const s = {
    lanes: [{ id: 'bass', engineId: 'tb303', clips: [] }],
    scenes: [], globalQuantize: '1/1',
  } as unknown as SessionState;
  const out = migrateLoadedSessionState(s);
  expect(out.sends?.map((b) => b.id)).toEqual(['A', 'B']);
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

  it('canonicalises enginePresetName factory:<name> → engine:<name> (unified vocabulary)', () => {
    const s = {
      ...emptyState(),
      lanes: [
        { id: 'sub',  engineId: 'subtractive',   clips: [], enginePresetName: 'factory:LEAD Square' },
        { id: 'tb',   engineId: 'tb303',         clips: [], enginePresetName: 'factory:BASS Acid Classic' },
      ],
    } as unknown as SessionState;
    const out = migrateLoadedSessionState(s);
    expect(out.lanes[0].enginePresetName).toBe('engine:LEAD Square');
    expect(out.lanes[1].enginePresetName).toBe('engine:BASS Acid Classic');
  });

  it('leaves user:/engine:/sampler: preset names untouched', () => {
    const s = {
      ...emptyState(),
      lanes: [
        { id: 'a', engineId: 'subtractive', clips: [], enginePresetName: 'user:My Pad' },
        { id: 'b', engineId: 'fm',          clips: [], enginePresetName: 'engine:EP Classic' },
        { id: 'c', engineId: 'sampler',     clips: [], enginePresetName: 'sampler:preset:Grand Piano' },
      ],
    } as unknown as SessionState;
    const out = migrateLoadedSessionState(s);
    expect(out.lanes.map((l) => l.enginePresetName)).toEqual([
      'user:My Pad', 'engine:EP Classic', 'sampler:preset:Grand Piano',
    ]);
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

describe('global-loop fields', () => {
  it('scenes without global-loop fields default to disabled', () => {
    const migrated = migrateLoadedSessionState({ lanes: [], scenes: [{ id: 's1', clipPerLane: {} }] } as any);
    expect(effectiveGlobalLoop(migrated.scenes[0]).enabled).toBe(false);
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
