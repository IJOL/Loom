import { createPerfDiagnostics } from './perf/perf-diagnostics';
import type { PerfVoiceTap } from './perf/perf-sources';
import { bootstrapPlugins } from './app/plugin-bootstrap';
import { listPlugins } from './plugins/registry';
import { createAudioGraph } from './app/audio-graph';
import { createBpmBroadcaster } from './app/bpm-broadcast';
import { createMuteSolo } from './app/mute-solo';
import { createLaneAllocator } from './app/lane-allocator';
import { EXTRA_IDS, ALL_TRACKS, LANE_LABELS, type TrackId } from './app/track-ids';
import { GlobalVoiceCap } from './audio-worklet/global-voice-cap';
import { createAutomationRecorder } from './app/automation-recording';
import { pruneKnobRegistryToDestinations } from './app/knob-registry-prune';
import { createTriggerForLane } from './app/trigger-dispatch';
import { LiveVoiceRegistry } from './app/live-voice-registry';
import { createKnobMounter } from './app/knob-mounting';
import { createLaneHost } from './app/lane-host-wiring';
import { createPerformanceFeature } from './app/performance-feature';
import { createWeaveWiring } from './app/weave-wiring';
import { applyWeaveParamMacros } from './app/weave-param-macros';
import { printScene } from './session/session-runtime';
import type { NoteEvent } from './core/notes';
import { wireLayersRack } from './engines/layers-rack-ui';
import { LAYERS_ENGINE_ID } from './engines/layers-engine';
import { createRecordingFeature } from './app/recording-feature';
import { wireMidiImport } from './app/midi-import-wiring';
import { rebuildEngineParamUI, refreshMelodicEngineOptions } from './engines/engine-selector-ui';
import { wireEngineSelectors } from './app/engine-selector-wiring';
import { getEngine, getEngineParamIds } from './engines/registry';
import { swapLaneEngineFlow, type EngineSwapDeps } from './app/engine-swap';
import { Sequencer } from './core/sequencer';
import { COMMON_METERS, formatMeter } from './core/meter';
import { DRUM_LANES } from './core/drums';
import { ChannelStrip } from './core/fx';
import { type KnobHandle } from './core/knob';
import * as laneTrackHelpers from './core/lane-display';
import { SessionHost } from './session/session-host';
import { DEFAULT_MUSICALITY } from './session/session';
import { renderProjectOptionsDialog } from './session/project-options-dialog';
import { bindAboutDialog } from './app/about-dialog';
import { applyPresetToEngine } from './presets/preset-apply';
import { commitEngineBaseValues } from './engines/engine-param-commit';
import { wireSaveManager, bootRecoveryLoad } from './save/save-wiring';
import { createSaveAndHistory } from './app/save-history-wiring';
import {
  withUndo, isTextEditTarget, type HistoryDeps,
} from './save/history-wiring';
import {
  wireInstrumentPresetControls, refreshInstrumentPresetSelect,
} from './instrument-presets/instrument-preset-select';
import { recordPagePresetForLane } from './instrument-presets/preset-select-state';
import { initRandomize } from './core/randomize-ui';
import { wireFxUI, type FxUIDeps } from './core/fx-ui';
import { wireTransport, setPlaying, type TransportDeps } from './core/transport';
import { createStemsFeature } from './app/stems-feature';
import { wireSessionLifecycle } from './app/session-lifecycle';
import { startVisualizer } from './core/visualizer';
import { loadAllPresets } from './presets/preset-loader';
import { loadPlugins } from './plugin-host/plugin-host';
import { loadPluginDspModules, importPluginDspOnMainThread } from './plugin-host/plugin-dsp';
import { loadDrumKits } from './presets/drum-kits-loader';
import { loadLibrary } from './patterns/pattern-library';
import { resetAutomationPosition, getAutoAbsSubIdx } from './automation/automation-tick';
import { createDestinationRegistry } from './automation/destination-registry';
import { wireKnobAutomationMenu } from './app/knob-menu-wiring';
import { LANE_ID_BASS, LANE_ID_DRUMS } from './core/lane-ids';
// ── Live MIDI control (src/control) ─────────────────────────────────────────
import { createActiveLaneStore } from './control/active-lane';
import { wireMidiControl } from './app/midi-control-wiring';
import { createTransportControls } from './app/transport-controls';
import { createAutomationWrites, type AutomationWrites } from './app/automation-writes';
// ── AudioWorklet synthesis loader (live path for all subtractive lanes) ──────
import { loadLoomWorklet } from './audio-worklet/loom-node';
import { loadDrumsWorklet } from './audio-worklet/drums-node';
import { loadSamplerWorklet } from './audio-worklet/sampler-node';
import { loadDuckWorklet } from './audio-worklet/duck-node';
// ── Static chrome templates (version label, meter options) ─────────────────
import { html, render } from 'lit-html';
// ── Desktop menu bar (chrome) ─────────────────────────────────────────────
import { wireXyPanel } from './app/xy-panel-wiring';
import { wireMenuBar } from './app/menu-wiring';

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb  = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

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

// Runtime plugins: fetched, validated and imported before anything reads the
// engine registry. Everything downstream chains off this promise instead of
// awaiting at module scope, so boot order stays explicit and top-level await
// stays out of the bundle.
const pluginsReady = loadPlugins();

// ── Preset cache ───────────────────────────────────────────────────────────
// Derived from the plugin registry so adding a new synth plugin automatically
// triggers its JSON preset file load (if /public/presets/<id>.json exists).
// Missing JSON files log a warning but never throw.
// A runtime plugin ships its own presets and has already seeded the cache, so
// it is skipped here.
// The legacy 'poly' engineId was merged into 'subtractive' (the polysynth
// host IS the subtractive engine's voice allocator).
const presetsLoaded = pluginsReady.then((report) => loadAllPresets(
  listPlugins('engine').map((p) => p.manifest.id).filter((id) => !report.loaded.includes(id)),
));
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

// The send buses are built with the audio graph, synchronously; delay and reverb
// arrive with the plugins, asynchronously. Seed once they exist. A session load
// rehydrates the sends itself and seedDefaultInserts steps aside for it.
void pluginsReady.then(() => { fx.seedDefaultInserts(ctx); });

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
  loadLoomWorklet(ctx).then(async () => {
    // Strictly after the host module: it is what installs globalThis.Loom inside
    // the worklet, and a plugin dsp.js added before it would find no registry.
    const report = await pluginsReady;
    await loadPluginDspModules(ctx, report.dspUrls);
    await importPluginDspOnMainThread(report.dspUrls);
  }),
  loadDrumsWorklet(ctx),
  loadSamplerWorklet(ctx),
  // The sidechain duck detector: registered up front so arming SIDECHAIN on a lane
  // attaches instantly instead of waiting on a first-use addModule round trip.
  loadDuckWorklet(ctx),
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
  // A closure, not a value: sessionHost is built below, and New/Open replace
  // its state wholesale. LAYERS reads its rack through this when a lane's
  // engine is constructed.
  getLane: (laneId) => sessionHost?.state.lanes.find((l) => l.id === laneId),
});
const { resources: laneResources, extraStrips,
        stripFor, ensureLaneVoice,
        ensureLaneResource, getLaneEngineInstance, swapLaneEngine, releaseLane } = lanes;

const bpmBroadcast = createBpmBroadcaster({
  seq, fx, masterInsertChain,
  laneResources,
  ctx,
  getSessionState: () => sessionHost?.state ?? null,
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

// ── Lane-engine host ──────────────────────────────────────────────────────
const laneHost = createLaneHost({
  getSeq: () => seq,
  getEngineSel: () => engineSel,
  rebuildEngineParamUI,
  getLaneLabels: () => LANE_LABELS as Record<string, string>,
});
const getLaneEngineId     = (laneId: string) => laneHost.getLaneEngineId(laneId);
const setActiveEngineLane = (laneId: string) => laneHost.setActiveEngineLane(laneId);
const _lehState = laneHost.state; // kept for the engine-selector wiring (reads _lehState.instrumentPageLaneId)

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
  fmtPct, fmtDb,
  getSessionState: () => sessionHost?.state,
  getLaneDisplayName: (id) => sessionHost?.state.lanes.find((l) => l.id === id)?.name,
  sidechainBus,
  getHistoryDeps: () => _discreteHistoryDeps,
});
const mountDrumMasterLaneKnobs = knobs.mountDrumMasterLaneKnobs;
const mountLaneFxPanel = knobs.mountLaneFxPanel;
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
  getMusicality: () => sessionHost.state.musicality ?? DEFAULT_MUSICALITY,
  onVoiceFired: (laneId, gateSec) => perfVoiceTap.fn?.(laneId, gateSec),
});

// ── Session host ───────────────────────────────────────────────────────────
// Active-lane store: single source of truth bridged to SessionHost.activeEditLane
// so the UI and the APC stay in sync. Mirrored in onActiveLaneChanged below.
const activeLaneStore = createActiveLaneStore();
// WEAVE's live state, built BEFORE the host so the host can ask it for a gate
// on every tick, and read later by the panel plugin. Neither can own it: the
// host exists before the panel does.
const weaveWiring = createWeaveWiring({
  getLaneStates: () => sessionHost.laneStates,
  getMeter: () => seq.meter,
  // A getter, not the state: New and Open replace the whole object, and a
  // pinned reference would keep weaving the session the user just closed.
  getState: () => sessionHost.state,
});

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
  extraStrips: extraStrips as Partial<Record<string, ChannelStrip>>,
  getLaneEngineId,
  ensureLaneVoice,
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
      mountLaneFxPanel(active);
    }
    // Mirror the active lane into the control store (guarded → no UI↔APC loop).
    activeLaneStore.set(sessionHost.activeEditLane);
  },
  laneResources,
  ensureLaneResource,
  swapLaneEngine,
  releaseLane,
  masterInsertChain,
  fxBus: fx,
  // Master strip in the last mixer column: a full lane-style column — the fader
  // proxies #volume, the VU reads the dedicated master meter tap, and the
  // EQ/pan/mute knobs drive masterStrip (audio-graph.ts).
  volInput,
  masterMeterAnalyser,
  masterStrip,
  // Held only so a New / session load can release them with everything else
  // (session-host-reset.ts). Their persistence stays in the save layer.
  masterComp,
  masterShaper,
  // Asked once per note at schedule time. Returns undefined while every macro
  // sits at its neutral, so a session nobody has woven schedules exactly as it
  // did before this feature existed.
  weaveNotesFor: (laneId) => weaveWiring.notesFor(laneId),
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
    // refreshInstrumentPresetSelect via polyPresetName).
    recordPagePresetForLane(laneId, presetName);
    refreshInstrumentPresetSelect();
    refreshLaneKnobs(laneId, inst);
  },
});
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

// Late-bound: automation-writes (below) is built AFTER performanceFeature, so
// its playback-unmounted write and range table reach performanceFeature only
// as closures over this — see src/app/automation-writes.ts's header comment.
let writes: AutomationWrites | undefined;

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
  // A panel plugin changes a lane's instrument and preset through the SAME
  // doors the lane selectors use — the undoable swap wrapper above and the
  // shared preset path — so it cannot leave a lane in a state the grid would
  // not survive, and its edits undo like any other.
  // One weave state, shared with the host's gate: a knob that moved a copy
  // would change a panel and play nothing.
  weave: weaveWiring.state,
  onWeaveChanged: () => {
    // Two halves, because the six macros reach the sound two different ways.
    // Density and Energy rewrite NOTES, so dropping the cached weave source is
    // all they need — the next tick refolds. Space and Motion write PARAMS, and
    // a param only moves when something writes it.
    weaveWiring.invalidate();
    // On the change, never per tick: a param written sixty times a second with
    // the same value is sixty ramps the smoother chases for nothing.
    applyWeaveParamMacros(weaveWiring.state.macros, {
      destinations: () => destinations.list(),
      // Playback semantics — the value reaches the audio and NOT the lane's
      // saved sound. The macro owns it; the weave's own state is what should
      // persist, and that is a separate slice.
      write: (id, v, ranges) => writes?.applyPlaybackUnmountedWrite(id, v, ranges),
    });
  },
  // The desk's mute/solo, shared by reference: a panel's M and S and the
  // mixer's are the same two buttons, not two that can disagree.
  muteState, soloState, applyMuteSolo,
  // Freeze what the weave is playing right now into a new scene. It asks the
  // SAME source the scheduler plays from, so the printed bar is the bar you
  // were hearing rather than a re-derivation that could disagree with it.
  printWeaveScene: () => withUndo(_discreteHistoryDeps!, () => {
    const notes = new Map<string, NoteEvent[]>();
    for (const lane of sessionHost.state.lanes) {
      const woven = weaveWiring.notesFor(lane.id)?.();
      if (woven?.length) notes.set(lane.id, woven);
    }
    const scene = printScene(sessionHost.state, notes, 'Weave');
    if (!scene) return 0;
    sessionHost.renderWithMixer();
    sessionHost.deps.saveSession?.();
    return notes.size;
  }),
  swapLaneEngine: onEngineChangeUndoable,
  // The host's OWN applyPresetForLane, not a fresh call to applyPresetToEngine:
  // that closure also mirrors the recalled base values into engineState, which
  // is the only vehicle by which a preset reaches a save. Reaching past it
  // would recall a sound that vanished on reload.
  applyLanePreset: (laneId, presetName) =>
    sessionHost.deps.applyPresetForLane?.(laneId, presetName),
  applyUnmounted: (id, n, r) => writes?.applyPlaybackUnmountedWrite(id, n, r),
  getTargetRanges: () => writes?.targetRanges() ?? new Map(),
});

// Right-click a knob → its automation (see src/app/knob-menu-wiring.ts). Runs
// HERE, after createPerformanceFeature: both hooks go through onRegisterKnob's
// wrap-and-replay, and the order they wrap in decides which one sees a
// newly-mounted knob first.
wireKnobAutomationMenu({ onRegisterKnob, destinations, sessionHost, seq, performanceFeature });
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

// The XY pad panel (see src/app/xy-panel-wiring.ts). Everything it owns is built
// on first open, so the only boot-time effect is one click listener; the write
// path is a closure because `writes` is built ~180 lines below.
wireXyPanel({
  destinations,
  automationRegistry,
  applyUnmounted: (p, n, r) => writes?.applyLiveControlUnmountedWrite(p, n, r),
});

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

// Both engine selectors + the deps bundle that re-mounts the editor's knobs
// (see src/app/engine-selector-wiring.ts). Runs HERE because the generic
// selector must be wired after populateAutoParamSelectWrapper is set.
const engineSelectors = wireEngineSelectors({
  engineSel,
  initialEngineId: currentEngineId,
  getActiveEngineLaneId: () => _lehState.instrumentPageLaneId,
  getLaneEngineId,
  automationRegistry,
  registerKnob,
  // Late-bound call-site wrapper: populateAutoParamSelectWrapper is a `let`
  // populated at boot, so it is read at event-fire time.
  populateAutoParamSelect: () => populateAutoParamSelectWrapper(),
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
// wireInstrumentPresetControls(instrumentPresetDeps) stays where it is, ~230 lines down.
const instrumentPresetDeps = engineSelectors.instrumentPresetDeps;

// Changing which instrument sits in a LAYERS slot REBUILDS the lane's engine.
// That is not caution — the worklet numbers a lane's params once and keeps that
// numbering for its lifetime, and a new instrument in a slot brings a new set of
// them. It is the same rebuild a plain engine swap already performs.
wireLayersRack({
  setRack: (laneId, layers) => {
    const lane = sessionHost.state.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    lane.engineState = { ...lane.engineState, layers };
    swapLaneEngine(laneId, LAYERS_ENGINE_ID);
    // Repaint through the ONE door: focusLane owns which lane the instrument
    // page shows, and reaching past it to showLaneEditor is what once left the
    // clip editor and the knobs pointing at two different lanes.
    sessionHost.focusLane(laneId);
    // Autosave through the host's own hook, the same one an insert edit uses —
    // the save-manager's buttons are the manual route and mean something else.
    sessionHost.deps.saveSession?.();
  },
  // Opening another tab, or recalling a preset into a layer, changes only what
  // is DRAWN. Repaint through the one door rather than rebuilding the lane.
  repaint: (laneId) => sessionHost.focusLane(laneId),
});

// The two engine selectors were just painted from the registry as it stands
// RIGHT NOW — which is before loadPlugins() has resolved, so it holds only the
// built-ins. Repaint once the runtime plugins have registered, or a dropped-in
// engine loads, registers and synthesises while staying unpickable: the drop-in
// promise failing at the last inch. Preserves each select's current value.
void pluginsReady.then(() => {
  refreshMelodicEngineOptions(engineSel, engineSel.value);
  // Same reason, same moment: a PANEL plugin's tab and root are built from the
  // panel registry, which is likewise empty until now. Wired here rather than
  // inside createPerformanceFeature, which runs long before this resolves.
  performanceFeature.mountPanels();
});

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
wireInstrumentPresetControls(instrumentPresetDeps);

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
writes = createAutomationWrites({
  masterInsertChain, fx, laneResources, sessionHost, seq, ctx,
  automationRegistry, destinations, getLaneEngineInstance,
});

// Phase G: boot-eager UI deferred until applyLoadedSessionState allocates lanes.
// Registers callbacks BEFORE the demo load so they fire on the first apply.
sessionHost.onStateApplied(() => {
  // Drum master knobs
  mountDrumMasterLaneKnobs(LANE_ID_DRUMS);
});

// Where a session comes FROM (see src/app/session-lifecycle.ts): the boot demo
// behind the presets+worklet gate, the shared demo list, the picker behind the
// worklet gate, and the New wipe. It runs HERE, after the onStateApplied
// registrations above, so those fire on the demo's first apply. `markClean` is a
// thunk because AutoHistory is only built further down.
const { demos: DEMOS, newSession } = wireSessionLifecycle({
  sessionHost, presetsLoaded, workletReady, setTransportBpm,
  markClean: () => autoHistory.markClean(),
  performanceFeature, stopTransport,
});

// App is always in session mode — seq.sessionMode must be true at boot.
seq.sessionMode = true;
startVisualizer({ ctx, analyser, vizCanvas });

// ── Save Manager v2 (see src/save-wiring.ts) ──────────────────────────────
const { autoHistory, historyDeps, saveWiringDeps } = createSaveAndHistory({
  ctx, seq, lanes, master,
  volInput, bpmInput, swingInput, meterSel,
  sessionHost,
  // A thunk, not the value: `renderLanes` is a `let` whose comment above promises
  // it is assigned during boot. Snapshotting it here would freeze whatever it held
  // at this line, while transport-controls (which takes the same binding) reads it
  // lazily — so an assignment would reach one caller and not the other. Same shape
  // in both places means the question cannot come up.
  renderLanes: () => renderLanes(),
  fx,
  masterInsertChain,
  masterStrip,
  masterComp,
  masterShaper,
  flashButton,
  getPerformanceFeature: () => performanceFeature,
  refreshMasterComp,
  refreshMasterShaper,
  // The ONE weave: the same object the panel edits and the scheduler reads, so a
  // save records what is actually playing.
  weave: weaveWiring,
});
// Stem separation + transcription (see src/app/stems-feature.ts). Installs the
// clip header's transcribe-this-loop seam as it is built, which is why the call
// sits here and not with the rest of the dialogs.
const { stemDialog } = createStemsFeature({ ctx, seq, sessionHost, setTransportBpm });
// Activate undo for discrete selectors (kit, wave, engine, preset) now that
// historyDeps is ready.
_discreteHistoryDeps = historyDeps;
// wireRandomizeUI is here (not at its original boot position) because it needs
// historyDeps, which closes over saveWiringDeps, which closes over sessionHost.
// The dice asks the ENGINE to roll its own declared params, so it works for
// every worklet engine instead of only the one class that no longer exists.
initRandomize({
  getEngine: (laneId) => laneResources.get(laneId)?.engine ?? null,
  getSessionState: () => sessionHost?.state,
  refreshLaneKnobs,
  historyDeps,
});
const saveManager = wireSaveManager(saveWiringDeps);
// Recovery can allocate a subtractive lane synchronously, so gate it on the
// worklet module being registered (same reason as the boot demo above). On a
// fresh boot with no autosave this is a no-op regardless of timing.
void workletReady.then(() => bootRecoveryLoad(saveWiringDeps));

// ── Desktop menu bar (chrome) — see src/app/menu-wiring.ts ─────────────────
// LAST statement of boot on purpose: the MenuActions table names a handle from
// nearly every feature above, and the bar reaching the DOM is the only proof
// that this module ran start to finish.
wireMenuBar({
  sessionHost, saveManager, projectOptions, autoHistory, performanceFeature,
  perfDiagnostics, midiImportDialog, midiControlDialog, stemDialog, aboutDialog,
  demos: DEMOS, newSession, setTransportBpm,
});

// App always boots in Session mode (see fetchDemoSession call above).
