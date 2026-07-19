import { describe, it, expect, beforeEach } from 'vitest';
import { SessionHost } from './session-host';
import { loadDrumKits, __resetDrumKitsCache } from '../presets/drum-kits-loader';
import { fakeDestinations } from './fake-destinations';

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
    const host = new SessionHost({ laneResources, destinations: fakeDestinations() } as unknown as ConstructorParameters<typeof SessionHost>[0]);
    host.state.lanes = [{ id: 'drums-1', engineId: 'drums-machine', clips: [] }];

    await host.applyDrumPreset('drums-1', 'TR-909');

    expect(calls).toContain('apply:TR-909');
    const lane = host.state.lanes.find((l) => l.id === 'drums-1')!;
    expect(lane.engineState?.kitMode).toBe('synth');
    expect(lane.enginePresetName).toBe('engine:TR-909');
  });

  it('prunes stale per-voice params (keeps bus.*) on a kit-mode switch', async () => {
    const engine = {
      id: 'drums-machine',
      applyPreset: () => {},
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
    const host = new SessionHost({ laneResources, destinations: fakeDestinations() } as unknown as ConstructorParameters<typeof SessionHost>[0]);
    // Lane was edited in synth mode: per-voice 'kick.tune' (synth range) + a
    // mode-agnostic 'bus.level' mirrored into engineState.params.
    host.state.lanes = [{
      id: 'drums-1', engineId: 'drums-machine', clips: [],
      engineState: { kitMode: 'synth', params: { 'kick.tune': 1.6, 'bus.level': 1.2 } },
    }];

    await host.applyDrumPreset('drums-1', 'TR-808 (samples)'); // synth → sample

    const params = host.state.lanes[0].engineState!.params!;
    expect('kick.tune' in params).toBe(false); // stale synth per-voice id dropped
    expect(params['bus.level']).toBe(1.2);     // mode-agnostic bus.* kept
    expect(host.state.lanes[0].engineState!.kitMode).toBe('sample');
  });
});
