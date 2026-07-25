import { describe, it, expect } from 'vitest';
import { commitParam } from './engine-param-commit';
import { withoutParamMirror } from '../session/session-engine-state';
import type { EngineUIContext } from './engine-types';
import type { SessionState } from '../session/session';

function stubEngine() {
  const written: Array<[string, number]> = [];
  return { written, setBaseValue: (id: string, v: number) => { written.push([id, v]); } };
}

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
