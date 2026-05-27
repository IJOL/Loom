// Tests for the connection binder: stateful re-binding of modulator
// connections so that adding/removing a connection AFTER voice creation
// actually updates the audio graph.

import { describe, it, expect } from 'vitest';
import { ConnectionBinder } from './connection-binder';
import type { ModulatorState, ModulatorVoice } from './types';

// ── Minimal Web Audio mock ────────────────────────────────────────────────

interface MockGain {
  kind: 'gain';
  gain: { value: number };
  connections: MockNode[];
  disconnected: boolean;
  connect(target: MockNode): void;
  disconnect(): void;
}
interface MockParam {
  kind: 'param';
  name: string;
  inputs: MockGain[];      // gains connected INTO this param
}
type MockNode = MockGain | MockParam;

function makeMockGain(): MockGain {
  const g: MockGain = {
    kind: 'gain',
    gain: { value: 0 },
    connections: [],
    disconnected: false,
    connect(target) { this.connections.push(target); if (target.kind === 'param') target.inputs.push(this); },
    disconnect() { this.disconnected = true; this.connections.length = 0; },
  };
  return g;
}
function makeMockParam(name: string): MockParam {
  return { kind: 'param', name, inputs: [] };
}
function makeMockCtx(): { createGain(): MockGain; createdGains: MockGain[] } {
  const createdGains: MockGain[] = [];
  return {
    createGain() { const g = makeMockGain(); createdGains.push(g); return g; },
    createdGains,
  };
}

function makeMockVoice(): ModulatorVoice {
  const output = makeMockGain();
  return {
    output: output as unknown as AudioNode,
    trigger() {},
    release() {},
    dispose() {},
    currentValue() { return 0; },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ConnectionBinder', () => {
  it('starts with zero active bindings', () => {
    const binder = new ConnectionBinder();
    expect(binder.activeCount()).toBe(0);
  });

  it('apply() with one connection creates a gain node and wires src → gain → dest', () => {
    const ctx = makeMockCtx();
    const voice = makeMockVoice();
    const dest = makeMockParam('cutoff');

    const binder = new ConnectionBinder();
    const mods: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true,
      connections: [{ id: 'c1', paramId: 'cutoff', depth: 0.5 }],
    }];

    binder.apply(
      new Map([['lfo1', voice]]),
      mods,
      { cutoff: dest as unknown as AudioParam },
      { cutoff: { min: 0, max: 1 } },
      ctx as unknown as AudioContext,
    );

    expect(binder.activeCount()).toBe(1);
    expect(ctx.createdGains).toHaveLength(1);
    const g = ctx.createdGains[0];
    expect(g.gain.value).toBeCloseTo(0.5);            // depth * range
    // gain output connects to dest
    expect(g.connections).toContain(dest);
    expect(dest.inputs).toContain(g);
  });

  it('apply() called AGAIN with a NEW connection adds a fresh gain (the audible bug fix)', () => {
    // This is the core bug: when the user adds a connection AFTER voice
    // creation, calling apply() again should create the new binding.
    const ctx = makeMockCtx();
    const voice = makeMockVoice();
    const dest = makeMockParam('cutoff');
    const paramMap = { cutoff: dest as unknown as AudioParam };
    const ranges = { cutoff: { min: 0, max: 1 } };

    const binder = new ConnectionBinder();
    const empty: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true, connections: [],
    }];
    binder.apply(new Map([['lfo1', voice]]), empty, paramMap, ranges, ctx as unknown as AudioContext);
    expect(binder.activeCount()).toBe(0);
    expect(ctx.createdGains).toHaveLength(0);

    const withConn: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true,
      connections: [{ id: 'c1', paramId: 'cutoff', depth: 1.0 }],
    }];
    binder.apply(new Map([['lfo1', voice]]), withConn, paramMap, ranges, ctx as unknown as AudioContext);

    expect(binder.activeCount()).toBe(1);
    expect(ctx.createdGains).toHaveLength(1);
    expect(ctx.createdGains[0].gain.value).toBeCloseTo(1);
    expect(ctx.createdGains[0].connections).toContain(dest);
  });

  it('apply() with a removed connection disconnects + disposes the gain', () => {
    const ctx = makeMockCtx();
    const voice = makeMockVoice();
    const dest = makeMockParam('cutoff');
    const paramMap = { cutoff: dest as unknown as AudioParam };
    const ranges = { cutoff: { min: 0, max: 1 } };

    const binder = new ConnectionBinder();
    const withConn: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true,
      connections: [{ id: 'c1', paramId: 'cutoff', depth: 0.5 }],
    }];
    binder.apply(new Map([['lfo1', voice]]), withConn, paramMap, ranges, ctx as unknown as AudioContext);
    expect(binder.activeCount()).toBe(1);
    const g = ctx.createdGains[0];
    expect(g.disconnected).toBe(false);

    // Now remove the connection
    const noConn: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true, connections: [],
    }];
    binder.apply(new Map([['lfo1', voice]]), noConn, paramMap, ranges, ctx as unknown as AudioContext);
    expect(binder.activeCount()).toBe(0);
    expect(g.disconnected).toBe(true);
  });

  it('apply() with a changed depth reuses the gain node (just updates gain.value)', () => {
    const ctx = makeMockCtx();
    const voice = makeMockVoice();
    const dest = makeMockParam('cutoff');
    const paramMap = { cutoff: dest as unknown as AudioParam };
    const ranges = { cutoff: { min: 0, max: 1 } };
    const binder = new ConnectionBinder();

    binder.apply(
      new Map([['lfo1', voice]]),
      [{ id: 'lfo1', kind: 'lfo', enabled: true, connections: [{ id: 'c1', paramId: 'cutoff', depth: 0.2 }] }],
      paramMap, ranges, ctx as unknown as AudioContext,
    );
    binder.apply(
      new Map([['lfo1', voice]]),
      [{ id: 'lfo1', kind: 'lfo', enabled: true, connections: [{ id: 'c1', paramId: 'cutoff', depth: 0.9 }] }],
      paramMap, ranges, ctx as unknown as AudioContext,
    );

    expect(ctx.createdGains).toHaveLength(1);                // same node
    expect(ctx.createdGains[0].gain.value).toBeCloseTo(0.9); // updated
  });

  it('resolves prefixed paramIds like "tb303.cutoff" against bare voiceParamMap keys', () => {
    const ctx = makeMockCtx();
    const voice = makeMockVoice();
    const dest = makeMockParam('cutoff');
    const binder = new ConnectionBinder();

    binder.apply(
      new Map([['lfo1', voice]]),
      [{ id: 'lfo1', kind: 'lfo', enabled: true,
         connections: [{ id: 'c1', paramId: 'tb303.cutoff', depth: 0.5 }] }],
      { cutoff: dest as unknown as AudioParam },
      { cutoff: { min: 0, max: 1 } },
      ctx as unknown as AudioContext,
    );

    expect(binder.activeCount()).toBe(1);
    expect(ctx.createdGains[0].connections).toContain(dest);
  });

  it('skips disabled modulators (no gain created)', () => {
    const ctx = makeMockCtx();
    const voice = makeMockVoice();
    const dest = makeMockParam('cutoff');
    const binder = new ConnectionBinder();

    binder.apply(
      new Map([['lfo1', voice]]),
      [{ id: 'lfo1', kind: 'lfo', enabled: false,
         connections: [{ id: 'c1', paramId: 'cutoff', depth: 0.5 }] }],
      { cutoff: dest as unknown as AudioParam },
      { cutoff: { min: 0, max: 1 } },
      ctx as unknown as AudioContext,
    );

    expect(binder.activeCount()).toBe(0);
    expect(ctx.createdGains).toHaveLength(0);
  });
});
