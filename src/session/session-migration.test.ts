import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState } from './session-migration';
import type { SessionState } from './session';
import { VOICE_MIDI } from '../engines/drum-gm-map';

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
});
