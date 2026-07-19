// SessionHostDeps: the dependency bag SessionHost is constructed with.
// Extracted from session-host.ts to keep that file focused on behaviour.

import type { ChannelStrip } from '../core/fx';
import type { DrumVoice } from '../core/drums';
import type { PolySynth } from '../polysynth/polysynth';
import type { Sequencer } from '../core/sequencer';
import type { MixerColumnDeps } from '../core/mixer';

export interface SessionHostDeps {
  ctx: AudioContext;
  seq: Sequencer;
  playBtn: HTMLButtonElement;
  resetAutomationPosition: () => void;
  /** Set the project tempo through the canonical broadcaster (updates the
   *  scheduler, the BPM input, fx sync + every engine). Loading a loop conforms
   *  the project to the loop's own tempo, so a sliced REX loop sounds natural
   *  without a manual BPM change. */
  applyBpm?: (bpm: number) => void;
  /** Injected unified stop. When provided, the session's "Stop all" button
   *  delegates to it (so it also finalizes any live-take recording + resets the
   *  Play button) instead of the local stopAll + re-render. */
  onStopAll?: () => void;
  /** Single per-lane trigger entry — encapsulates engineId dispatch +
   *  laneResources lookup. Replaces the old bassTriggerDirect /
   *  bassTriggerForArp / polyTriggerDirect trio. */
  triggerForLane: (
    laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean,
    sample?: import('./session').ClipSample,
    velocity?: number,
    offsetSec?: number,
  ) => void;
  /** Per-lane live-voice registry shared with the trigger dispatch. The stop
   *  seams (stopLane/stopAll) pass it as the `silence` hook so they release a
   *  lane's still-sounding voices immediately — chiefly the long 'audio' channel
   *  clip, which otherwise plays to the end after any Stop. Optional so test
   *  fixtures without audio can skip it. */
  liveVoices?: import('../app/live-voice-registry').LiveVoiceRegistry;
  // Phase G: drums removed — triggerForLane now routes drums-machine via
  // res.engine.createVoice() like every other engine.
  drumLanes: readonly DrumVoice[];
  markTrackActive: (trackId: string, time: number) => void;
  ensureExtraPoly: (id: string) => PolySynth;
  extraStrips: Partial<Record<string, ChannelStrip>>;
  getLaneEngineId: (laneId: string) => string;
  ensureLaneVoice: (laneId: string, engineId: string) => import('../engines/engine-types').Voice | null;
  showPolyEditor: (laneId: string, target: PolySynth, displayName: string) => void;
  /** Update the active-engine-lane tracker (lane-engine-host state). Called
   *  for FM/Wavetable/Karplus when the user opens their inspector — those
   *  engines have no PolySynth so showPolyEditor's path doesn't fire
   *  setActiveEngineLane, which leaves the preset dropdown applying changes
   *  to a stale (typically subtractive-1) lane. Optional so test fixtures
   *  without the lane-host don't need to implement it. */
  setActiveEngineLane?: (laneId: string) => void;
  mixerDeps: MixerColumnDeps;
  midiLabel: (m: number) => string;
  automationRegistry: Map<string, import('../core/knob').KnobHandle>;
  /** The ONE knob-mount notifier (main.ts's `registerKnob`, itself a thin
   *  wrapper over automation.registerKnob). Every UI call site that mounts a
   *  knob — engine param UI, per-lane insert FX, the audio-channel Gain knob —
   *  MUST call this instead of writing automationRegistry directly, or every
   *  registerKnob-wrap hook (Performance recording, the right-click automation
   *  menu) misses knobs mounted after boot (BLOCKER found in final review:
   *  those sites wrote the Map directly, so a knob created by a lane
   *  re-render — engine swap, undo/redo, the synth-editor chevron — never got
   *  the menu). Optional so bare test fixtures that never exercise those UI
   *  panels can skip it; SessionHost.registerKnobHandle() falls back to a
   *  direct Map write ONLY in that case — main.ts always supplies this. */
  registerKnob?: (k: import('../core/knob').KnobHandle) => void;
  getAutoAbsSubIdx: () => number;
  onActiveLaneChanged?: () => void;
  /** Phase B: per-lane engine + strip map. Optional so test fixtures don't break. */
  laneResources?: import('../core/lane-resources').LaneResourceMap;
  /** Phase E: allocate a fresh ChannelStrip + engine instance and register them
   *  in laneResources under `laneId`. Called by onAddLane for every new lane so
   *  triggerForLane can find the resource immediately. Optional so test fixtures
   *  that don't construct an audio graph don't need to implement it. */
  ensureLaneResource?: (laneId: string, engineId: string) => void;
  /** Replace the live engine for an already-allocated lane (allocator
   *  .swapLaneEngine). Used to reconcile a lane whose engineId changed via
   *  undo/redo or a loaded session. Optional so test fixtures can skip it. */
  swapLaneEngine?: (laneId: string, newEngineId: string) => void;
  /** Apply a preset to a lane by name. Called by applyLoadedSessionState
   *  for every lane.enginePresetName. Optional so test fixtures without
   *  audio can skip it. */
  applyPresetForLane?: (laneId: string, presetName: string) => void;
  /** Optional: when provided, cell-level edits in clip editors are wrapped
   *  with withUndo so each step toggle becomes an undoable entry. */
  historyDeps?: import('../save/history-wiring').HistoryDeps;
  /** Performance view recording hooks. When present, tickSession appends
   *  clip-launches to arrangement.lanes[*].clipEvents while rec.recording. */
  recHooks?: import('./session-runtime').RecHooks;
  /** Performance view per-tick callback. Called after tickSession on every
   *  sequencer lookahead pulse. Used to drive tickRecAutomation and
   *  tickArrangement. */
  onAfterTick?: (now: number, lookahead: number) => void;
  /** Phase H: called when the user edits an insert slot so the session can be
   *  autosaved. Optional — wired after save manager is set up. */
  saveSession?: () => void;
  /** Task 28: master insert chain for rehydrating persisted master inserts on load.
   *  Optional so test fixtures without audio don't need to wire it. */
  masterInsertChain?: import('../plugins/fx/insert-chain').InsertChain;
  /** Option B2: FxBus instance for threading master send instances into the
   *  modulation destination dropdown. Optional so test fixtures without audio
   *  don't need to wire it. */
  fxBus?: import('../core/fx').FxBus;
  /** The existing #volume range input. When present (+ masterMeterAnalyser),
   *  renderWithMixer builds the master strip into the last mixer column as a
   *  proxy of #volume. Optional so test fixtures without audio fall back to the
   *  old spacer. */
  volInput?: HTMLInputElement;
  /** Dedicated meter tap of the master bus (fftSize=512) feeding the master
   *  strip's VU. Optional, paired with volInput. */
  masterMeterAnalyser?: AnalyserNode;
  /** Master bus EQ/pan/mute strip the master mixer module's tone controls drive.
   *  Optional, paired with volInput/masterMeterAnalyser. */
  masterStrip?: import('../core/master-bus-strip').MasterBusStrip;
  /** Commit an undo checkpoint after an async/programmatic mutation that does
   *  not end in a user pointer/key event (stems, transcription, import). */
  checkpointHistory?: () => void;
  /** Fired when the SET of automation destinations changes — a lane's insert
   *  chain gains/loses a plugin, a lane is added/removed, an engine is
   *  swapped, or a session finishes loading. Wired to DestinationRegistry
   *  .invalidate() in main.ts. Optional so test fixtures without the
   *  registry still compile. */
  onDestinationsChanged?: () => void;
  /** Task 6: the one destination catalogue, threaded into every lane's
   *  EngineUIContext so the modulation panel's destination dropdown reads it
   *  instead of the retired laneInserts/masterInserts/fxBus trio. Required —
   *  a DestinationRegistry owns a private listener set, and mutation sites
   *  announce changes by calling .invalidate() on the ONE instance built in
   *  main.ts. A "helpfully" auto-built fallback here would construct a SECOND,
   *  disconnected registry that nobody ever invalidates: the picker it feeds
   *  populates once and then silently stops updating — worse than an empty
   *  picker, because it looks healthy. Test fixtures build a stub (see
   *  fakeDestinations in fake-destinations.ts). */
  destinations: import('../automation/destination-registry').DestinationRegistry;
}
