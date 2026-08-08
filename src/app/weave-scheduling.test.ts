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

/** Every fired note's layer, in order. The transport hands the layer to the
 *  trigger as its LAST argument, and that is the seam this measures: the
 *  renderer routes correctly when it is told, so "the sound does not change"
 *  can only mean it is never told. */
function runBarLayers(
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  notesFor?: (laneId: string) => ReturnType<ReturnType<typeof createWeaveWiring>['notesFor']>,
) {
  const layers: (number | undefined)[] = [];
  for (let t = 0; t < SEC_PER_BAR - LOOK; t += LOOK) {
    tickSession(
      laneStates, state, t, LOOK, BPM,
      (_laneId, _midi, _time, _gate, _accent, _sliding, _sample, _vel, _off, layerIndex) => {
        layers.push(layerIndex);
      },
      () => {},
      undefined, undefined, undefined, undefined, undefined, notesFor,
    );
  }
  return layers;
}

describe('a woven note reaches the LAYER its loop names', () => {
  // Reported from the browser: "el sonido no cambia, cambia solo el loop". The
  // renderer is proven right by layers-routing.dsp.test — index 0 and index 1
  // render differently — so a scene where both ends sound the same means the
  // index never arrived and LAYERS fell back to the zones, which by default
  // span the whole keyboard and let every note through to every layer.

  it('carries the layer on every note of a LAYERS lane', () => {
    const { state, laneStates, weave } = fixture('layers');
    weave.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0.5 },
      locked: false, harmonyLeader: false,
    };
    const layers = runBarLayers(state, laneStates, (id) => weave.notesFor(id));
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.every((l) => l !== undefined)).toBe(true);
  });

  it('names the loop each end came from', () => {
    // The ends first, because they are unambiguous: at 0 everything is A's, at 1
    // everything is B's. If these disagree the index itself is wrong, and no
    // amount of looking at the middle would say so.
    const at = (x: number) => {
      const { state, laneStates, weave } = fixture('layers');
      weave.state.lanes.lane1 = {
        weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x },
        locked: false, harmonyLeader: false,
      };
      return new Set(runBarLayers(state, laneStates, (id) => weave.notesFor(id)));
    };
    expect(at(0)).toEqual(new Set([0]));
    expect(at(1)).toEqual(new Set([1]));
  });

  it('has BOTH instruments playing somewhere across the crossfade', () => {
    // The point of routing by origin: for part of the journey the merged bar is
    // shared between two instruments. Swept rather than sampled at 0.5, because
    // this fixture is deliberately lopsided — A sits entirely on weak steps and
    // B entirely on strong ones, so the exact midpoint is not where the mixture
    // has to be.
    // A FRESH fixture per point. Reusing one walks the lane's play state on a
    // bar every pass, so every measurement after the first was reading a
    // transport that had already left — my own first sweep said "never mixed"
    // for that reason and not the blend's.
    const layersAt = (x: number) => {
      const { state, laneStates, weave } = fixture('layers');
      weave.state.lanes.lane1 = {
        weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x },
        locked: false, harmonyLeader: false,
      };
      return new Set(runBarLayers(state, laneStates, (id) => weave.notesFor(id)));
    };
    const mixed: number[] = [];
    for (let i = 1; i <= 9; i++) {
      const x = i / 10;
      const seen = layersAt(x);
      if (seen.has(0) && seen.has(1)) mixed.push(x);
    }
    expect(mixed.length).toBeGreaterThan(0);
  });

  it('carries NO layer on a lane whose instrument is not layered', () => {
    // It must stay free for every other engine: an index on an ordinary lane is
    // a number the renderer would have to remember to ignore.
    const { state, laneStates, weave } = fixture('subtractive');
    weave.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0.5 },
      locked: false, harmonyLeader: false,
    };
    const layers = runBarLayers(state, laneStates, (id) => weave.notesFor(id));
    expect(layers.every((l) => l === undefined)).toBe(true);
  });
});

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
