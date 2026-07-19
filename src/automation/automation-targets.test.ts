// @vitest-environment jsdom
// The automation destination catalogue must be derived from the SESSION, not
// from whatever knobs happen to be mounted. Two bugs motivated this:
//   1. Loading a save left the previous session's knob ids in the registry, so
//      the picker listed instruments that no longer exist.
//   2. An insert's params only entered the registry when that lane's editor
//      panel was open, so a fresh insert never showed up as a destination.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listAutomationTargets } from './automation-targets';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import type { FxInstance } from '../plugins/types';
import type { SessionState } from '../session/session';
import type { KnobHandle } from '../core/knob';

const FX_ID = 'test-fx-for-automation-targets';

function makeFakeFx(): FxInstance {
  const vals: Record<string, number> = { drive: 0.5, mix: 1 };
  return {
    input: {} as AudioNode, output: {} as AudioNode,
    getAudioParams: () => new Map(),
    getBaseValue: (id) => vals[id] ?? 0,
    setBaseValue: (id, v) => { vals[id] = v; },
    applyPreset: () => {},
    dispose: () => {},
  };
}

beforeEach(() => {
  _resetRegistry();
  registerPlugin({
    kind: 'fx',
    manifest: {
      id: FX_ID, name: 'Test FX', kind: 'fx', version: '1.0.0',
      params: [
        { id: 'drive', label: 'Drive', kind: 'continuous', min: 0, max: 1, default: 0.5 },
        { id: 'mix',   label: 'Mix',   kind: 'continuous', min: 0, max: 1, default: 1 },
        { id: 'mode',  label: 'Mode',  kind: 'discrete',   min: 0, max: 2, default: 0,
          options: [{ label: 'A', value: '0' }, { label: 'B', value: '1' }, { label: 'C', value: '2' }] },
      ],
      presets: [],
    },
    create: () => makeFakeFx(),
  });
});

afterEach(() => { _resetRegistry(); });

function sessionWithInsertLane(): SessionState {
  return {
    lanes: [
      {
        id: 'L1', name: 'Bass', engineId: 'tb303', clips: [],
        inserts: [{ id: 'a', pluginId: FX_ID, params: { drive: 0.5, mix: 1, mode: 0 }, bypass: false }],
      },
    ],
    scenes: [],
    globalQuantize: '1/1',
  } as unknown as SessionState;
}

describe('listAutomationTargets', () => {
  it('lists an insert param even though no knob for it is mounted', () => {
    // The registry is EMPTY — the lane editor was never opened. The insert is
    // still a legitimate automation destination because the session declares it.
    const targets = listAutomationTargets(sessionWithInsertLane(), new Map());
    const ids = targets.map((t) => t.id);

    expect(ids).toContain('L1.fx0.drive');
    expect(ids).toContain('L1.fx0.mix');
    // Discrete params are not continuous automation destinations.
    expect(ids).not.toContain('L1.fx0.mode');
  });

  it('carries the param range from the manifest, not from a live knob', () => {
    const target = listAutomationTargets(sessionWithInsertLane(), new Map())
      .find((t) => t.id === 'L1.fx0.drive');

    expect(target).toBeDefined();
    expect(target!.min).toBe(0);
    expect(target!.max).toBe(1);
    expect(target!.label).toBe('Drive');
    expect(target!.laneName).toBe('Bass');
  });

  it('omits registry entries belonging to lanes the session no longer has', () => {
    // Simulates the leak: a knob from a PREVIOUS session is still in the map.
    const stale = new Map<string, KnobHandle>([
      ['GHOST_LANE.cutoff', { meta: { id: 'GHOST_LANE.cutoff', label: 'Cutoff', min: 0, max: 1 } } as KnobHandle],
    ]);

    const ids = listAutomationTargets(sessionWithInsertLane(), stale).map((t) => t.id);

    expect(ids).not.toContain('GHOST_LANE.cutoff');
    expect(ids.every((id) => id.startsWith('L1.'))).toBe(true);
  });
});
