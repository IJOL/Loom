// src/export/offline-worklet-registration.test.ts
//
// Regression guard for the offline-export "message that flashes and vanishes"
// bug: the OfflineSceneRecorder rendered against a FRESH OfflineAudioContext but
// never registered the AudioWorklet processor modules on it, so every engine's
// `new AudioWorkletNode(offlineCtx, …)` threw in a real browser:
//   InvalidStateError: … Load a script via audioWorklet.addModule() first.
// The catch in main.ts surfaced it as "Export failed: …" for 1500 ms, then it
// vanished. It reached production because test/setup.ts replaces AudioWorkletNode
// with a fake that NEVER validates registration — so the DSP tests were blind to it.
//
// This file restores the BROWSER contract for one suite: a strict AudioWorkletNode
// that throws unless addModule() ran on that context first. A recorder that skips
// the registration therefore fails here exactly as it does in Chrome.
//
// Coverage note (verified against the code): offline, the ONLY worklet node built
// synchronously is the melodic WorkletLaneEngine's LoomWorkletNode (in its ctor) —
// the exact node that threw. Drums/Sampler/Audio engines build their nodes lazily
// on createVoice, which the recorder never calls (it renders through pure kernels),
// so the strict node below only ever fires for the loom path. To ALSO guard the
// drums/sampler registrations (defensive today, load-bearing if the offline path
// ever grows real worklet nodes), we assert the EXACT module count: the fix must
// register all three, so dropping any loader from record() drops the count below 3
// and fails — `toHaveBeenCalled()` alone would stay green on loom's load.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { OfflineSceneRecorder } from './offline-recorder';
import { bootstrapPlugins } from '../app/plugin-bootstrap';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import { DEFAULT_METER } from '../core/meter';
import type { SessionState, SessionClip } from '../session/session';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as unknown as Record<string, any>;

describe('OfflineSceneRecorder registers worklet modules on its OfflineAudioContext', () => {
  const savedNode = g.AudioWorkletNode;
  // Contexts whose AudioWorklet has had a module registered (addModule called).
  let loaded: Set<object>;
  let addModuleSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => { bootstrapPlugins(); });

  beforeEach(() => {
    loaded = new Set<object>();
    // Track addModule per audioWorklet instance and resolve immediately — the real
    // TypeScript processor can't load under node-web-audio-api, and we only care
    // that the recorder DID register before constructing nodes.
    addModuleSpy = vi
      .spyOn(g.AudioWorklet.prototype, 'addModule')
      .mockImplementation(function (this: object) { loaded.add(this); return Promise.resolve(); });

    // Strict AudioWorkletNode mirroring the browser: throw unless the node's
    // context registered a module first. (The global setup's fake never throws.)
    g.AudioWorkletNode = class {
      readonly port = { postMessage() { /* no-op */ }, onmessage: null as unknown };
      constructor(ctx: { audioWorklet?: object }) {
        if (!ctx || !ctx.audioWorklet || !loaded.has(ctx.audioWorklet)) {
          throw new DOMException(
            "Failed to construct 'AudioWorkletNode': AudioWorkletNode cannot be created: " +
              'AudioWorklet does not have a valid AudioWorkletGlobalScope. ' +
              'Load a script via audioWorklet.addModule() first.',
            'InvalidStateError',
          );
        }
      }
      connect() { /* no-op */ }
      disconnect() { /* no-op */ }
    };
  });

  afterEach(() => {
    addModuleSpy.mockRestore();
    g.AudioWorkletNode = savedNode;
  });

  function sceneFor(engineId: string, laneId: string, midi: number): {
    state: SessionState; laneStates: Map<string, LanePlayState>;
  } {
    const clip: SessionClip = { color: '#a8e0d8', gridResolution: '1/16',
      id: 'c', lengthBars: 1,
      notes: [{ start: 0, duration: 24, midi, velocity: 110 }],
    };
    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [{ inserts: [], id: laneId, engineId, clips: [clip] }],
      scenes: [], globalQuantize: '1/1',
    };
    const laneStates = new Map<string, LanePlayState>();
    const lp = emptyLanePlayState(laneId); lp.playing = clip;
    laneStates.set(laneId, lp);
    return { state, laneStates };
  }

  it('renders a melodic (tb303) lane without an unregistered-worklet error', async () => {
    // The genuine contract guard: WorkletLaneEngine's ctor builds a LoomWorkletNode,
    // so WITHOUT the fix the strict node above throws InvalidStateError and record()
    // rejects (the exact production failure). WITH the fix it resolves.
    const { state, laneStates } = sceneFor('tb303', 'tb-303-1', 40);
    const rec = new OfflineSceneRecorder({ state, laneStates, bpm: 120, meter: DEFAULT_METER, sampleRate: 44100 });
    await expect(rec.record(1.0)).resolves.toBeDefined();
    // Exactly loom + drums + sampler registered on the fresh ctx — dropping any
    // loader from record() drops this below 3 and fails.
    expect(addModuleSpy).toHaveBeenCalledTimes(3);
  });

  it('registers all three worklet modules (loom + drums + sampler), not just loom', async () => {
    // Pins the exact module set independently of the melodic node above, so a future
    // refactor that removes loadDrumsWorklet/loadSamplerWorklet is caught even though
    // those nodes are not constructed offline today. A drums lane still exercises the
    // recorder's pure DrumVoiceManager path end-to-end.
    const { state, laneStates } = sceneFor('drums-machine', 'drums-1', 36);
    const rec = new OfflineSceneRecorder({ state, laneStates, bpm: 120, meter: DEFAULT_METER, sampleRate: 44100 });
    await expect(rec.record(1.0)).resolves.toBeDefined();
    expect(addModuleSpy).toHaveBeenCalledTimes(3);
  });
});
