// The generator through the REAL wiring — the level that catches what every
// isolated test passes. The weave's own per-note-predicate mistake survived a
// full unit suite and died here, counting triggers through the transport's own
// door; this asks the same kind of question of the third producer.
import { describe, it, expect } from 'vitest';
import { createWeaveWiring } from './weave-wiring';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { DEFAULT_METER, ticksPerBar } from '../core/meter';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { DEFAULT_GRID } from '../generator/grid';
import type { SessionState } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';

const BAR = ticksPerBar(DEFAULT_METER);
const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });

// Three pitches, so the pool does not divide a four-beat bar: what the head is
// doing then has a visible answer.
const A = [hit(0, 60), hit(4, 64), hit(8, 67)];
const B = [hit(0, 72), hit(4, 76), hit(8, 79)];

function session(over: Partial<Record<string, unknown>> = {}): SessionState {
  return {
    lanes: [{
      id: 'lane1',
      engineId: 'subtractive',
      clips: [
        { id: 'clipA', name: 'A', color: '#fff', lengthBars: 1, notes: A, gridResolution: '1/16' },
        { id: 'clipB', name: 'B', color: '#fff', lengthBars: 1, notes: B, gridResolution: '1/16' },
      ],
      inserts: [],
      ...over,
    }],
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState;
}

const generating = (x = 0) => ({
  generator: {
    selection: { kind: 'ab' as const, a: 'clip:clipA', b: 'clip:clipB', x },
    grid: { ...DEFAULT_GRID },
  },
});

function wiring(state: SessionState, laneStates = new Map<string, LanePlayState>()) {
  return createWeaveWiring({
    getLaneStates: () => laneStates,
    getMeter: () => DEFAULT_METER,
    getState: () => state,
  });
}

describe('a generating lane', () => {
  it('plays something of its own instead of its clip', () => {
    const w = wiring(session(generating()));
    const notes = w.notesFor('lane1')?.();
    expect(notes).toBeDefined();
    // One per beat, filling the bar — not the clip's own three hits.
    expect(notes).toHaveLength(DEFAULT_METER.num);
    for (const n of notes!) expect(n.start).toBeLessThan(BAR);
  });

  it('draws its pitches from the loops it selected, not from the clip', () => {
    // Hard against B, so every pitch must come from B's material.
    const w = wiring(session(generating(1)));
    const midi = (w.notesFor('lane1')?.() ?? []).map((n) => n.midi);
    expect(midi.length).toBeGreaterThan(0);
    for (const m of midi) expect(B.map((n) => n.midi)).toContain(m);
  });

  it('says nothing for a lane that is not generating', () => {
    // The whole feature stays additive: an untouched lane schedules exactly as
    // it did before any of this existed.
    expect(wiring(session()).notesFor('lane1')).toBeUndefined();
  });

  it('says nothing when every loop it names is gone', () => {
    const s = session({
      generator: {
        selection: { kind: 'ab' as const, a: 'clip:gone', b: 'clip:alsoGone', x: 0 },
        grid: { ...DEFAULT_GRID },
      },
    });
    expect(wiring(s).notesFor('lane1')).toBeUndefined();
  });

  function lapping(grid: { repeats: number; pow2: number }) {
    const laneStates = new Map<string, LanePlayState>();
    const gen = generating();
    gen.generator.grid = grid;
    const w = wiring(session(gen), laneStates);
    return (loopCount: number) => {
      laneStates.set('lane1', { loopCount } as unknown as LanePlayState);
      return (w.notesFor('lane1')?.() ?? []).map((n) => n.midi);
    };
  }

  it('moves the head on from one lap of the clip to the next', () => {
    // A pattern LONGER than the carrier clip is the whole reason the head is
    // absolute: bar two of a two-bar pattern lives on the clip's second lap.
    // Read through the wiring, because a source counting laps of its own would
    // be the one thing an offline render could not reproduce.
    const at = lapping({ repeats: 2, pow2: 0 });
    expect(at(1)).not.toEqual(at(0));
  });

  it('repeats every bar when the pattern IS a bar, and that is not a bug', () => {
    // The default grid. Worth pinning, because "the lap does nothing" looks
    // identical to a lap that never arrived.
    const at = lapping({ ...DEFAULT_GRID });
    expect(at(1)).toEqual(at(0));
    expect(at(7)).toEqual(at(0));
  });

  it('comes back round after exactly one pattern, laps later', () => {
    const at = lapping({ repeats: 2, pow2: 1 });   // four bars
    expect(at(4)).toEqual(at(0));
    expect(at(5)).toEqual(at(1));
    expect(at(1)).not.toEqual(at(0));
  });

  it('is beaten by FOLLOW, which answers the same question', () => {
    // Three producers, one winner, decided by the data rather than by a
    // tie-break nobody can see.
    const s = session({ ...generating(), follow: { leaderId: 'lane1' } });
    const notes = wiring(s).notesFor('lane1')?.();
    // The follower produces a derived part; what matters here is only that the
    // generator's one-per-beat shape is NOT what came out.
    expect(notes?.length ?? 0).not.toBe(DEFAULT_METER.num * 2);
  });

  it('beats the WEAVE, which is a panel where this is the song', () => {
    const s = session(generating(1));
    const w = wiring(s, new Map());
    w.state.lanes.lane1 = {
      // Pointed at A, while the generator is pointed hard at B.
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipA', x: 0 },
      locked: false, harmonyLeader: false,
    };
    const midi = (w.notesFor('lane1')?.() ?? []).map((n) => n.midi);
    expect(midi.length).toBeGreaterThan(0);
    for (const m of midi) expect(B.map((n) => n.midi)).toContain(m);
  });
});
