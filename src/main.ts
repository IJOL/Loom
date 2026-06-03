import { bootstrapPlugins } from './app/plugin-bootstrap';
import { listPlugins } from './plugins/registry';
import { createAudioGraph } from './app/audio-graph';
import { createBpmBroadcaster } from './app/bpm-broadcast';
import { createMuteSolo } from './app/mute-solo';
import { createLaneAllocator } from './app/lane-allocator';
import { createAutomationRecorder } from './app/automation-recording';
import { createTriggerForLane } from './app/trigger-dispatch';
import { createKnobMounter } from './app/knob-mounting';
import { createLaneHost } from './app/lane-host-wiring';
import { createPerformanceFeature } from './app/performance-feature';
import {
  wireEngineSelector, wireEngineSelector303, rebuildEngineParamUI,
  type EngineSelectorUIDeps,
} from './engines/engine-selector-ui';
import { getEngine, getEngineParamIds } from './engines/registry';
import { swapLaneEngineFlow, type EngineSwapDeps } from './app/engine-swap';
import { type TB303 } from './core/synth';
import { Sequencer } from './core/sequencer';
import { DRUM_LANES, type DrumMachine, type DrumVoice } from './core/drums';
import { ChannelStrip } from './core/fx';
import { type KnobHandle } from './core/knob';
import { PolySynth } from './polysynth/polysynth';
import { stepsToNotes, bassStepsToNotes } from './core/notes';
import * as laneTrackHelpers from './core/lane-display';
import { SessionHost } from './session/session-host';
import { fetchDemoSession } from './demo/demo-loader';
import { wireDemoPicker } from './demo/demo-picker';
import { wireMidiImportUI } from './midi/midi-import-ui';
import { launchScene as launchSceneRuntime } from './session/session-runtime';
import { applyPresetToEngine } from './presets/preset-apply';
import { wireSaveManager, bootRecoveryLoad } from './save/save-wiring';
import { createHistory } from './core/history';
import {
  wireHistoryKeyboard, withUndo, type HistoryDeps,
} from './save/history-wiring';
import {
  buildSavedStateV3, applyLoadedStateV3, type SavedStateV3, type SavedStateV3Deps,
} from './save/saved-state-v3';
import {
  wirePolyControls, refreshPolyPresetSelect, recordPagePresetForLane,
  type PolySynthPresetsDeps,
} from './polysynth/polysynth-presets';
import { wireRandomizeUI } from './core/randomize-ui';
import { wireFxUI, applyDelaySync as fxApplyDelaySync, type FxUIDeps } from './core/fx-ui';
import { wireTransport, type TransportDeps } from './core/transport';
import {
  showPolyEditor,
  synthEditorState,
} from './session/synth-editor-routing';
import { startVisualizer } from './core/visualizer';
import { loadAllPresets } from './presets/preset-loader';
import {
  startAutomationTick, resetAutomationPosition, getAutoAbsSubIdx,
  type AutomationTickDeps,
} from './automation/automation-tick';
import { getActiveModVoice } from './modulation/active-mods';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from './core/lane-ids';

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

// ── Audio graph ────────────────────────────────────────────────────────────
const audio = createAudioGraph();
// Phase G: audio-graph.ts is now master-only. All per-lane strips, instrument
// instances, and configurators were removed. Lane allocation happens lazily via
// lanes.ensureLaneResource() when applyLoadedSessionState runs.
const { ctx, master, analyser, masterInsertChain, fx, masterComp, sidechainBus } = audio;

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
const lanes = createLaneAllocator({
  ctx, master, fx, sidechainBus,
  getBpm: () => seq.bpm,
  extraIds: EXTRA_IDS,
});
const { resources: laneResources, extraStrips, extraPolys,
        stripFor, ensureExtraPoly, ensureLaneVoice,
        ensureLaneResource, getLaneEngineInstance, swapLaneEngine } = lanes;

// Phase G: lazy accessors — null before applyLoadedSessionState allocates lanes.
const getSynthInstance = (): TB303 | null => {
  const eng = laneResources.get(LANE_ID_BASS)?.engine as unknown as { getInstance?(): TB303 | null } | undefined;
  return eng?.getInstance?.() ?? null;
};
const getDrumsInstance = (): DrumMachine | null => {
  const eng = laneResources.get(LANE_ID_DRUMS)?.engine as unknown as { getInstance?(): DrumMachine | null } | undefined;
  return eng?.getInstance?.() ?? null;
};

// Phase G: polysynth comes from lane resources lazily; null before boot session loads.
const bpmBroadcast = createBpmBroadcaster({
  seq, fx, masterInsertChain,
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
const bpmInput = $<HTMLInputElement>('bpm');
const swingInput = $<HTMLInputElement>('swing');
const volInput = $<HTMLInputElement>('volume');
const barsSel  = $<HTMLSelectElement>('bars');
const scaleSel = $<HTMLSelectElement>('scale');
const rootSel  = $<HTMLSelectElement>('root');
const vizCanvas    = $<HTMLCanvasElement>('viz');
const engineSel    = $<HTMLSelectElement>('engine-select');
const engineSel303 = $<HTMLSelectElement>('engine-select-303');

// ── Populate selects ───────────────────────────────────────────────────────
// Drum kit selector removed: presets dropdown (drums-machine.json) covers
// all 5 kits via the kitId param. Use Load preset to switch kit.

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const midiLabel = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

for (let m = 24; m <= 48; m++) {
  const opt = document.createElement('option');
  opt.value = String(m);
  opt.textContent = midiLabel(m);
  if (m === 36) opt.selected = true;
  rootSel.appendChild(opt);
}

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
  // Late-bound via getter: _discreteHistoryDeps is assigned after historyDeps
  // is built (further below), but mixer columns are built at user-interaction
  // time so the getter always sees the final value.
  get historyDeps() { return _discreteHistoryDeps; },
};

bpmInput.addEventListener('input', () => {
  const v = parseInt(bpmInput.value, 10);
  if (!isNaN(v)) bpmBroadcast.broadcast(Math.max(40, Math.min(240, v)));
});
bpmBroadcast.broadcast(seq.bpm);

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

volInput.addEventListener('input', () => { master.gain.value = parseFloat(volInput.value); });
master.gain.value = parseFloat(volInput.value);

// ── Gesture brackets for continuous inputs (BPM / swing / volume) ──────────
// One drag or keyboard-edit = one undo entry. pointerdown/focus opens the
// gesture; pointerup/blur closes it. The existing 'input' handlers above keep
// driving live audio and must NOT call beginGesture/commitGesture themselves.
for (const el of [bpmInput, swingInput, volInput]) {
  el.addEventListener('pointerdown', () => {
    if (_discreteHistoryDeps) _discreteHistoryDeps.history.beginGesture(_discreteHistoryDeps.snapshot());
  });
  el.addEventListener('pointerup', () => {
    if (_discreteHistoryDeps) _discreteHistoryDeps.history.commitGesture();
  });
  el.addEventListener('focus', () => {
    if (_discreteHistoryDeps) _discreteHistoryDeps.history.beginGesture(_discreteHistoryDeps.snapshot());
  });
  el.addEventListener('blur', () => {
    if (_discreteHistoryDeps) _discreteHistoryDeps.history.commitGesture();
  });
}

// Holder for historyDeps for discrete selectors. historyDeps is built later
// (it closes over saveWiringDeps / sessionHost), but event handlers fire after
// boot, so assigning _discreteHistoryDeps after construction works correctly.
let _discreteHistoryDeps: HistoryDeps | undefined;

// Legacy global wave selector removed — TB-303 wave is a per-lane engine param
// (osc.wave) rendered by TB303Engine.buildParamUI, like every other engine.

barsSel.addEventListener('change', () => {
  seq.setLength(parseInt(barsSel.value, 10));
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

// Single-entry-point trigger dispatch — delegates by engine.id.
// Phase G: drums removed from deps (drums-machine triggers via res.engine.createVoice).
const triggerForLane = createTriggerForLane({
  ctx, laneResources, seq,
});

// ── Session host ───────────────────────────────────────────────────────────
// synthEditorDeps is constructed later (after polySynthUIDeps + polySynthPresetsDeps
// exist). showPolyEditorWrapper reads it lazily at call time.
let synthEditorDeps: import('./session/synth-editor-routing').SetActivePolyTargetDeps | null = null;
const showPolyEditorWrapper = (laneId: string, target: PolySynth, displayName: string) => {
  if (!synthEditorDeps) return;
  showPolyEditor(laneId, target, displayName, synthEditorDeps);
};
const sessionHost = new SessionHost({
  ctx, seq, playBtn,
  resetAutomationPosition,
  triggerForLane,
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
  },
  laneResources,
  ensureLaneResource,
  swapLaneEngine,
  masterInsertChain,
  fxBus: fx,
  scaleSel,
  rootSel,
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
const performanceFeature = createPerformanceFeature({
  ctx, seq, sessionHost,
  automationRegistry,
  onRegisterKnob: (hook) => {
    const origRegister = automation.registerKnob.bind(automation);
    automation.registerKnob = (k: KnobHandle) => {
      origRegister(k);
      hook(k);
    };
    for (const k of automationRegistry.values()) hook(k);
  },
  recBtn,
});
(sessionHost.deps as { recHooks?: import('./session/session-runtime').RecHooks }).recHooks =
  performanceFeature.recHooks;
(sessionHost.deps as { onAfterTick?: (n: number, l: number) => void }).onAfterTick =
  performanceFeature.onLookahead;

const _origStart = seq.start.bind(seq);
const _origStop = seq.stop.bind(seq);
seq.start = () => { if (!performanceFeature.onPlay()) _origStart(); };
seq.stop = () => { if (!performanceFeature.onStop()) _origStop(); };

barsSel.value = String(seq.length);

// ── Deps objects for extracted UI modules ─────────────────────────────────
function activeEnginePrefix(): string | null {
  const laneId = sessionHost.activeEditLane;
  if (!laneId) return null;
  const lane = sessionHost.state.lanes.find((l) => l.id === laneId);
  if (!lane) return null;
  // Param IDs are prefixed by engine/lane: 'tb303.cutoff', 'main.cutoff',
  // 'poly1.cutoff'... 'fx.reverb' and 'mix.bass' are master-level and never
  // filtered out — but we restrict to the engine's prefix where it's clear.
  if (lane.engineId === 'tb303') return 'tb303';
  if (lane.engineId === 'drums-machine') return null;  // Drums has no per-param automation yet — show all
  // Poly engines: param prefix is the lane id itself ('main', 'poly1', etc.)
  return laneId;
}

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
const { rebuildMasterInserts } = wireFxUI(fxUIDeps);
// Task 28: rebuild master insert UI after each session load so the slots
// array reference stays in sync with sessionHost.state.masterInserts.
sessionHost.onStateApplied(rebuildMasterInserts);
// Phase G: deferred to sessionHost.onStateApplied (lane not allocated at boot).
// mountDrumMasterLaneKnobs(LANE_ID_DRUMS) — see boot section below.
fxApplyDelaySync(fxUIDeps);
const transportDeps: TransportDeps = {
  seq, ctx, playBtn,
  resetAutomationPosition,
};
wireTransport(transportDeps);
{
  const positionEl = document.getElementById('transport-position');
  const timeEl     = document.getElementById('transport-time');
  if (positionEl && timeEl) {
    void import('./core/transport-display').then(({ wireTransportDisplay }) => {
      wireTransportDisplay({ seq, ctx, positionEl, timeEl });
    });
  }
}
wirePolyControls(polySynthPresetsDeps);

// ── MIDI import wiring (see src/midi/midi-import-ui.ts) ───────────────────
// Launches a scene by id from outside the session host. Mirrors the host's
// internal onLaunchScene handler: resume context, run launchScene runtime,
// apply per-lane presets, ensure transport is running, re-render.
function launchSceneById(sceneId: string): void {
  const idx = sessionHost.state.scenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) return;
  const scene = sessionHost.state.scenes[idx];
  void ctx.resume();
  // Ensure resources exist for any freshly-imported lanes BEFORE launch — the
  // host's normal path runs this in applyLoadedSessionState; importer-added
  // lanes bypass that, so do it here. Apply each lane's preset once, when its
  // resource is first allocated, so imported tracks play their matched GM
  // preset. Launching a scene never re-applies a preset to an already-allocated
  // lane — the sound is a per-channel property.
  for (const lane of sessionHost.state.lanes) {
    const isNew = !laneResources.get(lane.id);
    ensureLaneResource(lane.id, lane.engineId);
    if (isNew && lane.enginePresetName) {
      const inst = getLaneEngineInstance(lane.id);
      if (inst) applyPresetToEngine(inst, lane.enginePresetName);
    }
  }
  launchSceneRuntime(sessionHost.laneStates, sessionHost.state, scene, idx, ctx.currentTime, seq.bpm);
  if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.textContent = '■'; }
  sessionHost.renderWithMixer();
}

wireMidiImportUI({
  session: sessionHost.state,
  setBpm: (bpm: number) => {
    const clamped = Math.max(40, Math.min(240, Math.round(bpm)));
    bpmBroadcast.broadcast(clamped);
    bpmInput.value = String(clamped);
  },
  drumLaneId: LANE_ID_DRUMS,
  audioContext: ctx,
  auditionOutput: master,
  onSessionChanged: () => sessionHost.renderWithMixer(),
  launchScene: (sceneId: string) => launchSceneById(sceneId),
  flashButton,
});

const automationTickDeps: AutomationTickDeps = {
  seq,
  automationRegistry,
  getLaneStates: () => sessionHost.laneStates,
  ctx,
  getEngineForLane: (laneId) => laneResources.get(laneId)?.engine ?? undefined,
  getActiveModVoice: (laneId, modId) => getActiveModVoice(laneId, modId),
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
presetsLoaded
  .then(() => fetchDemoSession('/demos/minimal-techno.json'))
  .then((state) => {
    sessionHost.applyLoadedSessionState(state);
    history.clear();
  })
  .catch((err: unknown) => {
    console.error('Demo load failed; falling back to empty session.', err);
  });

// Demo picker: lets the user swap in any baked demo session (the auto-loaded
// minimal-techno above remains the safe default). The MIDI-baked demos
// (sweet-dreams, mgmt-kids, etc.) are produced by scripts/bake-midi-demo.mjs;
// if they aren't baked yet, selecting one will 404 and the picker surfaces an
// alert via its catch block.
const demoPicker = document.getElementById('demo-picker') as HTMLSelectElement | null;
if (demoPicker) {
  wireDemoPicker({
    sessionHost,
    selectEl: demoPicker,
    demos: [
      { label: 'Minimal Techno',            path: '/demos/minimal-techno.json' },
      { label: 'Sweet Dreams',              path: '/demos/sweet-dreams.json' },
      { label: 'MGMT — Kids',               path: '/demos/mgmt-kids.json' },
      { label: 'Solid Sessions — Janeiro',  path: '/demos/solid-sessions-janeiro.json' },
      { label: 'Untitled MIDI',             path: '/demos/untitled.json' },
    ],
    onLoaded: () => history.clear(),
  });
}
// App is always in session mode — seq.sessionMode must be true at boot.
seq.sessionMode = true;
startVisualizer({ ctx, analyser, vizCanvas });

// ── Save Manager v2 (see src/save-wiring.ts) ──────────────────────────────
const history = createHistory<SavedStateV3>({ maxSize: 100 });
// Phase G: synth/drums replaced by lanes (resolved lazily inside buildSavedStateV3).
const saveBaseDeps = {
  ctx, seq, lanes, master,
  volInput, bpmInput, swingInput,
  sessionHost,
  refreshKnobsFromSynth,
  renderLanes,
  fx,
  masterInsertChain,
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
};
// History (undo/redo) snapshots session state only — no perf accessors, so a
// recorded take is never wiped by undoing an unrelated session edit.
const savedStateDeps: SavedStateV3Deps = saveBaseDeps;
const historyDeps: HistoryDeps = {
  history,
  snapshot: () => buildSavedStateV3(savedStateDeps),
  restore: (s) => applyLoadedStateV3(s, savedStateDeps),
};
wireHistoryKeyboard(historyDeps);
// Wire historyDeps into the session inspector so drum-grid cell clicks are
// undoable. Must happen after historyDeps is built (it closes over sessionHost
// via savedStateDeps → saveWiringDeps).
sessionHost.setHistoryDeps(historyDeps);
// Activate undo for discrete selectors (kit, wave, engine, preset) now that
// historyDeps is ready.
_discreteHistoryDeps = historyDeps;
// wireRandomizeUI is here (not at its original boot position) because it needs
// historyDeps, which closes over saveWiringDeps, which closes over sessionHost.
wireRandomizeUI({
  // Phase G: synth/drums resolved lazily from lane resources.
  getSynth: getSynthInstance,
  getDrums: getDrumsInstance,
  getBassLaneId: () => LANE_ID_BASS,
  getDrumsLaneId: () => LANE_ID_DRUMS,
  refreshKnobsFromSynth,
  historyDeps,
});
wireSaveManager(saveWiringDeps);
bootRecoveryLoad(saveWiringDeps);

// App always boots in Session mode (see fetchDemoSession call above).
