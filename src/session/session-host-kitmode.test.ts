import { describe, it, expect } from 'vitest';
import { SessionHost } from './session-host';
import { fakeDestinations } from './fake-destinations';

// Minimal DOM stub so any incidental document access is a no-op under node.
(globalThis as unknown as { document: unknown }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

describe('SessionHost.applyEngineState — kitMode restore', () => {
  it('calls setKitMode on the lane engine from engineState.kitMode', () => {
    const calls: string[] = [];
    const engine = {
      id: 'drums-machine',
      setKitMode: (m: string) => calls.push(m),
      setBaseValue: () => {},
      getBaseValue: () => 0,
    };
    const laneResources = {
      get: (id: string) => (id === 'drums-1' ? { engine } : undefined),
      ids: () => ['drums-1'],
      dispose: () => {},
    };
    const host = new SessionHost({ laneResources, destinations: fakeDestinations() } as unknown as ConstructorParameters<typeof SessionHost>[0]);
    host.state.lanes = [
      { id: 'drums-1', engineId: 'drums-machine', clips: [], engineState: { kitMode: 'sample' } },
    ];
    (host as unknown as { applyEngineState(): void }).applyEngineState();
    expect(calls).toContain('sample');
  });

  it('resets a reused façade to synth when the loaded lane omits kitMode', () => {
    // The DrumsEngine façade is reused across loads; after a sample-kit session,
    // loading a lane with NO kitMode (New Session / synth session) must RESET to
    // 'synth', not leave the engine stuck in sample mode.
    const calls: string[] = [];
    const engine = {
      id: 'drums-machine',
      setKitMode: (m: string) => calls.push(m),
      setBaseValue: () => {},
      getBaseValue: () => 0,
    };
    const laneResources = {
      get: (id: string) => (id === 'drums-1' ? { engine } : undefined),
      ids: () => ['drums-1'],
      dispose: () => {},
    };
    const host = new SessionHost({ laneResources, destinations: fakeDestinations() } as unknown as ConstructorParameters<typeof SessionHost>[0]);
    host.state.lanes = [
      { id: 'drums-1', engineId: 'drums-machine', clips: [], engineState: {} }, // no kitMode
    ];
    (host as unknown as { applyEngineState(): void }).applyEngineState();
    expect(calls).toEqual(['synth']);
  });
});
