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

const tick = (step: number) => step * TICKS_PER_STEP;

describe('createWeaveWiring — the gate actually reaches the scheduler', () => {
  it('has nothing to say about an untouched lane', () => {
    // The whole feature is additive: a session nobody has woven schedules
    // exactly as it did before the panel existed.
    expect(wiring(session()).gateFor('lane1')).toBeUndefined();
  });

  it('builds a gate once a lane names its loops', () => {
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(typeof w.gateFor('lane1')).toBe('function');
  });

  it('lets A through at one end and refuses it at the other', () => {
    // This is the assertion the browser could not make: if the gate is not
    // wired, both ends answer the same and the crossfade does nothing.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    const atA = w.gateFor('lane1')!;
    expect(atA({ midi: 36 }, 0, tick(0))).not.toBe(false);
    expect(atA({ midi: 40 }, 0, tick(8))).toBe(false);

    w.state.lanes.lane1.weave = { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 1 };
    w.invalidate();
    const atB = w.gateFor('lane1')!;
    expect(atB({ midi: 40 }, 0, tick(8))).not.toBe(false);
    expect(atB({ midi: 36 }, 0, tick(0))).toBe(false);
  });

  it('answers plainly on a lane whose instrument has no layers', () => {
    const w = wiring(session('subtractive'));
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.gateFor('lane1')!({ midi: 36 }, 0, tick(0))).toBe(true);
  });

  it('names the loop on a LAYERS lane, so each note reaches its own instrument', () => {
    const w = wiring(session('layers'));
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.gateFor('lane1')!({ midi: 36 }, 0, tick(0))).toBe(0);
  });

  it('drops the cached gate when the weave moves', () => {
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    const first = w.gateFor('lane1');
    expect(w.gateFor('lane1')).toBe(first);   // cached while nothing changed
    w.invalidate();
    expect(w.gateFor('lane1')).not.toBe(first);
  });

  it('leaves the lane untouched when its loops no longer exist', () => {
    // A save from another machine, or a deleted clip. Silence would be worse
    // than ignoring the weave.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:gone', b: 'clip:alsoGone', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.gateFor('lane1')).toBeUndefined();
  });
});
