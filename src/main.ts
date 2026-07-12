import { createPerfDiagnostics } from './perf/perf-diagnostics';
import type { PerfVoiceTap } from './perf/perf-sources';
import { bootstrapPlugins } from './app/plugin-bootstrap';
import { listPlugins } from './plugins/registry';
import { createAudioGraph } from './app/audio-graph';
import { createBpmBroadcaster } from './app/bpm-broadcast';
import { createMuteSolo } from './app/mute-solo';
import { createLaneAllocator } from './app/lane-allocator';
import { GlobalVoiceCap } from './audio-worklet/global-voice-cap';
import { createAutomationRecorder } from './app/automation-recording';
import { createTriggerForLane } from './app/trigger-dispatch';
import { LiveVoiceRegistry } from './app/live-voice-registry';
import { createKnobMounter } from './app/knob-mounting';
import { createLaneHost } from './app/lane-host-wiring';
import { createPerformanceFeature } from './app/performance-feature';
import { prepImportedLanes } from './app/import-lane-prep';
import {
  wireEngineSelector, wireEngineSelector303, rebuildEngineParamUI,
  type EngineSelectorUIDeps,
} from './engines/engine-selector-ui';
import { getEngine, getEngineParamIds } from './engines/registry';
import { swapLaneEngineFlow, type EngineSwapDeps } from './app/engine-swap';
import { type TB303 } from './core/synth';
import { Sequencer } from './core/sequencer';
import { COMMON_METERS, formatMeter, meterFromLabel, stepsPerBar } from './core/meter';
import { DRUM_LANES, type DrumVoice } from './core/drums';
import { ChannelStrip } from './core/fx';
import { type KnobHandle } from './core/knob';
import { PolySynth } from './polysynth/polysynth';
import { stepsToNotes, bassStepsToNotes } from './core/notes';
import * as laneTrackHelpers from './core/lane-display';
import { SessionHost } from './session/session-host';
import { emptySessionState, DEFAULT_MUSICALITY } from './session/session';
import { renderMusicalityBar } from './session/musicality-bar';
import { fetchDemoSession } from './demo/demo-loader';
import { wireDemoPicker } from './demo/demo-picker';
import { wireMidiImportUI } from './midi/midi-import-ui';
import { launchScene as launchSceneRuntime, stopAll as stopAllLanes } from './session/session-runtime';
import { reloadDrumkit } from './session/session-host-presets';
import { applyPresetToEngine } from './presets/preset-apply';
import { wireSaveManager, bootRecoveryLoad } from './save/save-wiring';
import { createHistory } from './core/history';
import { createAutoHistory } from './save/auto-history';
import {
  wireHistoryKeyboard, withUndo, isTextEditTarget, type HistoryDeps,
} from './save/history-wiring';
import { wireUndoButtons } from './save/undo-buttons';
import {
  buildSavedStateV3, applyLoadedStateV3, type SavedStateV3, type SavedStateV3Deps,
} from './save/saved-state-v3';
import {
  wirePolyControls, refreshPolyPresetSelect, recordPagePresetForLane,
  type PolySynthPresetsDeps,
} from './polysynth/polysynth-presets';
import { wireRandomizeUI } from './core/randomize-ui';
import { wireFxUI, type FxUIDeps } from './core/fx-ui';
import { wireTransport, setPlaying, type TransportDeps } from './core/transport';
import { confirmDialog } from './core/dialog';
import { OfflineSceneRecorder } from './export/offline-recorder';
import { soundingSceneDurationSec } from './export/scene-duration';
import { wavEncoder } from './export/wav-encoder';
import { downloadBlob, exportTimestamp } from './export/download';
import { LiveTakeRecorder } from './export/live-take';
import { showTakeDestinationDialog } from './export/take-destination-dialog';
import type { RenderedAudio } from './export/types';
import {
  showPolyEditor,
  synthEditorState,
} from './session/synth-editor-routing';
import { StemClient } from './stems/stem-client';
import { stemServiceBaseUrl } from './stems/stem-config';
import { wireStemDialog } from './stems/stem-dialog';
import { transcribeToNoteLane } from './stems/transcribe-to-clip';
import { sampleCache } from './samples/sample-cache';
import { clipLoopSourceRange } from './core/clip-loop';
import { sliceBufferToWavFile } from './samples/buffer-to-wav';
import type { SessionClip } from './session/session';
import { startVisualizer } from './core/visualizer';
import { loadAllPresets } from './presets/preset-loader';
import { loadDrumKits } from './presets/drum-kits-loader';
import {
  startAutomationTick, resetAutomationPosition, getAutoAbsSubIdx,
  type AutomationTickDeps,
} from './automation/automation-tick';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from './core/lane-ids';
// ── Live MIDI control (src/control) ─────────────────────────────────────────
import { createActiveLaneStore } from './control/active-lane';
import { createLoomFacade } from './control/loom-facade';
import { createMediator } from './control/control-mediator';
import { createMidiAccess } from './control/web-midi-access';
import { wireControlSurfaceUI } from './control/control-surface-ui';
import { listProfiles } from './control/profile-registry';
import { loadControlPrefs, saveControlPrefs } from './control/persistence';
import { clampBpm, formatBpm } from './core/bpm';
// ── AudioWorklet synthesis loader (live path for all subtractive lanes) ──────
import { loadLoomWorklet } from './audio-worklet/loom-node';
import { loadDrumsWorklet } from './audio-worklet/drums-node';
import { loadSamplerWorklet } from './audio-worklet/sampler-node';

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb  = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

type ExtraId =
  | 'poly1' | 'poly2' | 'poly3' | 'poly4' | 'poly5' | 'poly6' | 'poly7' | 'poly8'
  | 'poly9' | 'poly10' | 'poly11' | 'poly12' | 'poly13' | 'poly14' | 'poly15' | 'poly16';
const EXTRA_IDS: ExtraId[] = [
  'poly1','poly2','poly3','poly4','poly5','poly6','poly7','poly8',
  'poly9','poly10','poly11','poly12','poly13','poly14','poly15','poly16',
];
type TrackId = 'bass' | 'poly' | 'drumBus' | ExtraId | DrumVoice;
const ALL_TRACKS: TrackId[] = ['bass', 'poly', ...EXTRA_IDS, 'drumBus', ...DRUM_LANES];
const $  = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const $$ = <T extends HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

// ── App version label (next to the LOOM logo) ────────────────────────────────
// __APP_VERSION__ / __APP_STAGE__ / __APP_CODENAME__ are inlined by vite.config.ts
// `define` from version.json, e.g. "v0.4 · alpha · Breakbeat". On-screen uses the
// middle-dot separator.
const appVersionEl = document.getElementById('app-version');
if (appVersionEl) appVersionEl.textContent = `v${__APP_VERSION__} · ${__APP_STAGE__} · ${__APP_CODENAME__}`;

// ── Plugin bootstrap (must run BEFORE preset cache + audio graph) ─────────
bootstrapPlugins();

// ── Preset cache ───────────────────────────────────────────────────────────
// Derived from the plugin registry so adding a new synth plugin automatically
// triggers its JSON preset file load (if /public/presets/<id>.json exists).
// Missing JSON files log a warning but never throw.
// The legacy 'poly' engineId was merged into 'subtractive' (the polysynth
// host IS the subtractive engine's voice allocator).
const ENGINE_IDS_FOR_PRESETS = listPlugins('synth').map((p) => p.manifest.id);
const presetsLoaded = loadAllPresets(ENGINE_IDS_FOR_PRESETS);
// Unified Drums picker list (synth + sample kits). Fire-and-forget; the drums
// populator re-renders when this resolves (see mountDrumsPresetSelect).
void loadDrumKits();

// ── Audio graph ────────────────────────────────────────────────────────────
const audio = createAudioGraph();
// Phase G: audio-graph.ts is now master-only. All per-lane strips, instrument
// instances, and configurators were removed. Lane allocation happens lazily via
// lanes.ensureLaneResource() when applyLoadedSessionState runs.
const { ctx, master, analyser, masterMeterAnalyser, masterStrip, masterInsertChain, fx, masterComp, sidechainBus } = audio;

// Register all three AudioWorklet processors ASAP (idempotent, cached per ctx).
// EVERY lane allocation that builds a worklet engine constructs `new
// AudioWorkletNode`: the melodic WorkletLaneEngine builds 'loom-processor', the
// synth-mode DrumsWorkletEngine builds the 8-output 'drums-processor', and the
// Sampler/Audio/sample-drumkit engines build the 'sampler-processor'. All modules
// must be registered first. addModule resolves once and stays registered for the
// ctx's lifetime, so gating the initial allocation paths (boot demo + recovery) on
// this combined promise covers later user-triggered allocations (New / picker /
// swap / sample import) too — by then it has long resolved.
const workletReady: Promise<void> = Promise.all([
  loadLoomWorklet(ctx),
  loadDrumsWorklet(ctx),
  loadSamplerWorklet(ctx),
]).then(() => undefined).catch((err: unknown) => {
  console.error('[worklet] addModule failed; worklet lanes will not sound.', err);
});

// Stable call-site wrappers — set in boot section, after automationDeps is built.
let renderLanes: () => void = () => { /* populated at boot */ };
let populateAutoParamSelectWrapper: () => void = () => { /* populated at boot */ };


const seq = new Sequencer(ctx, 32);
const automation = createAutomationRecorder();
const automationRegistry = automation.registry;
const registerKnob = (k: KnobHandle) => automation.registerKnob(k);
const currentEngineId = 'subtractive';

// Phase G: LaneAllocatorDeps is master-only; all per-lane strip/engine deps
// removed. Lanes are allocated lazily via ensureLaneResource() triggered by
// applyLoadedSessionState when the boot session JSON is applied.
// Global simultaneous-voice budget across all worklet lanes. Set UNCAPPED: the
// AudioWorklet handles dense polyphony, and any finite ceiling stole voices
// audibly (clicks). Mono lanes still cap themselves at 1 in VoiceManager.
// (User: "sin limitaciones, no las necesitamos" — click-free, 2026-06-24.)
const globalVoiceCap = new GlobalVoiceCap(Number.POSITIVE_INFINITY);
const lanes = createLaneAllocator({
  ctx, master, fx, sidechainBus,
  getBpm: () => seq.bpm,
  extraIds: EXTRA_IDS,
  globalVoiceCap,
});
const { resources: laneResources, extraStrips, extraPolys,
        stripFor, ensureExtraPoly, ensureLaneVoice,
        ensureLaneResource, getLaneEngineInstance, swapLaneEngine } = lanes;

// Phase G: lazy accessors — null before applyLoadedSessionState allocates lanes.
const getSynthInstance = (): TB303 | null => {
  const eng = laneResources.get(LANE_ID_BASS)?.engine as unknown as { getInstance?(): TB303 | null } | undefined;
  return eng?.getInstance?.() ?? null;
};

// Phase G: polysynth comes from lane resources lazily; null before boot session loads.
const bpmBroadcast = createBpmBroadcaster({
  seq, fx, masterInsertChain,
  laneResources,
  ctx,
  getSessionState: () => sessionHost?.state ?? null,
  getPolysynth: () => {
    const eng = laneResources.get(LANE_ID_POLY)?.engine;
    return (eng as unknown as { getPolySynth?(): PolySynth | null } | undefined)?.getPolySynth?.() ?? null;
  },
  getExtraPolys: () => Object.values(extraPolys).filter((p): p is PolySynth => !!p),
});

// State for mute/solo (synced into the strips on every change)
const muteSolo = createMuteSolo({
  laneResources, stripFor,
  allTrackIds: ALL_TRACKS as readonly string[],
});
const { muteState, soloState } = muteSolo as { muteState: Record<TrackId, boolean>; soloState: Record<TrackId, boolean>; apply(): void };
const applyMuteSolo = () => muteSolo.apply();

// ── DOM refs ───────────────────────────────────────────────────────────────
const playBtn  = $<HTMLButtonElement>('play');
const stopBtn  = $<HTMLButtonElement>('stop');
const bpmInput = $<HTMLInputElement>('bpm');
const swingInput = $<HTMLInputElement>('swing');
const volInput = $<HTMLInputElement>('volume');
const meterSel = $<HTMLSelectElement>('meter');
const vizCanvas    = $<HTMLCanvasElement>('viz');
const engineSel    = $<HTMLSelectElement>('engine-select');
const engineSel303 = $<HTMLSelectElement>('engine-select-303');

// ── Populate selects ───────────────────────────────────────────────────────
// Drum kit selector removed: presets dropdown (drums-machine.json) covers
// all 5 kits via the kitId param. Use Load preset to switch kit.

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const midiLabel = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

for (const m of COMMON_METERS) {
  const o = document.createElement('option');
  o.value = formatMeter(m);
  o.textContent = formatMeter(m);
  meterSel.appendChild(o);
}
meterSel.value = formatMeter(seq.meter);

// ── Track rendering (with viewport) ────────────────────────────────────────
const LANE_LABELS: Record<TrackId, string> = {
  bass: 'BASS', poly: 'POLY', drumBus: 'DRUM BUS',
  poly1: 'POLY 1', poly2: 'POLY 2', poly3: 'POLY 3', poly4: 'POLY 4',
  poly5: 'POLY 5', poly6: 'POLY 6', poly7: 'POLY 7', poly8: 'POLY 8', poly9: 'POLY 9',
  poly10: 'POLY 10', poly11: 'POLY 11', poly12: 'POLY 12', poly13: 'POLY 13',
  poly14: 'POLY 14', poly15: 'POLY 15', poly16: 'POLY 16',
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH HAT', openHat: 'OP HAT',
  clap: 'CLAP', cowbell: 'COWBLL', tom: 'TOM', ride: 'RIDE',
};

// ── Lane-engine host ──────────────────────────────────────────────────────
const laneHost = createLaneHost({
  getSeq: () => seq,
  getEngineSel: () => engineSel,
  rebuildEngineParamUI,
  getLaneLabels: () => LANE_LABELS as Record<string, string>,
});
const getLaneEngineId     = (laneId: string) => laneHost.getLaneEngineId(laneId);
const setActiveEngineLane = (laneId: string) => laneHost.setActiveEngineLane(laneId);
const _lehState = laneHost.state; // kept for engineSelectorDeps (uses _lehState.activeLaneId)

// ── Mixer ──────────────────────────────────────────────────────────────────

const mixerDeps: import('./core/mixer').MixerColumnDeps = {
  stripFor: (t) => stripFor(t as TrackId),
  label:    (t) => {
    // Resolve mixer track id → session lane id → display slug. Drum voices
    // (`kick`, `snare`, …) don't have their own session lane; fall back to
    // the static label.
    const laneId = laneTrackHelpers.trackIdToLaneId(t);
    const sessionLane = sessionHost.state.lanes.find((l) => l.id === laneId);
    if (sessionLane?.name) return laneTrackHelpers.slugifyLaneName(sessionLane.name);
    return LANE_LABELS[t as TrackId] ?? t;
  },
  muteState: muteState as unknown as Record<string, boolean>,
  soloState: soloState as unknown as Record<string, boolean>,
  applyMuteSolo,
  registerKnob,
  // VU-meter teardown: each mixer column registers its level-meter dispose
  // handle so SessionHost.renderWithMixer can tear it down before rebuilding the
  // mixer row (prevents the RAF + retained-analyser leak across re-renders).
  registerDisposable: (d) => sessionHost.registerMixerDisposable(d),
  // Late-bound via getter: _discreteHistoryDeps is assigned after historyDeps
  // is built (further below), but mixer columns are built at user-interaction
  // time so the getter always sees the final value.
  get historyDeps() { return _discreteHistoryDeps; },
};

bpmInput.addEventListener('input', () => {
  const v = parseFloat(bpmInput.value);
  // Manual BPM edit = take constant-tempo control: drop any active song tempo map.
  if (!isNaN(v)) { seq.setTempoMap(undefined); bpmBroadcast.broadcast(clampBpm(v)); }
});
bpmBroadcast.broadcast(seq.bpm);

// Programmatic tempo set (MIDI import, demo load): clamp, broadcast and reflect
// it in the visible BPM input. Distinct from the 'input' handler above, which
// must NOT write the input back while the user is mid-type.
function setTransportBpm(bpm: number): void {
  // Keep the FLOAT — a detected 127.63 must not snap to 128, or native-played
  // audio (stems/loops) drifts against the grid within a few bars.
  const clamped = clampBpm(bpm);
  // Default to constant tempo; a MIDI import with tempo changes re-sets a map
  // immediately after (so demos/saves/stems, which don't, clear a stale map).
  seq.setTempoMap(undefined);
  bpmBroadcast.broadcast(clamped);
  bpmInput.value = formatBpm(clamped);
}

// Track activity timestamps for visual "triggered" pulse on track headers.
const trackActiveUntil = new Map<string, number>();
function markTrackActive(trackId: string, audioTime: number) {
  const delayMs = Math.max(0, (audioTime - ctx.currentTime) * 1000);
  window.setTimeout(() => {
    trackActiveUntil.set(trackId, performance.now() + 120);
  }, delayMs);
}

// chain/loop/slot/onEnded wired in wireTransport() (see boot section)

swingInput.addEventListener('input', () => { seq.swing = parseFloat(swingInput.value); });

volInput.addEventListener('input', () => {
  master.gain.value = parseFloat(volInput.value);
  // Inverse sync (#volume → master strip fader): keep the fader visually in
  // step when the value changes here (drag, load, undo). Only assign .value —
  // never dispatch 'input' on the fader, or we'd loop back into this handler.
  const mf = document.querySelector('.master-strip .mix-fader') as HTMLInputElement | null;
  if (mf && mf.value !== volInput.value) mf.value = volInput.value;
});
master.gain.value = parseFloat(volInput.value);

// ── Gesture brackets for continuous inputs (BPM / swing / volume) ──────────
// One drag or keyboard-edit = one undo entry. pointerdown/focus opens the
// gesture; pointerup/blur closes it. The existing 'input' handlers above keep
// driving live audio and must NOT call beginGesture/commitGesture themselves.
for (const el of [bpmInput, swingInput, volInput]) {
  el.addEventListener('pointerdown', () => {
    if (_discreteHistoryDeps) _discreteHistoryDeps.beginGesture?.();
  });
  el.addEventListener('pointerup', () => {
    if (_discreteHistoryDeps) _discreteHistoryDeps.endGesture?.();
  });
  el.addEventListener('focus', () => {
    if (_discreteHistoryDeps) _discreteHistoryDeps.beginGesture?.();
  });
  el.addEventListener('blur', () => {
    if (_discreteHistoryDeps) _discreteHistoryDeps.endGesture?.();
  });
}

// Holder for historyDeps for discrete selectors. historyDeps is built later
// (it closes over saveWiringDeps / sessionHost), but event handlers fire after
// boot, so assigning _discreteHistoryDeps after construction works correctly.
let _discreteHistoryDeps: HistoryDeps | undefined;

// Legacy global wave selector removed — TB-303 wave is a per-lane engine param
// (osc.wave) rendered by TB303Engine.buildParamUI, like every other engine.

meterSel.addEventListener('change', () => {
  // Keep the same number of bars across a meter change: derive the bar count
  // from the current length under the OLD meter, then re-length under the new
  // one. (The legacy "Bars" selector that used to drive this was removed.)
  const bars = Math.max(1, Math.round(seq.length / stepsPerBar(seq.meter)));
  seq.meter = meterFromLabel(meterSel.value);
  seq.setLength(bars * stepsPerBar(seq.meter));
  // The scheduler + transport read seq.meter / seq.length live on the next step.
  renderLanes();
});

const knobs = createKnobMounter({
  registerKnob,
  registry: automationRegistry,
  laneResources,
  // Phase G: synth removed — refreshKnobsFromSynth resolves lazily from laneResources.
  fmtPct, fmtDb,
  getSessionState: () => sessionHost?.state,
  getLaneDisplayName: (id) => sessionHost?.state.lanes.find((l) => l.id === id)?.name,
  sidechainBus,
  getHistoryDeps: () => _discreteHistoryDeps,
});
const mountSubtractiveLaneKnobs = knobs.mountSubtractiveLaneKnobs;
const mountDrumMasterLaneKnobs = knobs.mountDrumMasterLaneKnobs;
const mountLaneFxPanel = knobs.mountLaneFxPanel;
const refreshKnobsFromSynth = knobs.refreshKnobsFromSynth;
const refreshLaneKnobs = knobs.refreshLaneKnobs;

// TB-303 engine knobs are rendered per-lane by TB303Engine.buildParamUI
// (into .engine-mod-host) — no boot-wired static `#synth-knobs` row anymore.

// pager/slots/onPatternChange wired in wireTransport() (see boot section)
// Pre-populate the bank's slot 0 with the sequencer's initial pattern (set up below)
// Done after setupInitialPattern.

// ── Save / Load ─────────────────────────────────────────────────────────────
// v1 legacy saveAll/loadAll/normalizePattern removed (replaced by Save Manager v2
// in src/save/save-wiring.ts which uses buildSavedStateV2 / applyLoadedState).

function flashButton(b: HTMLButtonElement, msg: string) {
  const orig = b.textContent;
  b.textContent = msg;
  b.disabled = true;
  setTimeout(() => { b.textContent = orig; b.disabled = false; }, 800);
}

// Save/Load buttons are wired in the Save Manager v2 section below.

// ── Tab switching (static tabs only — synth tabs have their own handler) ───
const pages = $$<HTMLElement>('.page');
for (const t of $$<HTMLButtonElement>('button.tab')) {
  if (t.classList.contains('synth-tab') || t.classList.contains('synth-tab-add')) continue;
  t.addEventListener('click', () => {
    const target = t.dataset.tab;
    document.querySelectorAll<HTMLButtonElement>('button.tab').forEach((x) => x.classList.toggle('active', x === t));
    pages.forEach((p) => { p.hidden = p.dataset.page !== target; });
  });
}

// Per-lane live-voice registry: trigger-dispatch records each voice it creates,
// and every Stop seam (transport Stop, STOP ALL, stopLane/stopAll) releases the
// tracked voices so a long 'audio' channel clip stops immediately instead of
// playing to the end of its buffer after Stop.
const liveVoices = new LiveVoiceRegistry();

// Diagnostics voice tap: dormant (fn=null) until the perf tool opens.
const perfVoiceTap: PerfVoiceTap = { fn: null };

// Single-entry-point trigger dispatch — delegates by engine.id.
// Phase G: drums removed from deps (drums-machine triggers via res.engine.createVoice).
const triggerForLane = createTriggerForLane({
  ctx, laneResources, seq, liveVoices,
  onVoiceFired: (laneId, gateSec) => perfVoiceTap.fn?.(laneId, gateSec),
});

// ── Session host ───────────────────────────────────────────────────────────
// synthEditorDeps is constructed later (after polySynthUIDeps + polySynthPresetsDeps
// exist). showPolyEditorWrapper reads it lazily at call time.
let synthEditorDeps: import('./session/synth-editor-routing').SetActivePolyTargetDeps | null = null;
const showPolyEditorWrapper = (laneId: string, target: PolySynth, displayName: string) => {
  if (!synthEditorDeps) return;
  showPolyEditor(laneId, target, displayName, synthEditorDeps);
};
// Active-lane store: single source of truth bridged to SessionHost.activeEditLane
// so the UI and the APC stay in sync. Mirrored in onActiveLaneChanged below.
const activeLaneStore = createActiveLaneStore();
const sessionHost = new SessionHost({
  ctx, seq, playBtn,
  resetAutomationPosition,
  applyBpm: setTransportBpm,
  // Unified stop: the session "⏹ all" button finalizes any live-take recording,
  // stops the clock + every lane, and resets the Play button. stopTransport is a
  // hoisted function declaration further down, so this arrow can call it even
  // though it's lexically defined later (it only fires on a user click).
  onStopAll: () => stopTransport(),
  triggerForLane,
  liveVoices,
  // Phase G: drums removed — triggerForLane handles drums via engine.createVoice.
  drumLanes: DRUM_LANES,
  markTrackActive,
  ensureExtraPoly: ensureExtraPoly as (id: string) => PolySynth,
  extraStrips: extraStrips as Partial<Record<string, ChannelStrip>>,
  getLaneEngineId,
  ensureLaneVoice,
  showPolyEditor: showPolyEditorWrapper,
  setActiveEngineLane,
  // Phase G: polysynth removed from SessionHostDeps.
  mixerDeps,
  midiLabel,
  automationRegistry,
  getAutoAbsSubIdx,
  onActiveLaneChanged: () => {
    populateAutoParamSelectWrapper();
    // Re-mount the drum-master strip UI for the active drum lane so its
    // knobs control the right ChannelStrip + appear under the right
    // registry prefix in the LFO/ADSR destination dropdown.
    const active = sessionHost.activeEditLane;
    if (active) {
      const engineId = sessionHost.state.lanes.find((l) => l.id === active)?.engineId;
      if (engineId === 'drums-machine') mountDrumMasterLaneKnobs(active);
      if (engineId === 'tb303') engineSel303.value = 'tb303';
      mountLaneFxPanel(active);
    }
    // Mirror the active lane into the control store (guarded → no UI↔APC loop).
    activeLaneStore.set(sessionHost.activeEditLane);
  },
  laneResources,
  ensureLaneResource,
  swapLaneEngine,
  masterInsertChain,
  fxBus: fx,
  // Master strip in the last mixer column: a full lane-style column — the fader
  // proxies #volume, the VU reads the dedicated master meter tap, and the
  // EQ/pan/mute knobs drive masterStrip (audio-graph.ts).
  volInput,
  masterMeterAnalyser,
  masterStrip,
  applyPresetForLane: (laneId, presetName) => {
    // presetName is a prefixed value matching the dropdown vocabulary
    // (factory: / user: / engine:). See src/presets/preset-apply.ts.
    const inst = getLaneEngineInstance(laneId);
    if (!inst) return;
    applyPresetToEngine(inst, presetName);
    // Mark the per-page (303/drums) preset dropdown so it reflects the
    // recalled preset on load (subtractive/poly are handled by
    // refreshPolyPresetSelect via polyPresetName).
    recordPagePresetForLane(laneId, presetName);
    refreshPolyPresetSelect();
    refreshLaneKnobs(laneId, inst);
  },
});
// Phase G: synthEditorState.activePolyTarget initialized to null at boot;
// set to the actual PolySynth instance in sessionHost.onStateApplied (see below).
sessionHost.init();
// Now sessionHost is live — upgrade the lookupEngineId impl to use SessionState
// as the source of truth (replaces the pattern-based fallback used at boot).
laneHost.setLookupEngineId((laneId) =>
  sessionHost.state.lanes.find((l) => l.id === laneId)?.engineId ?? 'subtractive');

// ── Musicality bar ────────────────────────────────────────────────────────────
const musicalityHost = $<HTMLDivElement>('musicality-bar');
const musicalityBar = renderMusicalityBar(musicalityHost, {
  get: () => sessionHost.state.musicality ?? DEFAULT_MUSICALITY,
  onChange: (next) => {
    const run = () => {
      sessionHost.state.musicality = next;
      sessionHost.renderWithMixer();
    };
    if (_discreteHistoryDeps) withUndo(_discreteHistoryDeps, run); else run();
  },
});
// Refresh the summary whenever a new session is applied (boot demo, demo
// picker, save-load, new-session) so the displayed tonality stays in sync.
sessionHost.onStateApplied(() => musicalityBar.refresh());

// ── Live MIDI control subsystem ─────────────────────────────────────────────
// Assemble facade → mediator → access seam → UI. activeLaneStore (declared
// above) is mirrored from SessionHost.activeEditLane in onActiveLaneChanged.
const controlFacade = createLoomFacade({
  ctx,
  sessionHost,
  laneResources,
  activeLane: activeLaneStore,
  knobRegistry: automationRegistry,   // `${laneId}.${paramId}` → KnobHandle
  seq,
  // Late-bound via getter: _discreteHistoryDeps is assigned after historyDeps
  // is built (further below), but loop-record commits happen at user-interaction
  // time, so the getter always sees the final value.
  get historyDeps() { return _discreteHistoryDeps; },
});

let controlMediator: ReturnType<typeof createMediator> | null = null;
const midiAccess = createMidiAccess();   // uses globalThis.navigator

async function enableMidiControl(overrideProfileId: string | null): Promise<{ ok: boolean; label: string }> {
  const res = await midiAccess.enable({
    forceProfileId: overrideProfileId ?? undefined,
    onEvent: (ev) => controlMediator?.handle(ev),
  });
  if (!res.ok) {
    saveControlPrefs({ enabled: false, overrideProfileId });
    const label = res.reason === 'unsupported' ? 'MIDI not supported in this browser'
      : res.reason === 'denied' ? 'permission denied'
      : 'no controller found';
    return { ok: false, label };
  }
  const profile = listProfiles().find((p) => p.id === res.profileId)!;
  controlMediator = createMediator({
    facade: controlFacade, profile, send: (b) => midiAccess.send(b), variant: res.variant,
  });
  controlMediator.refreshLeds();
  saveControlPrefs({ enabled: true, overrideProfileId });
  return { ok: true, label: `${profile.label} (${res.variant}) ✓` };
}

function disableMidiControl(): void {
  controlMediator?.dispose();
  controlMediator = null;
  midiAccess.disable();
  saveControlPrefs({ enabled: false, overrideProfileId: null });
}

wireControlSurfaceUI({
  onEnable: enableMidiControl,
  onDisable: disableMidiControl,
  profiles: listProfiles().map((p) => ({ id: p.id, label: p.label })),
  initialEnabled: loadControlPrefs().enabled,
});

// Keep LEDs in sync with clip launches: refresh after every mixer render.
const _origRenderWithMixer = sessionHost.renderWithMixer.bind(sessionHost);
sessionHost.renderWithMixer = () => { _origRenderWithMixer(); controlMediator?.refreshLeds(); };

// Clean the device on page unload.
window.addEventListener('beforeunload', () => disableMidiControl());

// Auto-reconnect if the user had it enabled (browser remembers the permission grant).
if (loadControlPrefs().enabled) {
  void enableMidiControl(loadControlPrefs().overrideProfileId);
}

// Engine swap: change the engine of an existing lane in place.
const engineSwapDeps: EngineSwapDeps = {
  state: sessionHost.state,
  getEngineEditor: (id) => getEngine(id)?.editor,
  getEngineParamIds: (id) => getEngineParamIds(id),
  swapLaneEngine,
  onSwapped: (laneId, newId) => {
    // Re-route the editor to the new engine's page + rebuild its panels, then
    // keep both engine selectors in sync with the swapped lane.
    sessionHost.showLaneEditor(laneId);
    engineSel.value = newId;
    engineSel303.value = newId;
  },
  // saveSession is intentionally omitted: SessionHost has no autosave callback
  // wired here; the swap mutates SessionState (engineId/engineState), which is
  // what serializes on save, and undo is the immediate safety net.
};

// One undoable entry per swap. Used by both engine selectors.
const onEngineChangeUndoable = (laneId: string, newId: string) => {
  const run = () => { swapLaneEngineFlow(engineSwapDeps, laneId, newId); };
  if (_discreteHistoryDeps) withUndo(_discreteHistoryDeps, run); else run();
};


// onStep still fires for bass/drum/melody cell highlighting; the continuous
// automation engine runs separately via rAF (see startAutomationTick).

// ── REC button (arms knob → lane recording) ───────────────────────────────
const recBtn = $<HTMLButtonElement>('rec');

// ── Performance view feature ──────────────────────────────────────────────
// REC button is wired by the Performance feature (legacy automation.wireRecButton
// is no longer attached — the Performance recorder owns REC behaviour now).
// recHooks + onAfterTick are patched into sessionHost.deps after construction
// because the feature needs sessionHost to resolve clip launches.
// Bind the original transport methods BEFORE the patch below, so the song-end
// callback can stop the engine directly without re-entering the patched seq.stop.
const _origStart = seq.start.bind(seq);
const _origStop = seq.stop.bind(seq);

const performanceFeature = createPerformanceFeature({
  ctx, seq, sessionHost,
  automationRegistry,
  // The full master strip is hidden with the session root in Performance mode;
  // these feed the compact master (VU + #volume-proxy fader) in the perf toolbar.
  masterMeterAnalyser, volInput,
  // Arrangement reached the end (song mode): halt the engine + reset the Play
  // button so the next Play restarts from the top.
  onArrangementEnd: () => { _origStop(); setPlaying(playBtn, false); },
  onRegisterKnob: (hook) => {
    const origRegister = automation.registerKnob.bind(automation);
    automation.registerKnob = (k: KnobHandle) => {
      origRegister(k);
      hook(k);
    };
    for (const k of automationRegistry.values()) hook(k);
  },
  onRecVisualChanged: () => refreshRecButton(),
});
(sessionHost.deps as { recHooks?: import('./session/session-runtime').RecHooks }).recHooks =
  performanceFeature.recHooks;
(sessionHost.deps as { onAfterTick?: (n: number, l: number) => void }).onAfterTick =
  performanceFeature.onLookahead;

// Performance needs the SAME look-ahead engine as Session: tickArrangement and
// the per-lane tickSession both run from seq.tick → onLookahead, so the engine
// must start in both modes. onPlay/onStop do the arrangement/REC bookkeeping;
// the engine always starts/stops. (Previously onPlay()===true skipped
// _origStart, so Performance had no engine → no sound, and seq.isPlaying()
// stayed false so the Play button never toggled to Stop.)
seq.start = () => { performanceFeature.onPlay(); _origStart(); };
seq.stop = () => { performanceFeature.onStop(); _origStop(); };

const copyBtn = document.getElementById('copy-to-performance');
copyBtn?.addEventListener('click', () => performanceFeature.copyFromSession());

document.getElementById('capture-scene')?.addEventListener('click', () => sessionHost.captureScene());

// Ctrl/Cmd+I — capture currently-playing clips into a new scene. Skip while
// typing in a text field so it never steals input from BPM / save-name inputs.
document.addEventListener('keydown', (e) => {
  if (isTextEditTarget(e.target)) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() !== 'i') return;
  e.preventDefault();
  sessionHost.captureScene();
});

// ── Deps objects for extracted UI modules ─────────────────────────────────

// Engine selector UI (must come after populateAutoParamSelectWrapper is set)
const engineSelectorDeps: EngineSelectorUIDeps = {
  engineSel,
  getActiveLaneId: () => _lehState.activeLaneId,
  getLaneEngineId,
  automationRegistry,
  registerKnob,
  populateAutoParamSelect: () => populateAutoParamSelectWrapper(),
  remountSubtractiveLaneKnobs: (laneId) => mountSubtractiveLaneKnobs(laneId),
  remountLaneFxPanel: (laneId) => mountLaneFxPanel(laneId),
  // Late-bound via getter: _discreteHistoryDeps is assigned after historyDeps
  // is built (further below), but the change handler fires at user-interaction
  // time, so the getter always sees the final value.
  get historyDeps() { return _discreteHistoryDeps; },
  // Raw flow here — the poly selector's change handler already wraps in withUndo
  // via historyDeps above.
  onEngineChange: (laneId, newId) => { swapLaneEngineFlow(engineSwapDeps, laneId, newId); },
};
wireEngineSelector(engineSelectorDeps, currentEngineId);

wireEngineSelector303({
  engineSel303,
  getActiveLaneId: () => sessionHost.activeEditLane,
  onEngineChange: onEngineChangeUndoable,
});

const polySynthPresetsDeps: PolySynthPresetsDeps = {
  // Phase G: polysynth removed; getActivePolyTarget uses synthEditorState only.
  getActivePolyTarget: () => synthEditorState.activePolyTarget ?? null,
  getActiveEngineLaneId: () => _lehState.activeLaneId,
  getLaneEngineId,
  getLaneEngineInstance,
  rebuildEngineParamUI,
  refreshLaneKnobs: (laneId) => {
    const inst = getLaneEngineInstance(laneId);
    if (inst) refreshLaneKnobs(laneId, inst);
  },
  // Late-bound via getter so historyDeps is resolved at event-fire time.
  get historyDeps() { return _discreteHistoryDeps; },
  applyDrumKitPreset: (laneId, name) => { void sessionHost.applyDrumPreset(laneId, name); },
};

// Now that polySynthPresetsDeps exist, wire synthEditorDeps
// (referenced lazily by showPolyEditorWrapper above).
synthEditorDeps = {
  refreshPolyKnobsFromState: () => {
    // Re-mount the section knobs under the active lane's id so the LFO/ADSR
    // destination dropdown for *that* lane finds them in the registry. Only
    // applies to subtractive lanes — other poly engines render their own UI
    // inside engine-mod-host on every editLane click.
    // Use synthEditorState.currentSynthLane because setActivePolyTarget sets
    // it BEFORE invoking this callback (whereas _lehState.activeLaneId is
    // updated by setActiveEngineLane which runs AFTER).
    const activeLaneId = synthEditorState.currentSynthLane;
    const engine = laneResources.get(activeLaneId)?.engine;
    if (engine?.id === 'subtractive') {
      mountSubtractiveLaneKnobs(activeLaneId);
      mountLaneFxPanel(activeLaneId);
    }
  },
  refreshPolyPresetSelect: () => refreshPolyPresetSelect(),
  setActiveEngineLane: (laneId: string) => setActiveEngineLane(laneId),
};

// Phase G: deferred to sessionHost.onStateApplied (lane not allocated at boot).
// mountSubtractiveLaneKnobs(LANE_ID_POLY) — see boot section below.


const fxUIDeps: FxUIDeps = {
  ctx, fx, masterInsertChain, masterComp, getBpm: () => seq.bpm, registerKnob,
  // Late-bound via getter so historyDeps is resolved at event-fire time.
  get historyDeps() { return _discreteHistoryDeps; },
  // Task 28: expose session state so master insert slots are persisted.
  getSessionState: () => sessionHost.state,
};
const { rebuildMasterInserts, rebuildSends, refreshMasterComp } = wireFxUI(fxUIDeps);
// Task 28: rebuild master insert UI after each session load so the slots
// array reference stays in sync with sessionHost.state.masterInserts.
sessionHost.onStateApplied(rebuildMasterInserts);
// Task 10: rebuild send modules after each session load so insert racks
// reflect the loaded sessionState.sends[i].inserts.
sessionHost.onStateApplied(rebuildSends);
// Pull the master-comp knobs + bypass back into sync after a session load
// (applyLoadedStateV3 has already restored the compressor via masterComp.setState).
sessionHost.onStateApplied(refreshMasterComp);
// Phase G: deferred to sessionHost.onStateApplied (lane not allocated at boot).
// mountDrumMasterLaneKnobs(LANE_ID_DRUMS) — see boot section below.
// ── Scene export (real-time live-take + offline WAV) ──────────────────────
// The button + helpers are declared BEFORE the transport block because the
// live-take recorder (and the unified stopTransport) close over them, and
// wireTransport(transportDeps) below must see liveTake + stopTransport already.
// One REC button (#rec) + a 3-mode selector (🎛 take / ⏱ live / ⚡ offline). All
// three deliver via deliverTake. recBtn is declared above; the old separate
// #export-scene control + its rt/offline menu are folded in here.
const EXPORT_TAIL_SEC = 2;    // live take: let reverb/delay tails decay before the cut
type RecMode = 'take' | 'live' | 'offline';
let recMode: RecMode = 'take';
let liveState: 'idle' | 'armed' | 'recording' = 'idle';
let exportMsgTimer: number | undefined;

// Paint the shared REC button from the active mode + its recorder state.
function refreshRecButton(): void {
  if (exportMsgTimer !== undefined) return; // a transient message owns the label
  recBtn.classList.remove('armed', 'recording');
  if (recMode === 'live') {
    recBtn.classList.toggle('armed', liveState === 'armed');
    recBtn.classList.toggle('recording', liveState === 'recording');
    recBtn.textContent = liveState === 'armed' ? '● ARMED' : liveState === 'recording' ? '● Recording…' : '● REC';
  } else if (recMode === 'take') {
    recBtn.classList.toggle('armed', performanceFeature.rec.armed);
    recBtn.textContent = performanceFeature.rec.armed ? '● REC ON' : '● REC';
  } else {
    recBtn.textContent = '● REC';
  }
}

function showExportMessage(msg: string): void {
  if (exportMsgTimer !== undefined) clearTimeout(exportMsgTimer);
  recBtn.textContent = msg;
  exportMsgTimer = window.setTimeout(() => { exportMsgTimer = undefined; refreshRecButton(); }, 1500);
}

// Real-time take: ARM → Play → Stop. Arming pre-connects the master tap; Play
// starts the capture; the unified stop finalizes it (delivered via deliverTake).
const liveTake = new LiveTakeRecorder({
  ctx,
  tap: masterComp.output,
  tailSec: EXPORT_TAIL_SEC,
  onState: (s) => { liveState = s; refreshRecButton(); },
  onTake: (audio) => deliverTake(audio),
  onError: (m) => { console.warn('[live-take]', m); showExportMessage(m); },
});

// Unified stop: finalize any in-progress take (delivers via onTake), then stop
// the master clock + every lane and reset the Play button + re-render. Clearing
// each lane's `playing` clip returns the editor playheads to -1 (cursors
// disappear) and re-renders the clip cells as stopped. Matches "⏹ all".
function stopTransport(): void {
  liveTake.finish();
  if (seq.isPlaying()) seq.stop();
  // Pass the live-voice silencer so a long 'audio' channel clip is cut now,
  // not when its buffer ends (it has no gate to self-terminate on Stop).
  stopAllLanes(sessionHost.laneStates, liveVoices, ctx.currentTime);
  setPlaying(playBtn, false);
  sessionHost.renderWithMixer();
}

const transportDeps: TransportDeps = {
  seq, ctx, playBtn, stopBtn,
  resetAutomationPosition,
  onStop: stopTransport,
};
wireTransport(transportDeps);

// Performance diagnostics (PERF button). Zero cost until toggled open.
const perfDiagnostics = createPerfDiagnostics({
  ctx, seq, voiceTap: perfVoiceTap, mount: document.body,
  resolveLaneName: (id) => sessionHost.state.lanes.find((l) => l.id === id)?.name ?? id,
  // Master peak/clip + limiter gain-reduction row (post-limiter tap).
  masterAnalyser: masterMeterAnalyser, masterComp,
});
document.getElementById('perf-toggle')?.addEventListener('click', (e) => {
  perfDiagnostics.toggle();
  (e.currentTarget as HTMLElement).classList.toggle('on', perfDiagnostics.isOpen());
});

// Begin capturing an armed live-take whenever the transport starts — from ANY
// path. Wiring this to the ▶ button alone missed scene/clip launches (the most
// natural way to start playback), so the armed take never recorded. Centralized
// on the Sequencer's idle→playing transition; onTransportStart() is a no-op
// unless a take is armed, so this is safe on every start.
// Chain, don't overwrite: SessionHost.init() already installed an onStart that
// resets the global song anchor; preserve it so the playhead anchors at the
// downbeat. (seq.onStart is a single slot — a plain assign would drop the reset.)
const prevOnStart = seq.onStart;
seq.onStart = () => { prevOnStart?.(); liveTake.onTransportStart(); };

// Shared delivery for a finished take/render (live OR offline): ask where it
// goes (download a WAV vs a new audio channel) — never auto-insert. The channel
// branch passes the project BPM so the clip locks to the grid (warp 1.0) instead
// of re-detecting the tempo of audio we just rendered.
function deliverTake(audio: RenderedAudio): void {
  void (async () => {
    const dest = await showTakeDestinationDialog();
    if (!dest) { showExportMessage('Take discarded'); return; }
    const blob = wavEncoder.encode(audio.channels, audio.sampleRate);
    if (dest === 'file') {
      downloadBlob(blob, `loom-take-${exportTimestamp()}.${wavEncoder.extension}`);
      showExportMessage('Take → WAV file');
    } else {
      const file = new File([blob], `loom-take-${exportTimestamp()}.wav`, { type: 'audio/wav' });
      sessionHost.addAudioChannel(file, { knownBpm: seq.bpm });
      showExportMessage('Take → audio channel');
    }
  })();
}

function runOfflineExport(): void {
  // Render EXACTLY the musical (bar-aligned) length — no reverb tail. At the
  // project BPM that makes the warp ratio 1.0 and the loop seamless, so the
  // result locks to the grid. (A trailing tail rounds up to an extra bar and
  // drifts — the offline "no sincroniza" bug.) Then route through the dialog.
  const musicSec = soundingSceneDurationSec(sessionHost.laneStates, seq.meter, seq.bpm);
  if (musicSec <= 0) { showExportMessage('Launch a scene first'); return; }
  if (exportMsgTimer !== undefined) { clearTimeout(exportMsgTimer); exportMsgTimer = undefined; }
  recBtn.disabled = true; playBtn.disabled = true;
  recBtn.textContent = 'Rendering…';
  void (async () => {
    try {
      const rendered = await new OfflineSceneRecorder({
        state: sessionHost.state,
        laneStates: sessionHost.laneStates,
        bpm: seq.bpm,
        meter: seq.meter,
      }).record(musicSec);
      deliverTake(rendered);
    } catch (err) {
      showExportMessage('Export failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      recBtn.disabled = false; playBtn.disabled = false;
      if (exportMsgTimer === undefined) refreshRecButton();
    }
  })();
}

// 3-mode selector (🎛 take / ⏱ live / ⚡ offline) — mutually exclusive: switching
// disarms whatever the leaving mode had armed.
const recModeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-recmode]'));
function setRecMode(m: RecMode): void {
  if (m === recMode) return;
  if (recMode === 'take' && performanceFeature.rec.armed) performanceFeature.toggleTakeRec();
  if (recMode === 'live' && liveState === 'armed') void liveTake.toggleArm();
  recMode = m;
  for (const b of recModeBtns) b.classList.toggle('on', b.dataset.recmode === m);
  refreshRecButton();
}
for (const b of recModeBtns) b.addEventListener('click', () => setRecMode(b.dataset.recmode as RecMode));

// The single REC button dispatches by the active mode.
recBtn.addEventListener('click', () => {
  void ctx.resume();
  if (recMode === 'take') { performanceFeature.toggleTakeRec(); refreshRecButton(); }
  else if (recMode === 'live') { void liveTake.toggleArm(); }
  else runOfflineExport();
});
refreshRecButton();

{
  const positionEl = document.getElementById('transport-position');
  const timeEl     = document.getElementById('transport-time');
  if (positionEl && timeEl) {
    void import('./core/transport-display').then(({ wireTransportDisplay }) => {
      wireTransportDisplay({ seq, ctx, positionEl, timeEl, bpmEl: bpmInput });
    });
  }
}
wirePolyControls(polySynthPresetsDeps);

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
    applyDrumPreset: (id, name) => { void sessionHost.applyDrumPreset(id, name); },
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
  onImported: () => performanceFeature.copyFromSession(),
  // Replace import = a clean slate. Same full wipe as the "New session" button:
  // stop the transport + silence voices, dispose every old lane resource (engines
  // AND their modulators/LFOs) + close open editors via applyLoadedSessionState,
  // and reset the Performance arrangement. (No markClean — the import IS a change.)
  resetSession: () => {
    stopTransport();
    sessionHost.applyLoadedSessionState(emptySessionState());
    performanceFeature.resetArrangement();
  },
  // Allocate strip+engine for the freshly-seeded lanes BEFORE the import renders
  // the mixer (renderWithMixer throws on a lane with no resource).
  prepareLanes: () => prepareImportedLaneResources(),
});

const automationTickDeps: AutomationTickDeps = {
  seq,
  automationRegistry,
  getLaneStates: () => sessionHost.laneStates,
  ctx,
  // Lets the rAF loop read each lane's live modulation offsets for the knob rings.
  getEngineForLane: (laneId) => getLaneEngineInstance(laneId) ?? undefined,
};

startAutomationTick(automationTickDeps);

// Phase G: boot-eager UI deferred until applyLoadedSessionState allocates lanes.
// Registers callbacks BEFORE the demo load so they fire on the first apply.
sessionHost.onStateApplied(() => {
  // Drum master knobs
  mountDrumMasterLaneKnobs(LANE_ID_DRUMS);
  // Subtractive poly lane knobs
  mountSubtractiveLaneKnobs(LANE_ID_POLY);
  // Set active poly target for synth editor
  const polyEng = laneResources.get(LANE_ID_POLY)?.engine;
  const polyInst = (polyEng as unknown as { getPolySynth?(): PolySynth | null } | undefined)?.getPolySynth?.() ?? null;
  if (polyInst) synthEditorState.activePolyTarget = polyInst;
});

// Boot demo: fetched as a static JSON asset rather than constructed
// programmatically. The JSON drives the SessionState; applyLoadedSessionState
// reads each lane.enginePresetName to set that channel's sound.
//
// We gate the demo apply on `presetsLoaded` so the engine preset cache is
// populated before applyLoadedSessionState calls applyPresetByName.
// Gate the demo apply on BOTH the preset cache AND the worklet module: the demo
// allocates a subtractive lane (LANE_ID_POLY) whose WorkletLaneEngine needs the
// processor registered before it constructs its AudioWorkletNode.
Promise.all([presetsLoaded, workletReady])
  .then(() => fetchDemoSession(`${import.meta.env.BASE_URL}demos/minimal-techno.json`))
  .then((state) => {
    sessionHost.applyLoadedSessionState(state);
    if (typeof state.bpm === 'number') setTransportBpm(state.bpm);
    autoHistory.markClean();
  })
  .catch((err: unknown) => {
    console.error('Demo load failed; falling back to empty session.', err);
  });

// Demo picker: just the hand-built Minimal Techno showcase (also the boot
// default). MIDI content is loaded live via the transport MIDI Import — there
// are no pre-baked MIDI demos.
const demoPicker = document.getElementById('demo-picker') as HTMLSelectElement | null;
if (demoPicker) {
  // Wire the picker only after the worklet module is registered: picking a demo
  // runs applyLoadedSessionState synchronously, which allocates a subtractive
  // WorkletLaneEngine (→ new AudioWorkletNode). Doing so before addModule
  // resolves would throw. On a normal load this resolves in ms.
  void workletReady.then(() => {
    wireDemoPicker({
      sessionHost,
      selectEl: demoPicker,
      demos: [
        { label: 'Minimal Techno', path: `${import.meta.env.BASE_URL}demos/minimal-techno.json` },
        { label: 'Acid Rain', path: `${import.meta.env.BASE_URL}demos/acid-rain.json` },
        { label: 'Cordillera', path: `${import.meta.env.BASE_URL}demos/cordillera.json` },
        { label: 'Neon Drive', path: `${import.meta.env.BASE_URL}demos/neon-drive.json` },
      ],
      applyBpm: setTransportBpm,
      onLoaded: () => autoHistory.markClean(),
    });
  });
}

// New: wipe to a fresh empty session (default 303/drums/sub lanes, no clips).
const newSessionBtn = document.getElementById('new-session');
newSessionBtn?.addEventListener('click', async () => {
  if (!await confirmDialog('Start a new empty session? Unsaved changes will be lost.')) return;
  // Stop the transport + silence every lane's voices BEFORE wiping. Without this
  // the master clock keeps running and in-flight voices keep sounding after the
  // old lanes are disposed → the "New leaves the old synths playing" bug.
  stopTransport();
  sessionHost.applyLoadedSessionState(emptySessionState());
  // Also wipe the Performance take + leave Performance mode. Without this New
  // cleared the session but left the old arrangement in the timeline, where
  // every band turned into an orphaned "missing" (clipEvents pointing at the
  // just-deleted clips).
  performanceFeature.resetArrangement();
  autoHistory.markClean();
});

// App is always in session mode — seq.sessionMode must be true at boot.
seq.sessionMode = true;
startVisualizer({ ctx, analyser, vizCanvas });

// ── Save Manager v2 (see src/save-wiring.ts) ──────────────────────────────
const history = createHistory<SavedStateV3>({ maxSize: 100 });
// Phase G: synth/drums replaced by lanes (resolved lazily inside buildSavedStateV3).
const saveBaseDeps = {
  ctx, seq, lanes, master,
  volInput, bpmInput, swingInput, meterSel,
  sessionHost,
  refreshKnobsFromSynth,
  renderLanes,
  fx,
  masterInsertChain,
  masterStrip,
  masterComp,
  flashButton,
  history,
};
// Save/load persists the Performance take + mode via the feature accessors.
const saveWiringDeps: import('./save/save-wiring').SaveWiringDeps = {
  ...saveBaseDeps,
  getMode: () => performanceFeature.getMode(),
  getArrangement: () => performanceFeature.arrangement,
  setMode: (m) => performanceFeature.setMode(m),
  setArrangement: (a) => performanceFeature.setArrangement(a),
  onAfterApply: () => autoHistory.markClean(),
};
// History (undo/redo) snapshots session state only — no perf accessors, so a
// recorded take is never wiped by undoing an unrelated session edit.
const savedStateDeps: SavedStateV3Deps = saveBaseDeps;
const historyDeps: HistoryDeps = {
  history,
  snapshot: () => buildSavedStateV3(savedStateDeps),
  restore: (s) => applyLoadedStateV3(s, savedStateDeps),
};
const autoHistory = createAutoHistory({
  history,
  snapshot: () => buildSavedStateV3(savedStateDeps),
  restore: (s) => applyLoadedStateV3(s, savedStateDeps),
  refreshAll: () => { sessionHost.refreshAfterRestore(); refreshMasterComp(); },
});
autoHistory.installGlobalListeners(document);
wireHistoryKeyboard(autoHistory);
wireUndoButtons(autoHistory);
// Route gesture brackets through AutoHistory's gestureDepth so pointer-capture
// drags (piano-roll, drum-grid, knobs, faders) coalesce into one undo step.
historyDeps.beginGesture = () => autoHistory.beginGesture();
historyDeps.endGesture   = () => autoHistory.endGesture();
// Wire async-mutation checkpoint: stems / transcription / import flows call this
// after their async settle (no pointer/key event closes the event loop there).
sessionHost.deps.checkpointHistory = () => autoHistory.checkpoint();
// Wire historyDeps into the session inspector so drum-grid cell clicks are
// undoable. Must happen after historyDeps is built (it closes over sessionHost
// via savedStateDeps → saveWiringDeps).
sessionHost.setHistoryDeps(historyDeps);
// Stems: transport-bar "Stems…" dialog → local separation service. Every
// separation also transcribes each stem to a note/drums lane (always-on).
const stemClient = new StemClient(stemServiceBaseUrl());
wireStemDialog({
  ctx,
  client: stemClient,
  addStemLanes: (stems, opts) => sessionHost.addStemLanes(stems, opts),
  // Conform the project tempo to the imported audio (detected from the drums
  // stem) via the canonical BPM setter — scheduler, UI and tempo-locked engines.
  setSessionBpm: setTransportBpm,
  getMeter: () => seq.meter,
  transcribeStem: async (file, label, kind) => {
    // Per-stem + non-fatal: a transcription failure for one stem must not abort
    // the others (the audio Sampler lanes are already created either way).
    try {
      const result = await stemClient.transcribe(file, kind);
      const plan = transcribeToNoteLane(result, seq.bpm, seq.meter);
      if (plan.notes.length) {
        // Land the transcribed lanes in their own scene, separate from the
        // audio stems (the batch's scene is reset once per separation).
        sessionHost.addNoteLane(plan.engineId, plan.notes, plan.lengthBars, label, { newScene: true });
      }
    } catch (err) {
      console.warn('[stems] transcription failed for', label, err);
    }
  },
});
// Transcribe just the SELECTED LOOP of an audio clip → a fresh note/drums lane.
// Slice the loop's SOURCE audio (warp-aware) to a WAV, then run it through the
// same /transcribe chain the stems flow uses. Late-bound: it needs both the stem
// client (above) and the session host (below) to exist.
sessionHost.setTranscribeLoop(async (clip: SessionClip, kind: 'melodic' | 'drums') => {
  const s = clip.sample;
  if (!s) return;
  const buf = sampleCache.get(s.sampleId);
  if (!buf) return;
  const name = clip.name || 'Loop';
  try {
    const { startSec, endSec } = clipLoopSourceRange(clip, seq.meter, buf.duration);
    const wav = sliceBufferToWavFile(buf, startSec, endSec, `${name}.wav`);
    const result = await stemClient.transcribe(wav, kind);
    const plan = transcribeToNoteLane(result, seq.bpm, seq.meter);
    if (plan.notes.length) {
      sessionHost.resetTranscriptionScene();  // each loop transcription → its own scene
      sessionHost.addNoteLane(plan.engineId, plan.notes, plan.lengthBars, `${name} (notes)`, { newScene: true });
    }
  } catch (err) {
    console.warn('[transcribe-loop] failed for', name, err);
  }
});
// Activate undo for discrete selectors (kit, wave, engine, preset) now that
// historyDeps is ready.
_discreteHistoryDeps = historyDeps;
// wireRandomizeUI is here (not at its original boot position) because it needs
// historyDeps, which closes over saveWiringDeps, which closes over sessionHost.
wireRandomizeUI({
  // Phase G: synth resolved lazily from lane resources.
  getSynth: getSynthInstance,
  getBassLaneId: () => LANE_ID_BASS,
  getDrumsLaneId: () => LANE_ID_DRUMS,
  refreshKnobsFromSynth,
  applyDrumKitPreset: (laneId, name) => { void sessionHost.applyDrumPreset(laneId, name); },
  historyDeps,
});
wireSaveManager(saveWiringDeps);
// Recovery can allocate a subtractive lane synchronously, so gate it on the
// worklet module being registered (same reason as the boot demo above). On a
// fresh boot with no autosave this is a no-op regardless of timing.
void workletReady.then(() => bootRecoveryLoad(saveWiringDeps));

// App always boots in Session mode (see fetchDemoSession call above).
