import { describe, it, expect } from 'vitest';
import { commitParam, commitParamForLane, commitEngineBaseValues } from './engine-param-commit';
import { withoutParamMirror } from '../session/session-engine-state';
import type { EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { SessionState } from '../session/session';

function stubEngine() {
  const written: Array<[string, number]> = [];
  return { written, setBaseValue: (id: string, v: number) => { written.push([id, v]); } };
}

/** An engine that actually HOLDS its params, so a bulk commit has something to
 *  read back. `applyPreset` stands in for any programmatic apply (preset recall,
 *  a user preset flattened to dot-ids, Randomize): it moves the base values
 *  without any knob's onChange firing. */
function statefulEngine(specs: EngineParamSpec[]) {
  const values = new Map(specs.map((s) => [s.id, s.default] as const));
  return {
    params: specs,
    getBaseValue: (id: string) => values.get(id) ?? 0,
    setBaseValue: (id: string, v: number) => { values.set(id, v); },
    applyPreset: () => { for (const s of specs) values.set(s.id, s.max); },
  };
}

const SPECS: EngineParamSpec[] = [
  { id: 'filter.cutoff', label: 'CUTOFF', kind: 'continuous', min: 0, max: 1, default: 0.5 },
  {
    id: 'osc1.wave', label: 'WAVE', kind: 'discrete', min: 0, max: 3, default: 0,
    options: [
      { value: 'saw', label: 'SAW' }, { value: 'sqr', label: 'SQR' },
      { value: 'tri', label: 'TRI' }, { value: 'sin', label: 'SIN' },
    ],
  },
];

const oneLane = (laneId: string): SessionState =>
  ({ lanes: [{ id: laneId, engineId: 'fm', clips: [], inserts: [] }] }) as unknown as SessionState;

const uiCtx = (laneId: string, sessionState?: SessionState): EngineUIContext =>
  ({ laneId, registerKnob: () => {}, registry: new Map(), sessionState }) as unknown as EngineUIContext;

const paramsOf = (state: SessionState, laneId: string) =>
  state.lanes.find((l) => l.id === laneId)?.engineState?.params;

describe('commitParam', () => {
  it('writes the engine AND mirrors the same value into the lane engineState', () => {
    const state = oneLane('fm-1');
    const engine = stubEngine();

    commitParam(engine, uiCtx('fm-1', state), 'op1.ratio', 3.5);

    // Relative: the mirrored value is whatever reached the engine, not a literal.
    expect(engine.written).toHaveLength(1);
    expect(engine.written[0][0]).toBe('op1.ratio');
    expect(paramsOf(state, 'fm-1')?.['op1.ratio']).toBe(engine.written[0][1]);
  });

  it('is a no-op on sessionState when ctx.sessionState is absent (the offline path)', () => {
    const engine = stubEngine();

    // The offline recorder builds engines with no session at all.
    expect(() => commitParam(engine, uiCtx('fm-1'), 'op1.ratio', 3.5)).not.toThrow();
    expect(engine.written).toHaveLength(1);
  });

  it('leaves an unknown lane untouched (mirror is a no-op, the engine still moves)', () => {
    const state = oneLane('fm-1');
    const engine = stubEngine();

    commitParam(engine, uiCtx('ghost-9', state), 'op1.ratio', 3.5);

    expect(engine.written).toHaveLength(1);
    expect(paramsOf(state, 'fm-1')).toBeUndefined();
  });

  it('skips the mirror inside withoutParamMirror but still drives the engine', () => {
    const state = oneLane('fm-1');
    const engine = stubEngine();

    withoutParamMirror(() => commitParam(engine, uiCtx('fm-1', state), 'op1.ratio', 3.5));

    expect(engine.written).toHaveLength(1);
    expect(paramsOf(state, 'fm-1')).toBeUndefined();
  });

  it('restores mirroring after withoutParamMirror returns, even if it throws', () => {
    const state = oneLane('fm-1');
    const engine = stubEngine();

    expect(() => withoutParamMirror(() => { throw new Error('boom'); })).toThrow();
    commitParam(engine, uiCtx('fm-1', state), 'op1.ratio', 3.5);

    expect(paramsOf(state, 'fm-1')?.['op1.ratio']).toBe(engine.written[0][1]);
  });
});

describe('commitParamForLane', () => {
  it('drives the engine and mirrors, given the session directly instead of a UI ctx', () => {
    const state = oneLane('fm-1');
    const engine = stubEngine();

    commitParamForLane(engine, state, 'fm-1', 'op1.ratio', 3.5);

    expect(engine.written).toHaveLength(1);
    expect(paramsOf(state, 'fm-1')?.['op1.ratio']).toBe(engine.written[0][1]);
  });

  it('still drives the engine when there is no session and inside withoutParamMirror', () => {
    const state = oneLane('fm-1');
    const engine = stubEngine();

    commitParamForLane(engine, undefined, 'fm-1', 'op1.ratio', 3.5);
    withoutParamMirror(() => commitParamForLane(engine, state, 'fm-1', 'op1.ratio', 3.5));

    expect(engine.written).toHaveLength(2);
    expect(paramsOf(state, 'fm-1')).toBeUndefined();
  });
});

describe('commitEngineBaseValues', () => {
  it('mirrors EVERY declared param, so a programmatic apply survives a save', () => {
    const state = oneLane('sub-1');
    const engine = statefulEngine(SPECS);

    engine.applyPreset();
    commitEngineBaseValues(engine, state, 'sub-1');

    // Relative: what is mirrored is whatever the engine now reports, spec by
    // spec — never a literal, and discrete params (a wave index) count too.
    const params = paramsOf(state, 'sub-1') ?? {};
    for (const spec of SPECS) expect(params[spec.id]).toBe(engine.getBaseValue(spec.id));
  });

  it('lets a later single-param edit win over the bulk snapshot', () => {
    const state = oneLane('sub-1');
    const engine = statefulEngine(SPECS);

    engine.applyPreset();
    commitEngineBaseValues(engine, state, 'sub-1');
    const fromPreset = paramsOf(state, 'sub-1')!['filter.cutoff'];
    commitParamForLane(engine, state, 'sub-1', 'filter.cutoff', SPECS[0].min);

    expect(paramsOf(state, 'sub-1')?.['filter.cutoff']).not.toBe(fromPreset);
    expect(paramsOf(state, 'sub-1')?.['filter.cutoff']).toBe(engine.getBaseValue('filter.cutoff'));
  });

  it('is a no-op without a session (the offline export path) and inside withoutParamMirror', () => {
    const state = oneLane('sub-1');
    const engine = statefulEngine(SPECS);
    engine.applyPreset();

    expect(() => commitEngineBaseValues(engine, undefined, 'sub-1')).not.toThrow();
    withoutParamMirror(() => commitEngineBaseValues(engine, state, 'sub-1'));

    expect(paramsOf(state, 'sub-1')).toBeUndefined();
  });
});

// Regression: the mixer-strip params (`bus.level`, `bus.pan`, `bus.sendA|B`,
// `bus.eq.*`) already persist as `lane.mixer` via strip.serialize(). They must
// not ALSO be mirrored into engineState.params — live-control-apply spells out
// why: "one number two owners, and on load whichever of restore(lane.mixer) /
// engineState-apply ran last would win". The bulk commit had no such guard, and
// descriptor-engine spreads STRIP_PARAM_SPECS into every engine's param list,
// so one preset recall stamped all seven into the lane's saved state.
describe('commitEngineBaseValues and the mixer-strip params', () => {
  const WITH_STRIP: EngineParamSpec[] = [
    ...SPECS,
    { id: 'bus.level', label: 'Vol', kind: 'continuous', min: 0, max: 1.5, default: 1 },
    { id: 'bus.sendB', label: 'B', kind: 'continuous', min: 0, max: 1, default: 0 },
  ];

  it('mirrors the engine own params but never the strip ones', () => {
    const engine = statefulEngine(WITH_STRIP);
    const state = oneLane('l1');

    engine.applyPreset(); // moves every base value, strip params included
    commitEngineBaseValues(engine, state, 'l1');

    const params = state.lanes[0].engineState?.params ?? {};
    expect(params['filter.cutoff'], 'the engine params still persist').toBe(1);
    expect('bus.level' in params, 'bus.level belongs to lane.mixer').toBe(false);
    expect('bus.sendB' in params, 'bus.sendB belongs to lane.mixer').toBe(false);
  });
});
