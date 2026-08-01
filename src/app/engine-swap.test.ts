import { describe, it, expect, vi } from 'vitest';
import { swapLaneEngineFlow, type EngineSwapDeps } from './engine-swap';
import type { SessionState } from '../session/session';
import { registerEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';

function makeState(): SessionState {
  return { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
    lanes: [
      { inserts: [],
        id: 'L',
        engineId: 'subtractive',
        engineState: { params: { 'filter.cutoff': 0.9 }, modulators: [] },
        enginePresetName: 'factory:Acid',
        clips: [
          { color: '#f4b8b8', gridResolution: '1/16',
            id: 'c',
            lengthBars: 1,
            notes: [],
            envelopes: [
              { paramId: 'filter.cutoff', values: [0, 1], enabled: true },
              { paramId: 'osc1.level', values: [1, 1], enabled: true },
            ],
          },
        ],
      },
    ],
    scenes: [],
    globalQuantize: '1/1',
  };
}

const EDITORS: Record<string, 'piano-roll' | 'drum-grid'> = {
  subtractive: 'piano-roll',
  fm: 'piano-roll',
  tb303: 'piano-roll',
  'drums-machine': 'drum-grid',
};
const PARAMS: Record<string, Set<string>> = {
  fm: new Set(['filter.cutoff', 'op1.level']), // shares filter.cutoff, not osc1.level
  subtractive: new Set(['filter.cutoff', 'osc1.level']),
};

function makeDeps(state: SessionState, over: Partial<EngineSwapDeps> = {}): EngineSwapDeps {
  return {
    state,
    getEngineEditor: (id) => EDITORS[id],
    getEngineParamIds: (id) => PARAMS[id] ?? new Set<string>(),
    swapLaneEngine: vi.fn(),
    onSwapped: vi.fn(),
    saveSession: vi.fn(),
    ...over,
  };
}

describe('swapLaneEngineFlow', () => {
  it('switches engineId, resets engineState + preset, fires side effects once', () => {
    const state = makeState();
    const deps = makeDeps(state);
    const ok = swapLaneEngineFlow(deps, 'L', 'fm');
    expect(ok).toBe(true);
    const lane = state.lanes[0];
    expect(lane.engineId).toBe('fm');
    expect(lane.engineState).toEqual({});
    expect(lane.enginePresetName).toBeUndefined();
    expect(deps.swapLaneEngine).toHaveBeenCalledWith('L', 'fm');
    expect(deps.onSwapped).toHaveBeenCalledWith('L', 'fm');
    expect(deps.saveSession).toHaveBeenCalledOnce();
  });

  it('reconciles envelopes: shared paramId kept enabled, missing paramId disabled', () => {
    const state = makeState();
    swapLaneEngineFlow(makeDeps(state), 'L', 'fm');
    const envs = state.lanes[0].clips[0]!.envelopes!;
    expect(envs.find((e) => e.paramId === 'filter.cutoff')!.enabled).toBe(true);
    expect(envs.find((e) => e.paramId === 'osc1.level')!.enabled).toBe(false);
  });

  it('no-op when target equals current engine', () => {
    const state = makeState();
    const deps = makeDeps(state);
    expect(swapLaneEngineFlow(deps, 'L', 'subtractive')).toBe(false);
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();
    expect(state.lanes[0].enginePresetName).toBe('factory:Acid'); // unchanged
  });

  it('no-op when target is a drum-grid engine', () => {
    const state = makeState();
    const deps = makeDeps(state);
    expect(swapLaneEngineFlow(deps, 'L', 'drums-machine')).toBe(false);
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();
    expect(state.lanes[0].engineId).toBe('subtractive');
  });

  it('no-op when the current lane engine is drum-grid', () => {
    const state = makeState();
    state.lanes[0].engineId = 'drums-machine';
    const deps = makeDeps(state);
    expect(swapLaneEngineFlow(deps, 'L', 'fm')).toBe(false);
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();
  });

  it('no-op when the lane id is unknown', () => {
    const state = makeState();
    const deps = makeDeps(state);
    expect(swapLaneEngineFlow(deps, 'ghost', 'fm')).toBe(false);
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();
  });

  it('rejects a swap into or out of an audio-editor engine, without naming any id', () => {
    // Since Task 6, `editor` only distinguishes the two NOTES views: an audio
    // engine can still answer 'piano-roll' (as it does here), so the editor
    // checks alone would let it through. Only the capability door's
    // isAudioEngine() catches it — that is exactly what this test proves by
    // making the editor check useless as a discriminator.
    __resetCapabilities();
    registerEngineCapabilities('probe-audio', { clipContent: 'audio', shortLabel: 'p', outputTrim: 1 });
    const state = makeState();
    const editors: Record<string, 'piano-roll' | 'drum-grid'> = {
      subtractive: 'piano-roll',
      'probe-audio': 'piano-roll',
    };
    const deps = makeDeps(state, { getEngineEditor: (id) => editors[id] });

    expect(swapLaneEngineFlow(deps, 'L', 'probe-audio')).toBe(false); // instrument -> audio
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();

    state.lanes[0].engineId = 'probe-audio';
    expect(swapLaneEngineFlow(deps, 'L', 'subtractive')).toBe(false); // audio -> instrument
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();
  });
});
