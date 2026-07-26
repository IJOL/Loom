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
import { pruneKnobRegistryToDestinations } from './app/knob-registry-prune';
import { createTriggerForLane } from './app/trigger-dispatch';
import { LiveVoiceRegistry } from './app/live-voice-registry';
import { createKnobMounter } from './app/knob-mounting';
import { createLaneHost } from './app/lane-host-wiring';
import { createPerformanceFeature } from './app/performance-feature';
import { createRecordingFeature } from './app/recording-feature';
import { wireMidiImport } from './app/midi-import-wiring';
import { rebuildEngineParamUI } from './engines/engine-selector-ui';
import { wireEngineSelectors } from './app/engine-selector-wiring';
import { getEngine, getEngineParamIds } from './engines/registry';
import { swapLaneEngineFlow, type EngineSwapDeps } from './app/engine-swap';
import { type TB303 } from './core/synth';
import { Sequencer } from './core/sequencer';
import { COMMON_METERS, formatMeter } from './core/meter';
import { DRUM_LANES, type DrumVoice } from './core/drums';
import { ChannelStrip } from './core/fx';
import { type KnobHandle } from './core/knob';
import { PolySynth } from './polysynth/polysynth';
import * as laneTrackHelpers from './core/lane-display';
import { SessionHost } from './session/session-host';
import { emptySessionState, DEFAULT_MUSICALITY } from './session/session';
import { renderProjectOptionsDialog } from './session/project-options-dialog';
import { fetchDemoSession } from './demo/demo-loader';
import { wireDemoPicker, loadDemoSession } from './demo/demo-picker';
import { bindAboutDialog } from './app/about-dialog';
import { applyPresetToEngine } from './presets/preset-apply';
import { commitEngineBaseValues } from './engines/engine-param-commit';
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
} from './polysynth/polysynth-presets';
import { wireRandomizeUI } from './core/randomize-ui';
import { wireFxUI, type FxUIDeps } from './core/fx-ui';
import { wireTransport, setPlaying, type TransportDeps } from './core/transport';
import { confirmDialog, alertDialog } from './core/dialog';
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
import { loadLibrary } from './patterns/pattern-library';
import { resetAutomationPosition, getAutoAbsSubIdx } from './automation/automation-tick';
import { createDestinationRegistry } from './automation/destination-registry';
import { attachKnobAutomationMenu } from './automation/knob-automation-menu';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from './core/lane-ids';
// ── Live MIDI control (src/control) ─────────────────────────────────────────
import { createActiveLaneStore } from './control/active-lane';
import { wireMidiControl } from './app/midi-control-wiring';
import { createTransportControls } from './app/transport-controls';
import { createAutomationWrites } from './app/automation-writes';
// ── AudioWorklet synthesis loader (live path for all subtractive lanes) ──────
import { loadLoomWorklet } from './audio-worklet/loom-node';
import { loadDrumsWorklet } from './audio-worklet/drums-node';
import { loadSamplerWorklet } from './audio-worklet/sampler-node';
// ── Static chrome templates (version label, meter options, XY panel shell) ──
import { html, render } from 'lit-html';
import { renderElement } from './core/lit-fragment';
// ── Desktop menu bar (chrome) ─────────────────────────────────────────────
import { createMenuBar } from './app/menu-bar';
import { createXyPad } from './performance/xy-pad-ui';
import { buildMenus } from './app/menu-spec';
import type { MenuActions } from './app/menu-actions';
import { registerMenuShortcuts } from './app/menu-shortcuts';

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
// `define` from version.json. Rendered as three styled parts so the version and
// codename read prominently (amber) with the stage kept quiet — see .app-version.
const appVersionEl = document.getElementById('app-version');
if (appVersionEl) {
  appVersionEl.replaceChildren();
  render(html`<span class="av-ver">v${__APP_VERSION__}</span><span class="av-name">${__APP_CODENAME__}</span><span class="av-stage">${__APP_STAGE__}</span>`, appVersionEl);
}

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
// The pattern library (1210 patterns, ~370 KB of JSON). Fire-and-forget: the
// inspector's pattern dropdown fills on the next render, and an empty list is
// a harmless placeholder until it lands.
void loadLibrary(import.meta.env.BASE_URL);

// ── Audio graph ────────────────────────────────────────────────────────────
const audio = createAudioGraph();
// Phase G: audio-graph.ts is now master-only. All per-lane strips, instrument
// instances, and configurators were removed. Lane allocation happens lazily via
// lanes.ensureLaneResource() when applyLoadedSessionState runs.
const { ctx, master, analyser, masterMeterAnalyser, masterStrip, masterInsertChain, fx, masterComp, masterShaper, sidechainBus } = audio;

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
// The single source of "what can be automated right now" (Task 4). sessionHost
// is declared further down (line ~493) — referencing it here is safe because
// getState is only ever CALLED after boot, by which point it's assigned (the
// bpmBroadcast getSessionState getter below does the same forward reference).
const destinations = createDestinationRegistry({
  getState: () => sessionHost.state,
  getKnobRegistry: () => automationRegistry,
});
// Task 11: whenever the destination set changes (an insert added/removed on a
// lane, master, or a send), drop any registry knob for an insert slot that no
// longer exists. This is the surviving leak `pruneKnobRegistry` (lane-based)
// never covered: deleting an insert from a lane that's still there, or from
// the master/send racks, left its knobs in automationRegistry forever.
destinations.subscribe(() => {
  pruneKnobRegistryToDestinations(automationRegistry, new Set(destinations.list().map((t) => t.id)));
});
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
  masterInserts: masterInsertChain,
  onDestinationsChanged: () => destinations.invalidate(),
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

render(
  html`${COMMON_METERS.map((m) => html`<option value=${formatMeter(m)}>${formatMeter(m)}</option>`)}`,
  meterSel,
);
meterSel.value = formatMeter(seq.meter);

// ── Track rendering (with viewport) ────────────────────────────────────────
const LANE_LABELS: Record<TrackId, string> = {
  bass: 'BASS', poly: 'POLY', drumBus: 'DRUM BUS',
  poly1: 'POLY 1', poly2: 'POLY 2', poly3: 'POLY 3', poly4: 'POLY 4',
  poly5: 'POLY 5', poly6: 'POLY 6', poly7: 'POLY 7', poly8: 'POLY 8', poly9: 'POLY 9',
  poly10: 'POLY 10', poly11: 'POLY 11', poly12: 'POLY 12', poly13: 'POLY 13',
  poly14: 'POLY 14', poly15: 'POLY 15', poly16: 'POLY 16',
  kick: 'KICK', snare: 'SNARE', rimshot: 'RIM', closedHat: 'CH HAT', openHat: 'OP HAT',
  clap: 'CLAP', cowbell: 'COWBLL', tom: 'TOM', ride: 'RIDE', crash: 'CRASH',
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
const _lehState = laneHost.state; // kept for the engine-selector wiring (reads _lehState.activeLaneId)

// Holder for historyDeps for discrete selectors. historyDeps is built later
// (it closes over saveWiringDeps / sessionHost), but event handlers fire after
// boot, so assigning _discreteHistoryDeps after construction works correctly.
// Declared HERE (ahead of its first reader) because the deps objects below —
// mixerDeps, the transport controls, the knob mounter — all read it through a
// getter; an uninitialised `let` has no side effect, so its position only
// decides who may name it, never what anyone sees.
let _discreteHistoryDeps: HistoryDeps | undefined;

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

// ── Transport row inputs (BPM / swing / volume / meter) ────────────────────
// Runs HERE and not a line later: the factory body carries the two boot-time
// side effects that used to sit inline — the initial `bpmBroadcast.broadcast`
// (tempo out to every insert chain and engine) and the initial master gain read
// off #volume. Both must land before any lane can sound.
const transportControls = createTransportControls({
  seq, ctx, master, bpmBroadcast,
  bpmInput, swingInput, volInput, meterSel,
  getHistoryDeps: () => _discreteHistoryDeps,
  // Late-bound call-site wrappers: both are assigned/constructed further down
  // in boot and are only read at user-interaction time.
  renderLanes: () => renderLanes(),
  refreshPerformanceView: () => performanceFeature.refreshPerformanceView(),
});
const setTransportBpm = transportControls.setTransportBpm;
const markTrackActive = transportControls.markTrackActive;

// chain/loop/slot/onEnded wired in wireTransport() (see boot section)

// Legacy global wave selector removed — TB-303 wave is a per-lane engine param
// (osc.wave) rendered by TB303Engine.buildParamUI, like every other engine.

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
  // const delegator into the recording feature further down, so this arrow can
  // call it even though it's assigned later (it only fires on a user click).
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
  registerKnob,
  getAutoAbsSubIdx,
  onDestinationsChanged: () => destinations.invalidate(),
  destinations,
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
    // presetName is a prefixed value in the unified dropdown vocabulary
    // (engine: / user: / sampler:). See src/presets/preset-apply.ts.
    const inst = getLaneEngineInstance(laneId);
    if (!inst) return;
    applyPresetToEngine(inst, presetName);
    // The preset moved the engine's base values with no knob onChange firing,
    // so mirror them explicitly — otherwise the recalled sound never reaches a
    // save. Suppressed on the LOAD path, which replays the saved params right
    // after this call (session-host-persistence).
    commitEngineBaseValues(inst, sessionHost.state, laneId);
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

// ── Project Options dialog (File ▸ Project Options: name + key/style) ──────────
const projectOptions = renderProjectOptionsDialog({
  getName: () => sessionHost.state.name ?? 'Untitled',
  setName: (n) => sessionHost.callbacks.onRenameProject?.(n),   // undoable, re-renders
  getMusicality: () => sessionHost.state.musicality ?? DEFAULT_MUSICALITY,
  setMusicality: (next) => {
    const run = () => {
      sessionHost.state.musicality = next;
      sessionHost.renderWithMixer();
      // renderWithMixer() does not fire onStateApplied, so refresh the toolbar
      // chip explicitly (statusChips is declared later in this file, but this
      // closure only runs on user interaction, long after boot completes —
      // same late-binding pattern as the MIDI refresh below).
      statusChips.refreshMusicality();
    };
    if (_discreteHistoryDeps) withUndo(_discreteHistoryDeps, run); else run();
  },
});
// Refresh the dialog whenever a new session is applied (boot demo, demo
// picker, save-load, new-session) so the displayed name/tonality stays in sync.
sessionHost.onStateApplied(() => projectOptions.refresh());

// ── Live MIDI control subsystem ─────────────────────────────────────────────
// Facade → mediator → access seam → UI, plus the toolbar chips, the clip-header
// Rec binding and the LED refresh. It runs HERE, right after sessionHost.init(),
// because it wraps sessionHost.renderWithMixer and registers an onStateApplied
// callback — both order-sensitive. activeLaneStore stays in this file because
// SessionHost's deps object (built above) mirrors activeEditLane into it from
// onActiveLaneChanged, so the store has to exist before that object does.
const { statusChips, midiControlDialog } = wireMidiControl({
  ctx,
  sessionHost,
  laneResources,
  seq,
  destinations,
  activeLane: activeLaneStore,
  knobRegistry: automationRegistry,   // `${laneId}.${paramId}` → KnobHandle
  // Late-bound: _discreteHistoryDeps is assigned near the end of boot, but the
  // facade only reads it at user-interaction time.
  getHistoryDeps: () => _discreteHistoryDeps,
  openProjectOptions: () => projectOptions.open(),
});

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

// ── Performance view feature ──────────────────────────────────────────────
// REC button is wired by the Performance feature (legacy automation.wireRecButton
// is no longer attached — the Performance recorder owns REC behaviour now).
// recHooks + onAfterTick are patched into sessionHost.deps after construction
// because the feature needs sessionHost to resolve clip launches.
// Bind the original transport methods BEFORE the patch below, so the song-end
// callback can stop the engine directly without re-entering the patched seq.stop.
const _origStart = seq.start.bind(seq);
const _origStop = seq.stop.bind(seq);

// Extracted (not inlined into createPerformanceFeature's deps) so the SAME
// idiom — wrap registerKnob, then replay over every already-mounted knob — can
// wire a second, independent hook below (Task 4's context menu) without
// duplicating the wrap-and-replay logic or racing performanceFeature's own hook.
const onRegisterKnob = (hook: (k: KnobHandle) => void) => {
  const origRegister = automation.registerKnob.bind(automation);
  automation.registerKnob = (k: KnobHandle) => {
    origRegister(k);
    hook(k);
  };
  for (const k of automationRegistry.values()) hook(k);
};

const performanceFeature = createPerformanceFeature({
  ctx, seq, sessionHost,
  automationRegistry,
  destinations,
  // The full master strip is hidden with the session root in Performance mode;
  // these feed the compact master (VU + #volume-proxy fader) in the perf toolbar.
  masterMeterAnalyser, volInput,
  // Arrangement reached the end (song mode): halt the engine + reset the Play
  // button so the next Play restarts from the top.
  onArrangementEnd: () => { _origStop(); setPlaying(playBtn, false); },
  onRegisterKnob,
  // Late-bound on purpose: the recording feature (which owns the shared REC
  // button) is created further down, so this must stay a closure — the bare
  // value would be a TDZ crash. It only fires from onPlay/toggleTakeRec.
  onRecVisualChanged: () => recording.refreshRecButton(),
});

// Task 4: right-click a knob to jump to (or create) its automation. Uses the
// same registerKnob wrap-and-replay idiom above so knobs mounted during boot
// — before this line runs — still get the menu, not just knobs mounted after.
onRegisterKnob((k) => {
  attachKnobAutomationMenu(k, {
    destinations,
    getMode: () => performanceFeature.getMode(),
    getState: () => sessionHost.state,
    getMeter: () => seq.meter,
    getLaneStates: () => sessionHost.laneStates,
    getArrangement: () => performanceFeature.arrangement,
    openClip: (laneId, clipIdx) => {
      // Same four-call recipe as session-host-callbacks.ts onClipClick:
      // setSelectedClip alone shows nothing.
      sessionHost.inspector.setSelectedClip({ laneId, clipIdx });
      sessionHost.inspector.openInspector();
      document.getElementById('session-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      sessionHost.renderWithMixer();
    },
    addTimelineCurve: (paramId) => performanceFeature.addCurve(paramId),
    onClipEdited: () => sessionHost.inspector.refreshContext(),
    revealTimelineCurve: (paramId) => {
      const row = document.querySelector<HTMLElement>(
        `#performance-view-root [data-param-id="${CSS.escape(paramId)}"]`,
      );
      row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
  });
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

// XY pad — a Kaoss-style controller. Two dropdowns pick automatable params (the
// same destinations an LFO/ADSR targets); dragging the surface drives both live
// through the automation registry. Built lazily on first open; a floating,
// non-modal panel so the params it moves stay visible.
{
  const xyBtn = document.getElementById('xy-open');
  let xyPanel: HTMLElement | null = null;
  let xyPad: ReturnType<typeof createXyPad> | null = null;
  xyBtn?.addEventListener('click', () => {
    if (!xyPanel) {
      const pad = createXyPad({
        destinations,
        registry: automationRegistry,
        // Same target resolution playback automation uses, plus the mirror a
        // mounted knob's onChange performs (applyLiveControlUnmountedWrite, in
        // app/automation-writes.ts): the catalogue offers every destination
        // the session declares, including ones with no mounted knob, so
        // dragging the pad on one of those must land the value AND persist it.
        // Read through a closure, never as a bare reference: `autoWrites` is
        // built ~180 lines below, and this handler only runs on a click.
        applyUnmounted: (p, n, r) => autoWrites.applyLiveControlUnmountedWrite(p, n, r),
      });
      xyPad = pad;
      // Build-once shell; the pad surface itself is an imperative widget
      // interpolated as-is.
      xyPanel = renderElement<HTMLElement>(html`
        <div class="xy-panel">
          <div class="xy-panel-head">
            <span class="xy-title">XY Pad</span>
            <button class="xy-close" title="Close"
              @click=${() => { xyPanel!.classList.remove('open'); xyBtn.classList.remove('on'); }}>✕</button>
          </div>
          ${pad.el}
        </div>`);
      document.body.appendChild(xyPanel);
    }
    const open = xyPanel.classList.toggle('open');
    xyBtn.classList.toggle('on', open);
    if (open) xyPad!.refreshOptions();   // lanes/params may have changed since last open
  });
}

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

// Both engine selectors + the deps bundles that re-mount the editor's knobs
// (see src/app/engine-selector-wiring.ts). Runs HERE because the generic
// selector must be wired after populateAutoParamSelectWrapper is set, and
// because synthEditorDeps has to be assigned at this exact point — the
// showPolyEditorWrapper above reads it lazily and bails while it is null.
const engineSelectors = wireEngineSelectors({
  engineSel, engineSel303,
  initialEngineId: currentEngineId,
  getActiveEngineLaneId: () => _lehState.activeLaneId,
  getLaneEngineId,
  automationRegistry,
  registerKnob,
  // Late-bound call-site wrapper: populateAutoParamSelectWrapper is a `let`
  // populated at boot, so it is read at event-fire time.
  populateAutoParamSelect: () => populateAutoParamSelectWrapper(),
  mountSubtractiveLaneKnobs,
  mountLaneFxPanel,
  getHistoryDeps: () => _discreteHistoryDeps,
  engineSwapDeps,
  onEngineChangeUndoable,
  sessionHost,
  getLaneEngineInstance,
  refreshLaneKnobs,
  laneResources,
  setActiveEngineLane,
});
// wirePolyControls(polySynthPresetsDeps) stays where it is, ~230 lines down.
const polySynthPresetsDeps = engineSelectors.polySynthPresetsDeps;
synthEditorDeps = engineSelectors.synthEditorDeps;

// Phase G: deferred to sessionHost.onStateApplied (lane not allocated at boot).
// mountSubtractiveLaneKnobs(LANE_ID_POLY) — see boot section below.


const fxUIDeps: FxUIDeps = {
  ctx, fx, masterInsertChain, masterComp, masterShaper, getBpm: () => seq.bpm, registerKnob,
  // Late-bound via getter so historyDeps is resolved at event-fire time.
  get historyDeps() { return _discreteHistoryDeps; },
  // Task 28: expose session state so master insert slots are persisted.
  getSessionState: () => sessionHost.state,
  onDestinationsChanged: () => destinations.invalidate(),
};
const { rebuildMasterInserts, rebuildSends, refreshMasterComp, refreshMasterShaper } = wireFxUI(fxUIDeps);
// Task 28: rebuild master insert UI after each session load so the slots
// array reference stays in sync with sessionHost.state.masterInserts.
sessionHost.onStateApplied(rebuildMasterInserts);
// Task 10: rebuild send modules after each session load so insert racks
// reflect the loaded sessionState.sends[i].inserts.
sessionHost.onStateApplied(rebuildSends);
// Pull the master-comp knobs + bypass back into sync after a session load
// (applyLoadedStateV3 has already restored the compressor via masterComp.setState).
sessionHost.onStateApplied(() => { refreshMasterComp(); refreshMasterShaper(); });
// Phase G: deferred to sessionHost.onStateApplied (lane not allocated at boot).
// mountDrumMasterLaneKnobs(LANE_ID_DRUMS) — see boot section below.
// ── Scene export (real-time live-take + offline WAV) ──────────────────────
// Created BEFORE the transport block because the live-take recorder (and the
// unified stopTransport that finalizes it) must already exist when
// wireTransport(transportDeps) below reads transportDeps.onStop.
const recording = createRecordingFeature({
  ctx, seq, playBtn, sessionHost, liveVoices,
  tap: masterComp.output,
  performanceFeature,
});
// One-line delegator so every existing Stop path keeps calling `stopTransport()`
// by name: the SessionHost "⏹ all" arrow above, wireTransport's onStop below,
// the MIDI import's resetSession and the New-session wipe.
const stopTransport = (): void => { recording.stopTransport(); };

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

// ── MIDI import wiring (see src/app/midi-import-wiring.ts) ────────────────
// Everything an import needs, including the two seams that exist only because
// an import bypasses applyLoadedSessionState: the per-lane resource prep and
// the launch-a-scene-by-id entry point. Both are internal to that module.
const { midiImportDialog } = wireMidiImport({
  ctx, master, seq, playBtn, sessionHost, laneResources, ensureLaneResource,
  getLaneEngineInstance, setTransportBpm, flashButton, presetsLoaded,
  resetAutomationPosition, performanceFeature, stopTransport,
});
const aboutDialog = bindAboutDialog();

// ── Unmounted automation writes + the rAF tick (see src/app/automation-writes.ts)
// The ONE place a value finds its target when no knob is mounted: insert-rack
// scope resolution, the playback write, the live write with its engineState
// mirror, and the rAF loop that drives both. Calling it here STARTS that loop,
// so the call must stay at this point in boot.
const autoWrites = createAutomationWrites({
  masterInsertChain, fx, laneResources, sessionHost, seq, ctx,
  automationRegistry, destinations, getLaneEngineInstance,
});

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
// Lifted to a module-level const so BOTH the toolbar picker and the File >
// Open Demo menu (menuActions.listDemos, below) share the SAME list.
const DEMOS = [
  { label: 'Minimal Techno', path: `${import.meta.env.BASE_URL}demos/minimal-techno.json` },
  { label: 'Acid Rain', path: `${import.meta.env.BASE_URL}demos/acid-rain.json` },
  { label: 'Cordillera', path: `${import.meta.env.BASE_URL}demos/cordillera.json` },
  { label: 'Neon Drive', path: `${import.meta.env.BASE_URL}demos/neon-drive.json` },
];
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
      demos: DEMOS,
      applyBpm: setTransportBpm,
      onLoaded: () => autoHistory.markClean(),
    });
  });
}

// New: wipe to a fresh empty session (default 303/drums/sub lanes, no clips).
// Named + exported-shape function so the menu bar can call the SAME function
// the toolbar button calls (no synthetic clicks).
async function newSession(): Promise<void> {
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
}
document.getElementById('new-session')?.addEventListener('click', () => { void newSession(); });

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
  masterShaper,
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
  refreshAll: () => { sessionHost.refreshAfterRestore(); refreshMasterComp(); refreshMasterShaper(); },
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
const stemDialog = wireStemDialog({
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
const saveManager = wireSaveManager(saveWiringDeps);
// Recovery can allocate a subtractive lane synchronously, so gate it on the
// worklet module being registered (same reason as the boot demo above). On a
// fresh boot with no autosave this is a no-op regardless of timing.
void workletReady.then(() => bootRecoveryLoad(saveWiringDeps));

// ── Desktop menu bar (chrome) ──────────────────────────────────────────────
// MenuActions is a plain object literal of ARROW FUNCTIONS (never bare method
// references / `this`-bound class methods): menu-spec.ts pulls some fields out
// as bare references (e.g. `run: a.undo`), so the underlying functions must be
// `this`-free closures for that to keep working correctly.
const menuActions: MenuActions = {
  newSession: () => { void newSession(); },
  openSaveForSave: () => saveManager.openForSave(),
  openSaveForLoad: () => saveManager.openForLoad(),
  openProjectOptions: () => projectOptions.open(),
  listDemos: () => DEMOS,
  loadDemo: (path) => { void loadDemoSession(path, { sessionHost, applyBpm: setTransportBpm, onLoaded: () => autoHistory.markClean() }); },
  openImportMidi: () => midiImportDialog.open(),
  openStems: () => stemDialog.open(),
  undo: () => autoHistory.undo(),
  redo: () => autoHistory.redo(),
  canUndo: () => autoHistory.canUndo(),
  canRedo: () => autoHistory.canRedo(),
  setMode: (m) => performanceFeature.setMode(m),
  getMode: () => performanceFeature.getMode(),
  togglePerfDiagnostics: () => perfDiagnostics.toggle(),
  isPerfOpen: () => perfDiagnostics.isOpen(),
  openMidiController: () => midiControlDialog.open(),
  captureScene: () => sessionHost.captureScene(),
  copyScenesToPerformance: () => performanceFeature.copyFromSession(),
  openManual: () => { window.open('manual/', '_blank', 'noopener'); },
  openAbout: () => aboutDialog.open(),
};
createMenuBar(document.getElementById('menu-bar')!, buildMenus(menuActions));
registerMenuShortcuts(menuActions);

// App always boots in Session mode (see fetchDemoSession call above).
