import { describe, it, expect } from 'vitest';
import { SessionHost } from './session-host';
import { fakeDestinations } from './fake-destinations';

// Minimal DOM stub so any incidental document access is a no-op under node.
(globalThis as unknown as { document: unknown }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

describe('SessionHost.applyEngineState — sample-kit restore round-trip', () => {
  it('restores kitMode + keymap + padStore onto the lane engine (embedded sampler)', () => {
    // The façade forwards setKeymap/setPadStore to its embedded sampler, so the
    // EXISTING load-restore path (feature-detected on the lane engine) reaches it.
    const calls: { setKitMode?: string; setKeymap?: unknown; setPadStore?: unknown } = {};
    const engine = {
      id: 'drums-machine',
      setKitMode: (m: string) => { calls.setKitMode = m; },
      setKeymap: (k: unknown) => { calls.setKeymap = k; },
      getKeymap: () => [],
      setPadStore: (s: unknown) => { calls.setPadStore = s; },
      getPadStore: () => ({}),
      setBaseValue: () => {},
      getBaseValue: () => 0,
    };
    const laneResources = {
      get: (id: string) => (id === 'drums-1' ? { engine } : undefined),
      ids: () => ['drums-1'],
      dispose: () => {},
    };
    const host = new SessionHost({ laneResources, destinations: fakeDestinations() } as unknown as ConstructorParameters<typeof SessionHost>[0]);
    const keymap = [{ sampleId: 's-kick', rootNote: 36, loNote: 36, hiNote: 36 }];
    const padParams = { 36: { tune: 3 } };
    host.state.lanes = [{ inserts: [],
      id: 'drums-1', engineId: 'drums-machine', clips: [],
      engineState: { kitMode: 'sample', sampler: { drumkitId: 'tr808', keymap, padParams } },
    }];

    (host as unknown as { applyEngineState(): void }).applyEngineState();

    // Mode restored first, then the persisted keymap + per-pad overrides land on
    // the embedded sampler (via the façade forwarders). The drumkitId self-heal
    // (reloadDrumkit) is fire-and-forget + try/caught, so its async fetch failure
    // under node does not affect these synchronous restores.
    expect(calls.setKitMode).toBe('sample');
    expect(calls.setKeymap).toEqual(keymap);
    expect(calls.setPadStore).toEqual(padParams);
  });
});
