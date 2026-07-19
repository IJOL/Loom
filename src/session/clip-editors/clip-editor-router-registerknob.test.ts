// @vitest-environment jsdom
// FINDING 1 (final review, BLOCKER): the audio-lane clip editor's Gain knob
// used to write straight into automationRegistry.set(...) instead of calling
// the injected registerKnob funnel — so a knob mounted here (e.g. after the
// clip editor is re-rendered) never reached the right-click automation menu
// or Performance recording, both of which hook registerKnob, not the raw Map.
// This proves the fix: renderClipEditor's audio-clip branch calls
// deps.registerKnob when it is supplied, and does NOT touch the Map itself.
import { describe, it, expect, vi } from 'vitest';
import { renderClipEditor, type ClipEditorDeps } from './clip-editor-router';
import type { SessionLane, SessionClip } from '../session';
import type { KnobHandle } from '../../core/knob';
import type { SynthEngine } from '../../engines/engine-types';
import { DEFAULT_METER } from '../../core/meter';

function stubCanvas() {
  const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
}

// A minimal engine exposing a single continuous 'gain' param — mirrors just
// enough of the real 'audio' engine for wireEngineParams to mount one knob
// and call ctx.registerKnob with it.
function fakeAudioEngine(): SynthEngine {
  return {
    id: 'audio', name: 'Audio', type: 'tab', polyphony: 'mono', editor: 'piano-roll',
    params: [{ id: 'gain', kind: 'continuous', label: 'Gain', min: 0, max: 2, default: 1 }],
    presets: [],
    modulators: {} as never,
    getBaseValue: () => 1,
    setBaseValue: () => {},
    createVoice: () => ({}) as never,
    buildSequencer: () => ({}) as never,
    buildParamUI: () => {},
    applyPreset: () => {},
    dispose: () => {},
  } as unknown as SynthEngine;
}

function makeLaneAndClip(): { lane: SessionLane; clip: SessionClip } {
  const clip = { id: 'c1', name: 'take', lengthBars: 1, notes: [],
    sample: { sampleId: 'smp-1', mode: 'loop', trimStart: 0, trimEnd: 1 } } as unknown as SessionClip;
  const lane = { id: 'audio-1', engineId: 'audio', clips: [clip] } as unknown as SessionLane;
  return { lane, clip };
}

function baseDeps(overrides: Partial<ClipEditorDeps>): ClipEditorDeps {
  return {
    ctx: {} as AudioContext,
    seq: { bpm: 120, meter: DEFAULT_METER } as never,
    laneStates: new Map(),
    midiLabel: () => '',
    automationRegistry: new Map<string, KnobHandle>(),
    ...overrides,
  };
}

describe('renderClipEditor — audio-clip Gain knob registration funnel', () => {
  it('calls the injected registerKnob and does NOT write automationRegistry directly', () => {
    stubCanvas();
    const { lane, clip } = makeLaneAndClip();
    const engine = fakeAudioEngine();
    const registerKnobSpy = vi.fn();
    const automationRegistry = new Map<string, KnobHandle>();

    const deps = baseDeps({
      automationRegistry,
      registerKnob: registerKnobSpy,
      laneResources: { get: () => ({ engine }) } as never,
    });

    const host = document.createElement('div');
    renderClipEditor(host, lane, clip, deps);

    expect(registerKnobSpy).toHaveBeenCalledTimes(1);
    const [handle] = registerKnobSpy.mock.calls[0] as [KnobHandle];
    expect(handle.meta.id).toBe('audio-1.gain');
    // Non-vacuity: the direct-Map path must NOT have fired when registerKnob
    // was supplied — before the fix this Map always got the write too.
    expect(automationRegistry.size).toBe(0);
  });

  it('falls back to a direct Map write ONLY when no registerKnob is supplied (test-fixture escape hatch)', () => {
    stubCanvas();
    const { lane, clip } = makeLaneAndClip();
    const engine = fakeAudioEngine();
    const automationRegistry = new Map<string, KnobHandle>();

    const deps = baseDeps({
      automationRegistry,
      // registerKnob intentionally omitted
      laneResources: { get: () => ({ engine }) } as never,
    });

    const host = document.createElement('div');
    renderClipEditor(host, lane, clip, deps);

    expect(automationRegistry.has('audio-1.gain')).toBe(true);
  });
});
