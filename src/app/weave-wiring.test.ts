// The wiring had no test, and a browser check said why it needed one: with a
// weave configured, both ends of the crossfade sounded identical — which is what
// "no gate at all" looks like from the outside.
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

// Two clips on one lane, sharing nothing: A hits at step 0, B at step 8. That
// makes "which one is the gate letting through" a question with a visible answer.
const A = [hit(0, 36)];
const B = [hit(8, 40)];

function session(engineId = 'subtractive'): SessionState {
  return {
    lanes: [{
      id: 'lane1',
      engineId,
      clips: [
        { id: 'clipA', name: 'A', color: '#fff', lengthBars: 1, notes: A, gridResolution: '1/16' },
        { id: 'clipB', name: 'B', color: '#fff', lengthBars: 1, notes: B, gridResolution: '1/16' },
      ],
      inserts: [],
    }],
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState;
}

function wiring(state: SessionState) {
  return createWeaveWiring({
    getLaneStates: () => new Map<string, LanePlayState>(),
    getMeter: () => DEFAULT_METER,
    getState: () => state,
  });
}



describe('createWeaveWiring — the weave actually reaches the scheduler', () => {
  it('has nothing to say about an untouched lane', () => {
    // The whole feature is additive: a session nobody has woven schedules
    // exactly as it did before the panel existed.
    expect(wiring(session()).notesFor('lane1')).toBeUndefined();
  });

  it('builds a source once a lane names its loops', () => {
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(typeof w.notesFor('lane1')).toBe('function');
  });

  it('hands over from A to B across the fade', () => {
    // The assertion the browser could not make. A source that never reached the
    // scheduler would answer the same at both ends and the crossfade would do
    // nothing at all.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')!()!.map((n) => n.midi)).toEqual([36]);

    w.state.lanes.lane1.weave = { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 1 };
    w.invalidate();
    // B's hit is PRODUCED, not merely allowed — it is not in the lane's playing
    // clip at all, which is exactly what a predicate could never do.
    expect(w.notesFor('lane1')!()!.map((n) => n.midi)).toEqual([40]);
  });

  it('carries no layer on a lane whose instrument has none', () => {
    const w = wiring(session('subtractive'));
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')!()![0].layerIndex).toBeUndefined();
  });

  it('names the loop on a LAYERS lane, so each note reaches its own instrument', () => {
    const w = wiring(session('layers'));
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')!()![0].layerIndex).toBe(0);
  });

  it('drops the cached source when the weave moves', () => {
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    const first = w.notesFor('lane1');
    expect(w.notesFor('lane1')).toBe(first);   // cached while nothing changed
    w.invalidate();
    expect(w.notesFor('lane1')).not.toBe(first);
  });

  it('shapes the CROSS-FADE with the macros too, not just an unwoven clip', () => {
    // A lane that was weaving used to be the one lane the macros could not
    // reach: they only ever applied to a clip playing itself.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    const plain = w.notesFor('lane1')!()![0].velocity;

    w.state.macros.energy = 1;
    w.invalidate();
    expect(w.notesFor('lane1')!()![0].velocity).toBeGreaterThan(plain);
  });

  it('needs no source at all while both note macros sit at their neutral', () => {
    // The feature stays free until someone opens the panel.
    const w = wiring(session());
    w.state.macros.energy = 0.5;
    w.state.macros.density = 0.5;
    expect(w.notesFor('lane1')).toBeUndefined();
  });

  it('leaves the lane untouched when its loops no longer exist', () => {
    // A save from another machine, or a deleted clip. Silence would be worse
    // than ignoring the weave.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:gone', b: 'clip:alsoGone', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')).toBeUndefined();
  });
});
