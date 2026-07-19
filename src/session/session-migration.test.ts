import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState, canonicaliseArrangementParamIds } from './session-migration';
import { DEFAULT_MUSICALITY } from './session';
import type { SessionClip, SessionState } from './session';
import { effectiveGlobalLoop } from '../core/global-loop';
import { VOICE_MIDI } from '../engines/drum-gm-map';
import type { ArrangementState } from '../performance/performance';

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

describe('global-loop fields', () => {
  it('scenes without global-loop fields default to disabled', () => {
    const migrated = migrateLoadedSessionState({ lanes: [], scenes: [{ id: 's1', clipPerLane: {} }] } as any);
    expect(effectiveGlobalLoop(migrated.scenes[0]).enabled).toBe(false);
  });
});

// Stored destinations used to address an insert by POSITION. Removing a slot
// renumbered every later one, silently repointing envelopes and modulation at
// the wrong effect. Load-time translation repoints them at the slot's stable
// id — the only chance to do it, because the position they encode is only
// meaningful against the chain as it was saved.
describe('insert id translation at load', () => {
  function slot(pluginId: string, id?: string) {
    return { ...(id ? { id } : {}), pluginId, params: {}, bypass: false };
  }
  function laneWithRack(over: Record<string, unknown> = {}) {
    return {
      id: 'poly1', engineId: 'subtractive', clips: [],
      inserts: [slot('delay'), slot('reverb')],
      ...over,
    };
  }
  function modConn(paramId: string) {
    return { modulators: [{
      id: 'lfo1', kind: 'lfo', enabled: true,
      connections: [{ id: 'c1', paramId, depth: 0.5 }],
    }] };
  }
  const connOf = (s: SessionState, lane = 0) =>
    s.lanes[lane].engineState!.modulators![0].connections[0].paramId;
  const envOf = (s: SessionState, lane = 0) =>
    s.lanes[lane].clips[0]!.envelopes![0].paramId;

  it('backfills ids and repoints legacy automation + modulation ids at them', () => {
    const state = {
      ...emptyState(),
      lanes: [laneWithRack({
        clips: [{ id: 'c1', lengthBars: 1, notes: [],
          envelopes: [{ paramId: 'poly1.fx1.cutoff', values: [] }] }],
        engineState: modConn('lane-insert-1:cutoff'),
      })],
    } as unknown as SessionState;

    migrateLoadedSessionState(state);

    const secondSlotId = state.lanes[0].inserts![1].id;
    expect(secondSlotId).toBeTruthy();
    expect(state.lanes[0].inserts![0].id).toBeTruthy();
    expect(state.lanes[0].inserts![0].id).not.toBe(secondSlotId);
    // Both stored forms pointed at slot index 1 — both must land on that slot's id.
    expect(envOf(state)).toBe(`poly1.fx:${secondSlotId}.cutoff`);
    expect(connOf(state)).toBe(`poly1.fx:${secondSlotId}.cutoff`);
  });

  it('leaves an already-canonical id untouched', () => {
    const state = {
      ...emptyState(),
      lanes: [laneWithRack({
        inserts: [slot('delay', 'keep')],
        engineState: modConn('poly1.fx:keep.cutoff'),
      })],
    } as unknown as SessionState;

    migrateLoadedSessionState(state);
    expect(connOf(state)).toBe('poly1.fx:keep.cutoff');
  });

  it('is idempotent — a second migration does not re-translate', () => {
    const state = {
      ...emptyState(),
      lanes: [laneWithRack({ engineState: modConn('lane-insert-0:cutoff') })],
    } as unknown as SessionState;

    migrateLoadedSessionState(state);
    const firstId = state.lanes[0].inserts![0].id;
    const after = connOf(state);
    expect(after).toBe(`poly1.fx:${firstId}.cutoff`);

    migrateLoadedSessionState(state);
    // Ids must not be re-minted, and the destination must not shift.
    expect(state.lanes[0].inserts![0].id).toBe(firstId);
    expect(connOf(state)).toBe(after);
  });

  it('leaves an id naming a slot index that no longer exists unchanged', () => {
    // The insert at index 5 was deleted before the save. Guessing another slot
    // would silently modulate the wrong effect; inert-and-unchanged is honest.
    const state = {
      ...emptyState(),
      lanes: [laneWithRack({
        clips: [{ id: 'c1', lengthBars: 1, notes: [],
          envelopes: [{ paramId: 'poly1.fx5.cutoff', values: [] }] }],
        engineState: modConn('lane-insert-5:cutoff'),
      })],
    } as unknown as SessionState;

    migrateLoadedSessionState(state);
    expect(envOf(state)).toBe('poly1.fx5.cutoff');
    expect(connOf(state)).toBe('lane-insert-5:cutoff');
  });

  it('survives a lane with no inserts array at all', () => {
    const state = {
      ...emptyState(),
      lanes: [{
        id: 'poly1', engineId: 'subtractive',
        clips: [{ id: 'c1', lengthBars: 1, notes: [],
          envelopes: [{ paramId: 'poly1.fx0.cutoff', values: [] }] }],
        engineState: modConn('lane-insert-0:cutoff'),
      }],
    } as unknown as SessionState;

    expect(() => migrateLoadedSessionState(state)).not.toThrow();
    expect(state.lanes[0].inserts).toBeUndefined();
    expect(envOf(state)).toBe('poly1.fx0.cutoff');
    expect(connOf(state)).toBe('lane-insert-0:cutoff');
  });

  it('repoints master-rack ids (both stored forms) at the master slot', () => {
    // A lane-owned modulator can address the MASTER rack — `master-insert-N`
    // carries no scope of its own, so it always means `fx.master`.
    const state = {
      ...emptyState(),
      masterInserts: [slot('limiter'), slot('compressor')],
      lanes: [{
        id: 'poly1', engineId: 'subtractive',
        clips: [{ id: 'c1', lengthBars: 1, notes: [],
          envelopes: [{ paramId: 'fx.master.fx1.threshold', values: [] }] }],
        engineState: modConn('master-insert-1:threshold'),
      }],
    } as unknown as SessionState;

    migrateLoadedSessionState(state);
    const id = state.masterInserts![1].id;
    expect(id).toBeTruthy();
    expect(envOf(state)).toBe(`fx.master.fx:${id}.threshold`);
    expect(connOf(state)).toBe(`fx.master.fx:${id}.threshold`);
  });

  it('repoints a send-rack automation id at the send slot', () => {
    // Only the automation form can address a send rack — the dotted scope
    // (`fx.send.A`) lives inside the id. The old modulation form had no scope
    // at all and could never reach a send, so there is nothing to translate.
    const state = {
      ...emptyState(),
      sends: [
        { id: 'A', label: 'A', returnLevel: 1, muted: false, inserts: [slot('delay')] },
        { id: 'B', label: 'B', returnLevel: 1, muted: false, inserts: [slot('reverb')] },
      ],
      lanes: [{
        id: 'poly1', engineId: 'subtractive',
        clips: [{ id: 'c1', lengthBars: 1, notes: [],
          envelopes: [{ paramId: 'fx.send.B.fx0.mix', values: [] }] }],
      }],
    } as unknown as SessionState;

    migrateLoadedSessionState(state);
    const id = state.sends![1].inserts[0].id;
    expect(id).toBeTruthy();
    expect(envOf(state)).toBe(`fx.send.B.fx:${id}.mix`);
  });

  it('leaves a plain engine param id alone', () => {
    const state = {
      ...emptyState(),
      lanes: [laneWithRack({
        clips: [{ id: 'c1', lengthBars: 1, notes: [],
          envelopes: [{ paramId: 'poly1.filter.cutoff', values: [] }] }],
        engineState: modConn('poly1.osc.detune'),
      })],
    } as unknown as SessionState;

    migrateLoadedSessionState(state);
    expect(envOf(state)).toBe('poly1.filter.cutoff');
    expect(connOf(state)).toBe('poly1.osc.detune');
  });

  it('skips null clip slots without throwing', () => {
    const state = {
      ...emptyState(),
      lanes: [laneWithRack({ clips: [null, { id: 'c2', lengthBars: 1, notes: [],
        envelopes: [{ paramId: 'poly1.fx0.cutoff', values: [] }] }] })],
    } as unknown as SessionState;

    expect(() => migrateLoadedSessionState(state)).not.toThrow();
    const id = state.lanes[0].inserts![0].id;
    expect(state.lanes[0].clips[1]!.envelopes![0].paramId).toBe(`poly1.fx:${id}.cutoff`);
  });
});

// Performance-view curves live in SavedStateV3.arrangement, NOT in SessionState,
// so migrateLoadedSessionState never sees them. They record the same knob ids
// and go equally inert if left untranslated.
describe('canonicaliseArrangementParamIds', () => {
  it('repoints lane and global arrangement curves at stable slot ids', () => {
    const state = {
      lanes: [], scenes: [], globalQuantize: '1/1',
      masterInserts: [{ pluginId: 'limiter', params: {}, bypass: false }],
    } as unknown as SessionState;
    state.lanes.push({
      id: 'poly1', engineId: 'subtractive', clips: [],
      inserts: [{ pluginId: 'delay', params: {}, bypass: false }],
    } as never);
    migrateLoadedSessionState(state);

    const arr = {
      bpm: 120, durationSec: 8, lengthBars: 4,
      lanes: [{ laneId: 'poly1', clipEvents: [], automation: [
        { paramId: 'poly1.fx0.feedback', values: [] },
        { paramId: 'poly1.filter.cutoff', values: [] },
      ] }],
      globalAutomation: [{ paramId: 'fx.master.fx0.threshold', values: [] }],
    } as unknown as ArrangementState;

    canonicaliseArrangementParamIds(state, arr);

    const laneSlot = state.lanes[0].inserts![0].id;
    const masterSlot = state.masterInserts![0].id;
    expect(arr.lanes[0].automation[0].paramId).toBe(`poly1.fx:${laneSlot}.feedback`);
    expect(arr.lanes[0].automation[1].paramId).toBe('poly1.filter.cutoff');
    expect(arr.globalAutomation[0].paramId).toBe(`fx.master.fx:${masterSlot}.threshold`);
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
