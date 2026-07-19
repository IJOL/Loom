// @vitest-environment jsdom
// FINDING 1 (final review, BLOCKER), site 2: SessionInspector must thread its
// injected `registerKnob` (InspectorDeps.registerKnob — wired in session-host.ts
// to SessionHost.registerKnobHandle) all the way down into the ClipEditorDeps it
// builds for renderClipEditor. Before the fix, renderEditor() never passed
// registerKnob through at all, so the audio-lane clip editor's Gain knob (and,
// via the same InspectorDeps field, the per-lane insert-FX knobs mounted by
// mountLaneInserts) fell back to writing automationRegistry directly — a knob
// mounted this way never reached the right-click automation menu.
//
// This test drives the REAL (unmocked) renderClipEditor for an audio-channel
// clip and proves the Gain knob it mounts goes through the injected
// registerKnob, not a direct Map write.
import { describe, it, expect, vi } from 'vitest';

function stubCanvas() {
  const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
}

import { SessionInspector } from './session-inspector';
import type { SessionState, SessionClip, SessionLane } from './session';
import type { KnobHandle } from '../core/knob';
import type { SynthEngine } from '../engines/engine-types';
import { fakeDestinations } from './fake-destinations';

function mountInspectorDom(): void {
  document.body.innerHTML = `
    <div id="session-inspector" hidden>
      <input id="insp-name" type="text" />
      <input id="insp-length" type="number" />
      <button id="insp-tempo-double"></button>
      <button id="insp-tempo-halve"></button>
      <select id="insp-quantize"><option value=""></option></select>
      <button id="insp-duplicate"></button>
      <button id="insp-delete"></button>
      <button id="insp-copy"></button>
      <button id="insp-paste-replace" disabled></button>
      <button id="insp-paste-layer" disabled></button>
      <button id="insp-random-notes"></button>
      <button id="insp-variate"></button>
      <button id="insp-invert-melodic"></button>
      <button id="insp-retrograde"></button>
      <button id="insp-chords"></button>
      <select id="insp-examples-select"></select>
      <button id="insp-save-example"></button>
      <button id="insp-export-example"></button>
      <button id="insp-toggle-editor"></button>
      <div id="insp-tonality"></div>
      <div id="insp-roll-host"></div>
    </div>`;
}

function fakeAudioEngine(): SynthEngine {
  return {
    id: 'audio', name: 'Audio', type: 'tab', polyphony: 'mono', editor: 'piano-roll',
    params: [{ id: 'gain', kind: 'continuous', label: 'Gain', min: 0, max: 2, default: 1 }],
    presets: [], modulators: {} as never,
    getBaseValue: () => 1, setBaseValue: () => {},
    createVoice: () => ({}) as never,
    buildSequencer: () => ({}) as never,
    buildParamUI: () => {},
    applyPreset: () => {}, dispose: () => {},
  } as unknown as SynthEngine;
}

describe('SessionInspector — threads registerKnob into the audio clip editor', () => {
  it('the Gain knob calls the injected registerKnob, not a direct Map write', () => {
    stubCanvas();
    mountInspectorDom();

    const clip = { id: 'c1', name: 'take', lengthBars: 1, notes: [],
      sample: { sampleId: 'smp-1', mode: 'loop', trimStart: 0, trimEnd: 1 } } as unknown as SessionClip;
    const lane = { id: 'audio-1', engineId: 'audio', clips: [clip] } as unknown as SessionLane;
    const state = { lanes: [lane] } as unknown as SessionState;

    const registerKnobSpy = vi.fn();
    const automationRegistry = new Map<string, KnobHandle>();

    const insp = new SessionInspector({
      ctx: {} as AudioContext,
      seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
      state,
      laneStates: new Map(),
      renderWithMixer: () => {},
      midiLabel: (m: number) => String(m),
      automationRegistry,
      registerKnob: registerKnobSpy,
      destinations: fakeDestinations(),
      getAutoAbsSubIdx: () => 0,
      laneResources: { get: () => ({ engine: fakeAudioEngine() }) } as never,
    });

    insp.setSelectedClip({ laneId: 'audio-1', clipIdx: 0 });
    insp.openInspector();

    expect(registerKnobSpy).toHaveBeenCalledTimes(1);
    const [handle] = registerKnobSpy.mock.calls[0] as [KnobHandle];
    expect(handle.meta.id).toBe('audio-1.gain');
    // Non-vacuity: with registerKnob injected, the Map itself must stay empty.
    expect(automationRegistry.size).toBe(0);
  });
});
