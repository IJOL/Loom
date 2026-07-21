// @vitest-environment jsdom
// Each insert's params must sit under their OWN sub-heading (the plugin's name),
// not lumped together under the bare lane/rack heading. A lane with two inserts
// should read "Bass · Reverb" and "Bass · Delay", not one flat "Bass". Duplicate
// plugins are numbered so two Delays don't merge into a single heading.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listAutomationTargets, groupTargetsByLane } from './automation-targets';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import type { FxInstance } from '../plugins/types';
import { emptySessionState, type SessionState } from '../session/session';

function fakeFx(): FxInstance {
  const vals: Record<string, number> = { amt: 0.5 };
  return {
    input: {} as AudioNode, output: {} as AudioNode,
    getAudioParams: () => new Map(),
    getBaseValue: (id) => vals[id] ?? 0,
    setBaseValue: (id, v) => { vals[id] = v; },
    applyPreset: () => {}, dispose: () => {},
  };
}

function registerFx(id: string, name: string): void {
  registerPlugin({
    kind: 'fx',
    manifest: {
      id, name, kind: 'fx', version: '1.0.0',
      params: [{ id: 'amt', label: 'Amt', kind: 'continuous', min: 0, max: 1, default: 0.5 }],
      presets: [],
    },
    create: () => fakeFx(),
  });
}

type Slot = { id: string; pluginId: string; params: Record<string, number>; bypass: boolean };

function stateWith(inserts: Slot[], master: Slot[] = []): SessionState {
  return {
    ...emptySessionState(),
    lanes: [{ id: 'L1', name: 'Bass', engineId: 'tb303', clips: [], inserts }],
    masterInserts: master,
  } as SessionState;
}

const slot = (id: string, pluginId: string): Slot => ({ id, pluginId, params: {}, bypass: false });

beforeEach(() => { _resetRegistry(); registerFx('rev', 'Reverb'); registerFx('dly', 'Delay'); });
afterEach(() => { _resetRegistry(); });

describe('insert params get a per-insert sub-group', () => {
  it('labels each insert by its plugin name', () => {
    const t = listAutomationTargets(stateWith([slot('a', 'rev'), slot('b', 'dly')]), new Map());
    expect(t.find((x) => x.id === 'L1.fx:a.amt')?.subGroup).toEqual({ key: 'a', label: 'Reverb' });
    expect(t.find((x) => x.id === 'L1.fx:b.amt')?.subGroup).toEqual({ key: 'b', label: 'Delay' });
  });

  it('numbers duplicate plugins so their headings do not merge', () => {
    const t = listAutomationTargets(stateWith([slot('a', 'dly'), slot('b', 'dly')]), new Map());
    expect(t.find((x) => x.id === 'L1.fx:a.amt')?.subGroup?.label).toBe('Delay 1');
    expect(t.find((x) => x.id === 'L1.fx:b.amt')?.subGroup?.label).toBe('Delay 2');
    const keys = [...groupTargetsByLane(t).keys()];
    expect(keys).toContain('Bass · Delay 1');
    expect(keys).toContain('Bass · Delay 2');
  });

  it('applies to the master rack too', () => {
    const t = listAutomationTargets(stateWith([], [slot('m', 'rev')]), new Map());
    expect(t.find((x) => x.id === 'fx.master.fx:m.amt')?.subGroup).toEqual({ key: 'm', label: 'Reverb' });
  });
});
