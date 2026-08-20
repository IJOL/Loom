// A follower reaches the scheduler through the SAME door a weave does —
// notesFor — and this is the level that can say so. The unit tests know the
// source produces notes; only here does anything check that the wiring hands it
// over, and that a weave selection on the same lane does not win the argument.

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

/** A bar built plainly on the tonic of A minor, so what it implies is not in
 *  doubt and the test is about the wiring rather than about the analysis. */
const MELODY = [
  { start: 0, duration: BAR / 2, midi: 57, velocity: 100 },
  { start: BAR / 2, duration: BAR / 2, midi: 60, velocity: 100 },
];

interface LaneSpec {
  role?: string;
  follow?: { leaderId: string };
  notes?: NoteEvent[];
}

function session(lanes: Record<string, LaneSpec>): SessionState {
  return {
    lanes: Object.entries(lanes).map(([id, spec]) => ({
      id,
      engineId: 'subtractive',
      role: spec.role,
      follow: spec.follow,
      clips: spec.notes
        ? [{ id: `${id}-clip`, name: id, color: '#fff', lengthBars: 1,
             notes: spec.notes, gridResolution: '1/16' }]
        : [],
      inserts: [],
    })),
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState;
}

const wiring = (state: SessionState) => createWeaveWiring({
  getLaneStates: () => new Map<string, LanePlayState>(),
  getMeter: () => DEFAULT_METER,
  getState: () => state,
});

describe('a following lane reaches the scheduler', () => {
  it('gets notes with no weave selection of its own', () => {
    const w = wiring(session({
      lead: { role: 'melody', notes: MELODY },
      chords: { role: 'pad', follow: { leaderId: 'lead' } },
    }));
    expect(w.notesFor('chords')?.()?.length).toBeGreaterThan(0);
  });

  it('plays a PAD — one stack, held, not the leader\'s own rhythm', () => {
    const w = wiring(session({
      lead: { role: 'melody', notes: MELODY },
      chords: { role: 'pad', follow: { leaderId: 'lead' } },
    }));
    const out = w.notesFor('chords')?.() ?? [];
    expect(new Set(out.map((n) => n.start))).toEqual(new Set([0]));
    expect(out.length).toBeGreaterThan(1);
  });

  it('a lane that follows NOBODY is untouched — the feature costs nothing', () => {
    const w = wiring(session({ lead: { role: 'melody', notes: MELODY } }));
    expect(w.notesFor('lead')).toBeUndefined();
  });

  it('a follower whose leader is gone plays nothing rather than throwing', () => {
    const w = wiring(session({ chords: { role: 'pad', follow: { leaderId: 'ghost' } } }));
    expect(w.notesFor('chords')?.() ?? []).toEqual([]);
  });

  it('a follower with no role plays nothing', () => {
    // No role and an engine with no defaultRole ⇒ laneRoleOf answers undefined,
    // and renderPart declines rather than picking a part nobody chose.
    const w = wiring(session({
      lead: { role: 'melody', notes: MELODY },
      chords: { follow: { leaderId: 'lead' } },
    }));
    const out = w.notesFor('chords')?.() ?? [];
    // Either no source at all or a silent one — both are "plays nothing".
    expect(out.length === 0 || out.every((n) => n.velocity === 0)).toBe(true);
  });
});

describe('the leader is not disturbed by being followed', () => {
  it('reads the leader without giving it a source of its own', () => {
    const state = session({
      lead: { role: 'melody', notes: MELODY },
      chords: { role: 'pad', follow: { leaderId: 'lead' } },
    });
    const w = wiring(state);
    w.notesFor('chords')?.();
    // The follower asked for the leader's notes; that must not have turned the
    // leader into a woven lane, which would make it play something other than
    // its clip.
    expect(w.notesFor('lead')).toBeUndefined();
  });

  it('follows the leader when the leader\'s notes change', () => {
    const state = session({
      lead: { role: 'melody', notes: MELODY },
      chords: { role: 'pad', follow: { leaderId: 'lead' } },
    });
    const w = wiring(state);
    const before = (w.notesFor('chords')?.() ?? []).map((n) => n.midi);
    // Edited in place, exactly as the clip editor does it. D and F imply the
    // triad on degree 3, which shares no notes with the tonic's.
    state.lanes[0].clips[0]!.notes = [
      { start: 0, duration: BAR / 2, midi: 62, velocity: 100 },
      { start: BAR / 2, duration: BAR / 2, midi: 65, velocity: 100 },
    ];
    expect((w.notesFor('chords')?.() ?? []).map((n) => n.midi)).not.toEqual(before);
  });
});

describe('a lane that stops following goes back to being an ordinary lane', () => {
  it('plays its own clip again the moment the follow is cleared', () => {
    // Reported from use: "cuando un canal se pone a follow después ya nunca
    // recupera el funcionamiento normal, sólo hace follow aunque esté en
    // normal".
    const state = session({
      lead: { role: 'melody', notes: MELODY },
      chords: { role: 'pad', follow: { leaderId: 'lead' }, notes: MELODY },
    });
    const w = wiring(state);
    expect(w.notesFor('chords')?.()?.length).toBeGreaterThan(0);

    // Exactly what the picker's "— plays its own —" does to the session.
    delete (state.lanes[1] as { follow?: unknown }).follow;
    w.invalidate();

    // Nothing to say about this lane any more: no follow, no weave selection,
    // so the scheduler falls back to the lane's own clip. Undefined is how this
    // wiring says "not mine".
    expect(w.notesFor('chords')).toBeUndefined();
  });

  it('and does not need the transport stopped to do it', () => {
    const state = session({
      lead: { role: 'melody', notes: MELODY },
      chords: { role: 'pad', follow: { leaderId: 'lead' }, notes: MELODY },
    });
    const w = wiring(state);
    w.notesFor('chords')?.();
    delete (state.lanes[1] as { follow?: unknown }).follow;
    w.invalidate();
    expect(w.notesFor('chords')).toBeUndefined();
  });
});
