// @vitest-environment jsdom
//
// Regression: playing back a Performance take stamped its recorded knob
// automation permanently into `lane.engineState.params`. Save after playback and
// the lane's BASE sound was wherever the automation happened to leave the knob.
//
// Automation is a property of the take, not of the lane: the take already
// carries the curve, and replaying it must reproduce the same sound from the
// same base. The clip-envelope sibling (automation-tick) drives its knobs inside
// `withoutParamMirror` for exactly this reason, and so does the unmounted
// fallback (applyAutomationToSession writes the engine and never the session).
// The arrangement path was the one that did not.

import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { createPerformanceFeature } from './performance-feature';
import { startArrangement } from '../performance/arrangement-runtime';
import { buildEngineParamGrid } from '../engines/engine-param-grid';
import type { EngineParamSpec } from '../engines/engine-params';
import type { EngineUIContext } from '../engines/engine-types';
import type { KnobHandle } from '../core/knob';
import type { SessionState } from '../session/session';

const LANE = 'subtractive-1';
const CUTOFF: EngineParamSpec =
  { id: 'filter.cutoff', label: 'CUTOFF', kind: 'continuous', min: 0, max: 1, default: 0.5 };

function stubEngine() {
  const values = new Map([[CUTOFF.id, CUTOFF.default]]);
  return {
    id: 'subtractive', params: [CUTOFF],
    getBaseValue: (id: string) => values.get(id) ?? 0,
    setBaseValue: (id: string, v: number) => { values.set(id, v); },
  };
}

/** A real mounted knob (its onChange goes through commitParam, exactly as on
 *  screen) registered under the canonical destination id the take's curve
 *  addresses. */
function fixture() {
  const state = {
    lanes: [{ id: LANE, engineId: 'subtractive', clips: [], inserts: [] }],
  } as unknown as SessionState;
  const automationRegistry = new Map<string, KnobHandle>();
  const ctx = {
    laneId: LANE,
    registerKnob: (k: KnobHandle) => { if (k.meta?.id) automationRegistry.set(k.meta.id, k); },
    registry: automationRegistry,
    sessionState: state,
  } as unknown as EngineUIContext;
  buildEngineParamGrid(stubEngine(), ctx, document.createElement('div'));

  const audioCtx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
  const pf = createPerformanceFeature({
    ctx: audioCtx,
    seq: { bpm: 120, meter: { num: 4, den: 4 }, isPlaying: () => false, stop: () => {}, start: () => {} },
    sessionHost: {
      state, laneStates: new Map(), deps: {},
      songAnchorSec: 0,
      setSongAnchor(sec: number) { this.songAnchorSec = sec; },
      globalLoopForUI: () => ({ enabled: false, startBar: 0, endBar: 0 }),
      setGlobalLoop: () => {},
    },
    automationRegistry,
    onRegisterKnob: () => {},
  } as unknown as Parameters<typeof createPerformanceFeature>[0]);

  return { pf, state, audioCtx, knob: automationRegistry.get(`${LANE}.${CUTOFF.id}`)! };
}

const savedCutoff = (state: SessionState) =>
  state.lanes[0].engineState?.params?.[CUTOFF.id];

/** The knob's on-screen position, 0..1 — the same attribute the take recorder
 *  reads back, so "did the knob move" needs no engine of its own. */
const norm = (k: KnobHandle) => Number(k.el.getAttribute('data-value-norm'));

describe('Performance take automation does not become the lane base sound', () => {
  it('replaying a curve moves the knob but leaves engineState.params on the user value', () => {
    const f = fixture();

    // The user dials in a base sound: this one DOES mirror.
    f.knob.setValue(CUTOFF.min);
    const dialledIn = savedCutoff(f.state);
    const normAfterEdit = norm(f.knob);
    expect(dialledIn, 'precondition: a user edit reaches engineState.params').toBeDefined();

    // A recorded take drives the same param to the other end of its range.
    f.pf.setArrangement({
      bpm: 120, meter: { num: 4, den: 4 }, durationSec: 8, lengthBars: 4,
      lanes: [], loopEnabled: false,
      globalAutomation: [{ paramId: `${LANE}.${CUTOFF.id}`, values: [1] }],
    } as never);
    f.pf.setMode('performance');
    startArrangement(f.pf.arrangementPlayState, f.audioCtx.currentTime);
    f.pf.onLookahead(f.audioCtx.currentTime, 0.1);

    // The automation landed on the knob...
    expect(norm(f.knob), 'the take moved the knob').toBeGreaterThan(normAfterEdit);
    // ...but the lane's saved base sound is still the one the user dialled in.
    expect(savedCutoff(f.state)).toBe(dialledIn);
  });
});
