// Integration tests for the voice ⇄ modulator binding helper. Verifies the
// fix for the original bug: an LFO connected to a destination AudioParam in
// the UI was silent because no gain bridge was ever built. After these tests
// pass, bindVoiceModulators creates that bridge.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  bindVoiceModulators, bindEngineModulators,
  reapplyLaneModulations, disposeLaneModulations,
  _resetLaneBindingsForTesting, _getLaneBindingForTesting,
} from './voice-mod-binding';
import type { ModulatorVoice, ModulatorState, ModulationHost } from './types';
import type { Voice } from '../engines/engine-types';
import type { SynthEngine } from '../engines/engine-types';
import type { EngineParamSpec } from '../engines/engine-params';

// ── Minimal Web Audio mock ────────────────────────────────────────────────

interface MockGain { kind: 'gain'; gain: { value: number }; disconnected: boolean; targets: unknown[]; connect(t: unknown): void; disconnect(): void; }
interface MockParam { kind: 'param'; name: string; inputs: MockGain[]; }
function makeMockGain(): MockGain {
  return {
    kind: 'gain', gain: { value: 0 }, disconnected: false, targets: [],
    connect(t) { this.targets.push(t); if ((t as { kind?: string }).kind === 'param') (t as MockParam).inputs.push(this); },
    disconnect() { this.disconnected = true; this.targets.length = 0; },
  };
}
function makeMockParam(name: string): MockParam { return { kind: 'param', name, inputs: [] }; }
function makeMockCtx(): AudioContext {
  return { createGain() { return makeMockGain(); } } as unknown as AudioContext;
}

// ── Mock SynthEngine + Voice + Host ────────────────────────────────────────

function makeMockModulatorVoice(): ModulatorVoice {
  const out = makeMockGain();
  return {
    output: out as unknown as AudioNode,
    trigger() {}, release() {}, dispose() {}, currentValue() { return 0; },
  };
}

function makeMockHost(mods: ModulatorState[]): ModulationHost {
  return {
    modulators: mods,
    addModulator() { throw new Error('unused'); },
    removeModulator() {},
    setConnection() {},
    removeConnection() {},
    spawnVoice() { return new Map(); },
    spawnVoiceFiltered() { return new Map(); },
    serialize() { return mods; },
    deserialize() {},
  };
}

function makeMockEngine(params: EngineParamSpec[], host: ModulationHost): SynthEngine {
  return {
    id: 'mock', name: 'Mock', type: 'polyhost', polyphony: 'mono', editor: 'piano-roll',
    params, presets: [],
    modulators: host,
    getBaseValue: () => 0, setBaseValue: () => {},
    createVoice: () => ({}) as Voice,
    buildSequencer: () => ({} as never),
    buildParamUI: () => {},
    applyPreset: () => {},
    dispose: () => {},
  };
}

function makeMockVoice(params: Map<string, AudioParam>): Voice {
  return {
    trigger() {}, release() {}, connect() {}, dispose() {},
    getAudioParams() { return params; },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('voice-mod-binding integration', () => {
  beforeEach(() => { _resetLaneBindingsForTesting(); });

  it('binds an LFO routed to filter.resonance — gain bridge is created', () => {
    const ctx = makeMockCtx();
    const dest = makeMockParam('Q');
    const voice = makeMockVoice(new Map([['filter.resonance', dest as unknown as AudioParam]]));
    const mods: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true, scope: 'per-voice',
      connections: [{ id: 'c1', paramId: 'bass.filter.resonance', depth: 0.5 }],
    }];
    const host = makeMockHost(mods);
    const engine = makeMockEngine(
      [{ id: 'filter.resonance', label: 'Res', kind: 'continuous', min: 0, max: 1, default: 0 }],
      host,
    );
    const voiceMods = new Map<string, ModulatorVoice>([['lfo1', makeMockModulatorVoice()]]);

    const binder = bindVoiceModulators({ laneId: 'bass', engine, voice, voiceMods, ctx });

    expect(binder.activeCount()).toBe(1);
    expect(dest.inputs).toHaveLength(1);            // gain → dest
    expect(dest.inputs[0].gain.value).toBeCloseTo(0.5);   // depth * range = 0.5 * 1
  });

  it('mismatched paramId (wrong lane prefix) yields no binding — the destMap key must be full', () => {
    const ctx = makeMockCtx();
    const dest = makeMockParam('Q');
    const voice = makeMockVoice(new Map([['filter.resonance', dest as unknown as AudioParam]]));
    const mods: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true, scope: 'per-voice',
      // Connection targets the 'poly' lane but the voice is on 'bass'.
      connections: [{ id: 'c1', paramId: 'poly.filter.resonance', depth: 0.5 }],
    }];
    const host = makeMockHost(mods);
    const engine = makeMockEngine(
      [{ id: 'filter.resonance', label: 'Res', kind: 'continuous', min: 0, max: 1, default: 0 }],
      host,
    );
    const voiceMods = new Map<string, ModulatorVoice>([['lfo1', makeMockModulatorVoice()]]);

    const binder = bindVoiceModulators({ laneId: 'bass', engine, voice, voiceMods, ctx });

    expect(binder.activeCount()).toBe(0);
    expect(dest.inputs).toHaveLength(0);
  });

  it('reapplyLaneModulations() picks up a new connection added AFTER voice creation', () => {
    const ctx = makeMockCtx();
    const dest = makeMockParam('Q');
    const voice = makeMockVoice(new Map([['filter.resonance', dest as unknown as AudioParam]]));
    const mods: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true, scope: 'per-voice', connections: [],
    }];
    const host = makeMockHost(mods);
    const engine = makeMockEngine(
      [{ id: 'filter.resonance', label: 'Res', kind: 'continuous', min: 0, max: 1, default: 0 }],
      host,
    );
    const voiceMods = new Map<string, ModulatorVoice>([['lfo1', makeMockModulatorVoice()]]);
    bindVoiceModulators({ laneId: 'bass', engine, voice, voiceMods, ctx });
    expect(dest.inputs).toHaveLength(0);

    // Simulate user wiring a new connection via the modulator panel UI.
    mods[0].connections.push({ id: 'c1', paramId: 'bass.filter.resonance', depth: 1.0 });
    reapplyLaneModulations('bass');

    const lookup = _getLaneBindingForTesting('bass');
    expect(lookup?.binder.activeCount()).toBe(1);
    expect(dest.inputs).toHaveLength(1);
    expect(dest.inputs[0].gain.value).toBeCloseTo(1.0);
  });

  it('disposeLaneModulations() tears down the binder', () => {
    const ctx = makeMockCtx();
    const dest = makeMockParam('Q');
    const voice = makeMockVoice(new Map([['filter.resonance', dest as unknown as AudioParam]]));
    const mods: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true, scope: 'per-voice',
      connections: [{ id: 'c1', paramId: 'bass.filter.resonance', depth: 0.5 }],
    }];
    const engine = makeMockEngine(
      [{ id: 'filter.resonance', label: 'Res', kind: 'continuous', min: 0, max: 1, default: 0 }],
      makeMockHost(mods),
    );
    const voiceMods = new Map<string, ModulatorVoice>([['lfo1', makeMockModulatorVoice()]]);

    bindVoiceModulators({ laneId: 'bass', engine, voice, voiceMods, ctx });
    expect(_getLaneBindingForTesting('bass')).toBeDefined();

    disposeLaneModulations('bass');
    expect(_getLaneBindingForTesting('bass')).toBeUndefined();
  });

  it('rebinding the same lane disposes the previous binder (no leak across voices)', () => {
    const ctx = makeMockCtx();
    const dest = makeMockParam('Q');
    const voice1 = makeMockVoice(new Map([['filter.resonance', dest as unknown as AudioParam]]));
    const voice2 = makeMockVoice(new Map([['filter.resonance', dest as unknown as AudioParam]]));
    const mods: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true, scope: 'per-voice',
      connections: [{ id: 'c1', paramId: 'bass.filter.resonance', depth: 0.5 }],
    }];
    const engine = makeMockEngine(
      [{ id: 'filter.resonance', label: 'Res', kind: 'continuous', min: 0, max: 1, default: 0 }],
      makeMockHost(mods),
    );
    const voiceMods1 = new Map<string, ModulatorVoice>([['lfo1', makeMockModulatorVoice()]]);
    const voiceMods2 = new Map<string, ModulatorVoice>([['lfo1', makeMockModulatorVoice()]]);

    const b1 = bindVoiceModulators({ laneId: 'bass', engine, voice: voice1, voiceMods: voiceMods1, ctx });
    expect(b1.activeCount()).toBe(1);
    const b2 = bindVoiceModulators({ laneId: 'bass', engine, voice: voice2, voiceMods: voiceMods2, ctx });
    expect(b2.activeCount()).toBe(1);
    // The first binder was disposed during the second bindVoiceModulators call.
    expect(b1.activeCount()).toBe(0);
  });

  it('falls back to 0..1 range when an AudioParam lacks an EngineParamSpec entry', () => {
    // The voice exposes amp.gain but the engine schema doesn't declare it.
    // Modulator output is already normalized so 0..1 is the correct default.
    const ctx = makeMockCtx();
    const dest = makeMockParam('amp');
    const voice = makeMockVoice(new Map([['amp.gain', dest as unknown as AudioParam]]));
    const mods: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true, scope: 'per-voice',
      connections: [{ id: 'c1', paramId: 'bass.amp.gain', depth: 0.8 }],
    }];
    const engine = makeMockEngine([] /* no specs */, makeMockHost(mods));
    const voiceMods = new Map<string, ModulatorVoice>([['lfo1', makeMockModulatorVoice()]]);

    const binder = bindVoiceModulators({ laneId: 'bass', engine, voice, voiceMods, ctx });
    expect(binder.activeCount()).toBe(1);
    // depth * (max-min) = 0.8 * (1-0) = 0.8
    expect(dest.inputs[0].gain.value).toBeCloseTo(0.8);
  });
});

describe('bindVoiceModulators — scope partitioning', () => {
  beforeEach(() => { _resetLaneBindingsForTesting(); });

  it('only wires modulators with scope=per-voice', () => {
    const ctx = new AudioContext();
    const dummyParam = ctx.createGain().gain;
    const lfoOut = ctx.createConstantSource(); lfoOut.start();
    const adsrOut = ctx.createConstantSource(); adsrOut.start();

    const engine = {
      modulators: { modulators: [
        { id: 'lfo1', kind: 'lfo', enabled: true, connections: [
          { id: 'c1', paramId: 'lane.filter.cutoff', depth: 0.5 },
        ], scope: 'shared' },
        { id: 'adsr1', kind: 'adsr', enabled: true, connections: [
          { id: 'c2', paramId: 'lane.amp.gain', depth: 0.5 },
        ], scope: 'per-voice' },
      ]},
      params: [
        { id: 'filter.cutoff', min: 0, max: 1, kind: 'continuous', label: 'C', default: 0 },
        { id: 'amp.gain',      min: 0, max: 1, kind: 'continuous', label: 'A', default: 0 },
      ],
    } as never;
    const voice = {
      getAudioParams: () => new Map<string, AudioParam>([
        ['filter.cutoff', dummyParam],
        ['amp.gain',      dummyParam],
      ]),
    } as never;
    const voiceMods = new Map([['adsr1', { output: adsrOut, trigger(){}, release(){}, dispose(){}, currentValue(){return 0;} }]]);
    const binder = bindVoiceModulators({ laneId: 'lane', engine, voice, voiceMods, ctx });
    expect(binder.activeCount()).toBe(1);
  });
});

describe('bindEngineModulators — scope partitioning', () => {
  beforeEach(() => { _resetLaneBindingsForTesting(); });

  it('only wires modulators with scope=shared', () => {
    const ctx = new AudioContext();
    const dummyParam = ctx.createGain().gain;
    const lfoOut = ctx.createConstantSource(); lfoOut.start();

    const engine = {
      modulators: { modulators: [
        { id: 'lfo1', kind: 'lfo', enabled: true, connections: [
          { id: 'c1', paramId: 'lane.filter.cutoff', depth: 0.5 },
        ], scope: 'shared' },
        { id: 'adsr1', kind: 'adsr', enabled: true, connections: [
          { id: 'c2', paramId: 'lane.amp.gain', depth: 0.5 },
        ], scope: 'per-voice' },
      ]},
      params: [
        { id: 'filter.cutoff', min: 0, max: 1, kind: 'continuous', label: 'C', default: 0 },
        { id: 'amp.gain',      min: 0, max: 1, kind: 'continuous', label: 'A', default: 0 },
      ],
      getSharedAudioParams: () => new Map([['filter.cutoff', dummyParam]]),
    } as never;
    const sharedMods = new Map([['lfo1', { output: lfoOut, trigger(){}, release(){}, dispose(){}, currentValue(){return 0;} }]]);
    const binder = bindEngineModulators({ laneId: 'lane', engine, voiceMods: sharedMods, ctx });
    expect(binder.activeCount()).toBe(1);
  });

  it('honours an explicit rangeLookup for a bus param missing from engine.params (drums sample-mode fix)', () => {
    // Regression: in sample mode the DrumsEngine façade's `params` getter returns
    // the sampler specs (no bus.*), so the default rangeLookupForEngine would fall
    // back to span 1 and mis-scale bus EQ/pan/level modulation depth. The fix
    // passes an explicit rangeLookup (DrumsEngine.busRangeLookup) so bus.pan keeps
    // its true -1..1 span (2) regardless of kitMode.
    const ctx = makeMockCtx();
    const pan = makeMockParam('pan');
    const mods: ModulatorState[] = [{
      id: 'lfo1', kind: 'lfo', enabled: true, scope: 'shared',
      connections: [{ id: 'c1', paramId: 'drums-1.bus.pan', depth: 0.5 }],
    }];
    const host = makeMockHost(mods);
    const engine = {
      ...makeMockEngine([] /* no bus.* spec — simulates sample mode */, host),
      getSharedAudioParams: () => new Map([['bus.pan', pan as unknown as AudioParam]]),
    } as unknown as SynthEngine;
    const voiceMods = new Map<string, ModulatorVoice>([['lfo1', makeMockModulatorVoice()]]);

    bindEngineModulators({
      laneId: 'drums-1', engine, voiceMods, ctx,
      rangeLookup: (id) => (id === 'bus.pan' ? { min: -1, max: 1 } : { min: 0, max: 1 }),
    });

    expect(pan.inputs).toHaveLength(1);
    // depth 0.5 * span 2 = 1.0 — NOT 0.5 (which the buggy span-1 fallback gave).
    expect(pan.inputs[0].gain.value).toBeCloseTo(1.0);
  });
});
