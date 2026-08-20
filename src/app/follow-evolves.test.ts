// ¿Cambia el acompañamiento cuando el líder TEJE?
//
// Las funciones puras dicen que sí: un crossfade completo entre dos loops da 20
// melodías distintas y 9 progresiones distintas. En la aplicación, en cambio, se
// informa de que no cambia nada. Si ambas cosas son ciertas el fallo está en el
// camino, no en el cálculo — y este es el nivel donde el camino existe.

import { describe, it, expect } from 'vitest';
import { createWeaveWiring } from './weave-wiring';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { DEFAULT_METER, ticksPerBar } from '../core/meter';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import type { SessionState } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';

const BAR = ticksPerBar(DEFAULT_METER);
const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });

// Two loops that imply DIFFERENT harmony, so a fade between them has somewhere
// to go: a C minor triad against a G-rooted one.
const LOOP_A = [hit(0, 60), hit(4, 63), hit(8, 67), hit(12, 63)];
const LOOP_B = [hit(0, 67), hit(4, 62), hit(8, 59), hit(12, 62)];

function fixture() {
  const state = {
    name: 'T', masterInserts: [], sends: [], scenes: [], globalQuantize: 'immediate',
    musicality: { ...DEFAULT_MUSICALITY, key: 0, scale: 'minor' },
    lanes: [
      {
        id: 'lead', engineId: 'subtractive', role: 'melody', inserts: [],
        clips: [
          { id: 'a', name: 'A', color: '#fff', lengthBars: 1, gridResolution: '1/16', notes: LOOP_A },
          { id: 'b', name: 'B', color: '#fff', lengthBars: 1, gridResolution: '1/16', notes: LOOP_B },
        ],
      },
      {
        id: 'chords', engineId: 'subtractive', role: 'comp', inserts: [],
        clips: [{ id: 'c', name: 'C', color: '#fff', lengthBars: 1, gridResolution: '1/16', notes: [] }],
        follow: { leaderId: 'lead' },
      },
    ],
  } as unknown as SessionState;

  const w = createWeaveWiring({
    getLaneStates: () => new Map<string, LanePlayState>(),
    getMeter: () => DEFAULT_METER,
    getState: () => state,
  });
  // The leader weaves A→B, exactly as a lane does in the panel.
  w.state.lanes.lead = {
    weave: { kind: 'ab', a: 'clip:a', b: 'clip:b', x: 0 },
  } as never;
  return { state, w };
}

/** Move the leader's crossfade and read what the FOLLOWER then plays. */
function followerAt(x: number) {
  const { w } = fixture();
  (w.state.lanes.lead.weave as { x: number }).x = x;
  w.invalidate();
  return (w.notesFor('chords')?.() ?? []).map((n) => `${n.start}:${n.midi}`).join(',');
}

describe('a follower tracks a weaving leader', () => {
  it('the LEADER itself changes across the fade — the premise', () => {
    const { w } = fixture();
    const read = (x: number) => {
      (w.state.lanes.lead.weave as { x: number }).x = x;
      w.invalidate();
      return (w.notesFor('lead')?.() ?? []).map((n) => `${n.start}:${n.midi}`).join(',');
    };
    expect(new Set([read(0), read(0.5), read(1)]).size).toBeGreaterThan(1);
  });

  it('the FOLLOWER changes with it', () => {
    const seen = new Set([0, 0.25, 0.5, 0.75, 1].map(followerAt));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('the two ends of the fade do not accompany identically', () => {
    expect(followerAt(0)).not.toEqual(followerAt(1));
  });
});
