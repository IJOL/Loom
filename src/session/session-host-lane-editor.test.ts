// @vitest-environment jsdom
// FINDING 1 (final review, BLOCKER): injectEngineModulatorPanel's
// EngineUIContext.registerKnob — the callback handed to every engine's
// buildParamUI — used to write straight into
// self.deps.automationRegistry.set(...) instead of calling the injected
// registerKnob funnel. That funnel is what the right-click automation menu
// and Performance recording hook into (main.ts wraps automation.registerKnob,
// not the raw Map), so any knob mounted by a lane re-render (engine swap,
// undo/redo, the synth-editor chevron — all of which call showLaneEditor →
// injectEngineModulatorPanel again with FRESH elements) never got the menu.
//
// This proves the fix: the EngineUIContext passed to engine.buildParamUI
// calls SessionHost.registerKnobHandle, which delegates to deps.registerKnob
// when supplied, and does NOT touch the Map itself.
import { describe, it, expect, vi } from 'vitest';
import { SessionHost } from './session-host';
import type { SessionInspector } from './session-inspector';
import type { SessionState } from './session';
import type { KnobHandle } from '../core/knob';
import type { SynthEngine, EngineUIContext } from '../engines/engine-types';
import { fakeDestinations } from './fake-destinations';

// A fake engine whose buildParamUI directly exercises the EngineUIContext
// handed to it by injectEngineModulatorPanel — the exact seam under test.
function fakeEngine(fakeKnob: KnobHandle): SynthEngine {
  return {
    id: 'drums-machine', name: 'Drums', type: 'tab', polyphony: 'poly', editor: 'drum-grid',
    params: [], presets: [], modulators: {} as never,
    getBaseValue: () => 0, setBaseValue: () => {},
    createVoice: () => ({}) as never,
    buildSequencer: () => ({}) as never,
    buildParamUI: (_host: HTMLElement, ctx?: EngineUIContext) => { ctx!.registerKnob(fakeKnob); },
    applyPreset: () => {}, dispose: () => {},
  } as unknown as SynthEngine;
}

function makeHost(overrides: { registerKnob?: (k: KnobHandle) => void }): SessionHost {
  const host = new SessionHost({
    // @ts-expect-error — partial deps for unit test
    ctx: {}, seq: { bpm: 120 } as never,
    playBtn: {} as never,
    resetAutomationPosition: () => {},
    triggerForLane: () => {},
    drumLanes: [],
    markTrackActive: () => {},
    ensureExtraPoly: () => ({}) as never,
    extraStrips: {},
    getLaneEngineId: () => 'drums-machine',
    ensureLaneVoice: () => null,
    showPolyEditor: () => {},
    setActiveEngineLane: () => {},
    mixerDeps: {} as never,
    midiLabel: () => '',
    automationRegistry: new Map<string, KnobHandle>(),
    getAutoAbsSubIdx: () => 0,
    destinations: fakeDestinations(),
    ...overrides,
  });
  host.inspector = { mountLaneInserts: () => {} } as unknown as SessionInspector;
  return host;
}

describe('injectEngineModulatorPanel — engine param knob registration funnel', () => {
  it('routes a knob mounted by engine.buildParamUI through deps.registerKnob, not a direct Map write', () => {
    document.body.innerHTML = '<div data-page="drums"></div>';

    const fakeKnob = { el: document.createElement('div'), setValue: () => {}, meta: { id: 'd1.gain', min: 0, max: 1 } } as unknown as KnobHandle;
    const registerKnobSpy = vi.fn();
    const host = makeHost({ registerKnob: registerKnobSpy });
    host.deps.laneResources = new Map([['d1', { engine: fakeEngine(fakeKnob) }]]) as never;
    host.state = { lanes: [{ id: 'd1', engineId: 'drums-machine', clips: [] }], scenes: [], globalQuantize: '1/1' } as unknown as SessionState;

    host.injectEngineModulatorPanel('d1', 'drums');

    expect(registerKnobSpy).toHaveBeenCalledWith(fakeKnob);
    // Non-vacuity: the direct-Map path must NOT have fired when registerKnob
    // was supplied — before the fix this Map always got the write too.
    expect(host.deps.automationRegistry.size).toBe(0);
  });

  it('falls back to a direct Map write ONLY when no registerKnob is supplied (test-fixture escape hatch)', () => {
    document.body.innerHTML = '<div data-page="drums"></div>';

    const fakeKnob = { el: document.createElement('div'), setValue: () => {}, meta: { id: 'd1.gain', min: 0, max: 1 } } as unknown as KnobHandle;
    const host = makeHost({});
    host.deps.laneResources = new Map([['d1', { engine: fakeEngine(fakeKnob) }]]) as never;
    host.state = { lanes: [{ id: 'd1', engineId: 'drums-machine', clips: [] }], scenes: [], globalQuantize: '1/1' } as unknown as SessionState;

    host.injectEngineModulatorPanel('d1', 'drums');

    expect(host.deps.automationRegistry.get('d1.gain')).toBe(fakeKnob);
  });
});
