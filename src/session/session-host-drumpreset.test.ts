import { describe, it, expect, beforeEach } from 'vitest';
import { SessionHost } from './session-host';
import { loadDrumKits, __resetDrumKitsCache } from '../presets/drum-kits-loader';

(globalThis as unknown as { document: unknown }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

async function seedDrumKits() {
  __resetDrumKitsCache();
  await loadDrumKits((async () => ({ ok: true, json: async () => ({ presets: [
    { name: 'TR-909', group: 'Synth', kind: 'synth', kitId: '909' },
    { name: 'TR-808 (samples)', group: 'Samples', kind: 'sample', drumkitId: 'tr808' },
  ] }) })) as unknown as typeof fetch);
}

describe('SessionHost.applyDrumPreset', () => {
  beforeEach(async () => { await seedDrumKits(); });

  it('synth pick: applies preset + persists kitMode/enginePresetName', async () => {
    const calls: string[] = [];
    const engine = {
      id: 'drums-machine',
      applyPreset: (n: string) => calls.push(`apply:${n}`),
      setKitMode: () => {},
      setKeymap: () => {},
      getBaseValue: () => 0,
      setBaseValue: () => {},
    };
    const laneResources = {
      get: (id: string) => (id === 'drums-1' ? { engine } : undefined),
      ids: () => ['drums-1'],
      dispose: () => {},
    };
    const host = new SessionHost({ laneResources } as unknown as ConstructorParameters<typeof SessionHost>[0]);
    host.state.lanes = [{ id: 'drums-1', engineId: 'drums-machine', clips: [] }];

    await host.applyDrumPreset('drums-1', 'TR-909');

    expect(calls).toContain('apply:TR-909');
    const lane = host.state.lanes.find((l) => l.id === 'drums-1')!;
    expect(lane.engineState?.kitMode).toBe('synth');
    expect(lane.enginePresetName).toBe('engine:TR-909');
  });
});
