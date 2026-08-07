// MIDI import, end to end: the per-track picker's whole dependency surface plus
// the two things that only exist because an import bypasses the host's normal
// load path.
//
// The cohesion here is that bypass. Every other route into a session goes
// through applyLoadedSessionState, which allocates each lane's strip + engine
// and applies its preset on the way in. The importer seeds lanes straight into
// SessionState, so somebody has to do that prep afterwards — and the same
// somebody has to be able to launch the resulting scene from outside the host.
// prepareImportedLaneResources and launchSceneById exist for no other caller,
// so they travel with the wiring that needs them rather than sitting in boot
// glue as general-purpose seams.
//
// prepareImportedLaneResources MUST run BEFORE renderWithMixer (the mixer asks
// the allocator for every lane's strip and throws on a missing one). That is
// why both of its call sites — inside launchSceneById and the importer's
// prepareLanes hook — live in this file: they are one rule, and splitting them
// is how the rule gets broken.
//
// `session: sessionHost.state` is captured BY REFERENCE at wire time, exactly as
// it always was, and that is deliberate: SessionHost never reassigns `state`
// (session-host-persistence mutates its fields one by one), so the capture
// survives every load. Turning it into a getter here would be a behaviour change
// smuggled into a move.
//
// performanceFeature and stopTransport are held BY VALUE rather than behind
// getters: both are built earlier in boot, and TypeScript rejects the call
// outright if that order is ever reversed.

import type { Sequencer } from '../core/sequencer';
import type { LaneResourceMap } from '../core/lane-resources';
import type { SynthEngine } from '../engines/engine-types';
import type { SessionHost } from '../session/session-host';
import type { PerformanceFeature } from './performance-feature';
import { prepImportedLanes } from './import-lane-prep';
import { launchScene as launchSceneRuntime } from '../session/session-runtime';
import { reloadDrumkit } from '../session/session-host-presets';
import { recordPagePresetForLane } from '../instrument-presets/polysynth-presets';
import { setPlaying } from '../core/transport';
import { emptySessionState } from '../session/session';
import { wireMidiImportUI } from '../midi/midi-import-ui';
import { bindMidiImportDialog } from '../midi/midi-import-dialog';

export interface MidiImportWiringDeps {
  ctx: AudioContext;
  /** Node the importer's audition voice connects into — the master gain. */
  master: GainNode;
  seq: Sequencer;
  playBtn: HTMLButtonElement;
  sessionHost: SessionHost;
  laneResources: LaneResourceMap;
  ensureLaneResource(laneId: string, engineId: string): void;
  getLaneEngineInstance(laneId: string): SynthEngine | null;
  /** Applies a tempo everywhere it is cached (Sequencer, the BPM input, every
   *  insert chain and engine). The importer calls it on every import. */
  setTransportBpm(bpm: number): void;
  flashButton(b: HTMLButtonElement, msg: string): void;
  /** Resolves when engine presets finish loading — the importer re-enables its
   *  Import button on it when a file was picked before presets were ready. */
  presetsLoaded: Promise<unknown>;
  resetAutomationPosition(): void;
  /** Held by value: createPerformanceFeature runs earlier in boot. */
  performanceFeature: PerformanceFeature;
  /** The unified stop seam (finalizes an in-flight take, stops the clock and
   *  every lane). Held by value: it is defined earlier in boot. */
  stopTransport(): void;
}

export interface MidiImportWiring {
  /** The <dialog> handle, opened from the menu bar at the end of boot. */
  midiImportDialog: { open(): void; close(): void };
}

export function wireMidiImport(deps: MidiImportWiringDeps): MidiImportWiring {
  const {
    ctx, master, seq, playBtn, sessionHost, laneResources, ensureLaneResource,
    getLaneEngineInstance, setTransportBpm, flashButton, presetsLoaded,
    resetAutomationPosition, performanceFeature, stopTransport,
  } = deps;

  // ── MIDI import wiring (see src/midi/midi-import-ui.ts) ───────────────────
  // Allocate audio resources for any freshly-imported lanes, applying each lane's
  // preset once, when its resource is first allocated. The host's normal path runs
  // this in applyLoadedSessionState; importer-added lanes bypass that, so do it
  // here. MUST run BEFORE renderWithMixer (the mixer asks the allocator for every
  // lane's strip and throws on a missing one). Idempotent: already-allocated lanes
  // are skipped, so launching a scene never re-applies a preset.
  function prepareImportedLaneResources(): void {
    prepImportedLanes(sessionHost.state.lanes, {
      hasResource: (id) => !!laneResources.get(id),
      ensureLaneResource: (id, engineId) => ensureLaneResource(id, engineId),
      getEngineInstance: (id) => getLaneEngineInstance(id),
      // Sample-kit drums lane: applyDrumPreset does the async kit decode but does
      // NOT record the dropdown selection (only the user-pick path does), so an
      // imported percussion lane showed "(custom — no preset)". Record it here —
      // the same thing applyPresetForLane does for the melodic lanes below.
      applyDrumPreset: (id, name) => {
        void sessionHost.applyDrumPreset(id, name);
        recordPagePresetForLane(id, `engine:${name}`);
      },
      reloadDrumkit: (id, kitId, inst) =>
        { void reloadDrumkit(sessionHost, id, kitId, inst as Parameters<typeof reloadDrumkit>[3]); },
      // Route the synth/melodic preset through the host path so the preset dropdown
      // reflects the imported preset (the previous direct applyPresetToEngine set the
      // sound but left every imported synth lane showing "(custom — no preset)").
      applyPresetForLane: (id, name) => { sessionHost.deps.applyPresetForLane?.(id, name); },
    });
  }

  // Launches a scene by id from outside the session host. Resumes the audio
  // context, ensures resources for any freshly-imported lanes, runs the launch
  // runtime, and starts the transport if stopped.
  function launchSceneById(sceneId: string): void {
    const idx = sessionHost.state.scenes.findIndex((s) => s.id === sceneId);
    if (idx < 0) return;
    const scene = sessionHost.state.scenes[idx];
    void ctx.resume();
    prepareImportedLaneResources();
    launchSceneRuntime(sessionHost.laneStates, sessionHost.state, scene, idx, ctx.currentTime, seq.bpm);
    if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); setPlaying(playBtn, true); }
    sessionHost.renderWithMixer();
  }

  wireMidiImportUI({
    session: sessionHost.state,
    setBpm: setTransportBpm,
    setTempoMap: (map, songTicks) => seq.setTempoMap(map, songTicks),
    audioContext: ctx,
    auditionOutput: master,
    onSessionChanged: () => sessionHost.renderWithMixer(),
    launchScene: (sceneId: string) => launchSceneById(sceneId),
    flashButton,
    presetsReady: presetsLoaded,
    // A committed import: mirror the arrangement onto the Performance timeline,
    // but LAND THE USER IN SESSION — that's where the imported clips/scene are and
    // where ▶ plays them (copyFromSession switches to Performance, so switch back).
    // Then dismiss the dialog (Import MIDI → import + close).
    // midiImportDialog is declared below; this only runs on a user import, long
    // after boot, so the closure is safe.
    onImported: () => {
      performanceFeature.copyFromSession();
      performanceFeature.setMode('session');
      midiImportDialog.close();
    },
    // Replace import = a clean slate. Same full wipe as the "New session" button:
    // stop the transport + silence voices, dispose every old lane resource (engines
    // AND their modulators/LFOs) + close open editors via applyLoadedSessionState,
    // and reset the Performance arrangement. (No markClean — the import IS a change.)
    resetSession: () => {
      stopTransport();
      sessionHost.replaceSession(emptySessionState());
      performanceFeature.resetArrangement();
    },
    // Allocate strip+engine for the freshly-seeded lanes BEFORE the import renders
    // the mixer (renderWithMixer throws on a lane with no resource).
    prepareLanes: () => prepareImportedLaneResources(),
  });
  const midiImportDialog = bindMidiImportDialog();

  return { midiImportDialog };
}
