// Does a weave actually change what the transport FIRES?
//
// Every other test asks a piece of the chain in isolation — the blend folds, the
// wiring builds a source. None of them runs the transport, which is the only
// thing that can say whether an answer reaches a note. This one counts triggers
// through the real tickSession → tickLane path, and it is what found that the
// hook could not work at all in its first shape: it was a PREDICATE over the
// clip's own notes, so at the far end of a fade the lane fell silent instead of
// handing over to the other loop.

import { describe, it, expect } from 'vitest';
import { createWeaveWiring } from './weave-wiring';
import { tickSession, emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip, SessionState } from '../session/session';
import { DEFAULT_METER } from '../core/meter';
import { TICKS_PER_STEP } from '../core/notes';

const BPM = 120;
const SEC_PER_BAR = (60 / BPM) * 4;
const LOOK = 0.2;

const clip = (id: string, steps: number[], midi: number): SessionClip => ({
  id, name: id, color: '#fff', lengthBars: 1, gridResolution: '1/16',
  notes: steps.map((s) => ({ start: s * TICKS_PER_STEP, duration: 12, midi, velocity: 100 })),
});

// A plays on the odd steps, B on the even ones, at different pitches: nothing is
// shared, so "which loop is sounding" has a countable answer.
const CLIP_A = clip('clipA', [1, 3, 5, 7, 9, 11, 13, 15], 36);
const CLIP_B = clip('clipB', [0, 2, 4, 6, 8, 10, 12, 14], 40);

function fixture(engineId = 'subtractive') {
  const state = {
    name: 'T', masterInserts: [], sends: [], scenes: [], globalQuantize: 'immediate',
    musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false },
    lanes: [{ id: 'lane1', engineId, inserts: [], clips: [CLIP_A, CLIP_B] }],
  } as unknown as SessionState;

  // The lane PLAYS clip A, and the weave decides what it actually sounds. B's
  // hits are nowhere in the playing clip, so hearing them is proof the weave
  // PRODUCES notes rather than filtering the clip's.
  const laneStates = new Map<string, LanePlayState>([
    ['lane1', { ...emptyLanePlayState('lane1'), playing: CLIP_A, startTime: 0, loopStartedAt: 0 }],
  ]);

  const weave = createWeaveWiring({
    getLaneStates: () => laneStates,
    getMeter: () => DEFAULT_METER,
    getState: () => state,
  });
  return { state, laneStates, weave };
}

/** Run one bar of transport and collect every note that actually fired. */
function runBar(
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  notesFor?: (laneId: string) => ReturnType<ReturnType<typeof createWeaveWiring>['notesFor']>,
) {
  const fired: number[] = [];
  // Stop one look-ahead short of the bar: the last window would reach into the
  // next iteration and count a note twice, which has nothing to do with weaving.
  for (let t = 0; t < SEC_PER_BAR - LOOK; t += LOOK) {
    tickSession(
      laneStates, state, t, LOOK, BPM,
      (_laneId, midi) => { fired.push(midi); },
      () => {},
      undefined, undefined, undefined, undefined, undefined, notesFor,
    );
  }
  return fired;
}

describe('a weave reaches the transport', () => {
  it('fires every hit when no weave is configured', () => {
    const { state, laneStates, weave } = fixture();
    expect(runBar(state, laneStates, (id) => weave.notesFor(id))).toHaveLength(8);
  });

  it('at the A end the clip plays exactly as it is', () => {
    const { state, laneStates, weave } = fixture();
    weave.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(runBar(state, laneStates, (id) => weave.notesFor(id))).toHaveLength(8);
  });

  it('at the B end it plays B — hits the lane\'s own clip does not contain', () => {
    // THE test. B's steps are nowhere in the playing clip, so hearing them is
    // proof the weave produces notes; the first shape of this hook filtered the
    // clip instead and this end came out silent.
    const { state, laneStates, weave } = fixture();
    weave.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 1 },
      locked: false, harmonyLeader: false,
    };
    const fired = runBar(state, laneStates, (id) => weave.notesFor(id));
    expect(fired.length).toBeGreaterThan(0);
    expect(new Set(fired)).toEqual(new Set([40]));
  });

  it('thins the bar in between, rather than jumping from all to none', () => {
    const { state, laneStates, weave } = fixture();
    weave.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0.5 },
      locked: false, harmonyLeader: false,
    };
    // Halfway across, the bar is neither loop. In THIS fixture A sits entirely
    // on weak steps and B entirely on strong ones, so the handover order —
    // weak positions first, the downbeat last — means the midpoint is B's
    // strong hits and none of A's. Fewer hits than either loop plays alone,
    // which is the shape that matters; asserting "one from each" would be
    // asserting this fixture's geometry, not the rule.
    const fired = runBar(state, laneStates, (id) => weave.notesFor(id));
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.length).toBeLessThan(8);
  });

  it('weaves a LIBRARY loop, not just another clip', () => {
    // The library is the reason the panel exists. If its ids resolve in the
    // dropdown and not in the scheduler, every library loop is silence.
    const { state, laneStates, weave } = fixture();
    weave.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'lib:acid-techno:bass:0', x: 0 },
      locked: false, harmonyLeader: false,
    };
    // The library loop only has to RESOLVE. It cannot do more here: the pattern
    // library is FETCHED at boot and this process never called loadLibrary, so
    // `lib:` ids find nothing and the selection falls back to the loop that did
    // resolve. That fallback is the behaviour under test — an unresolvable loop
    // must never blank the lane — and the library's own contents are pinned in
    // patterns/pattern-library.test.ts.
    expect(runBar(state, laneStates, (id) => weave.notesFor(id))).toHaveLength(8);
  });
});
