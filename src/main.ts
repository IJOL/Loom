import {
  wireEngineSelector, rebuildEngineParamUI,
  type EngineSelectorUIDeps,
} from './engines/engine-selector-ui';
import type { SynthEngine } from './engines/engine-types';
import * as leh from './engines/lane-engine-host';
import type { LaneEngineHostState, LaneEngineHostDeps } from './engines/lane-engine-host';
import { getEngine } from './engines/registry';
import './engines/subtractive';
import './engines/wavetable';
import './engines/fm';
import './engines/karplus';
import { configureTB303EngineMainInstance } from './engines/tb303';
import './engines/drums-engine';
import { configureDrumsEngineSharedFx } from './engines/drums-engine';
import { TB303, type Wave } from './core/synth';
import { Sequencer } from './core/sequencer';
import { DrumMachine, DRUM_LANES, type DrumVoice } from './core/drums';
import { clearPattern } from './core/random';
import { FxBus, ChannelStrip, FilterChain } from './core/fx';
import { PatternBank, emptyPattern, AUTOMATION_SUB_RES, MAX_EXTRA_POLY_TRACKS, type PolyTrack, type AutomationLane } from './core/pattern';
import { createKnob, type KnobHandle } from './core/knob';
import { PolySynth } from './polysynth/polysynth';
import { scheduleArpForNote } from './arp/arp';
import { stepsToNotes, bassStepsToNotes } from './core/notes';
import { buildMixerColumn } from './core/mixer';
import { SessionHost } from './session/session-host';
import { importClassicToSession } from './session/session-migration';
import { applyMinimalTechnoDemo, wireDemoMinimalTechno } from './demo/demo-minimal-techno';
import { setupInitialPattern, type InitialPatternDeps } from './demo/initial-pattern';
import { wireMidiImport } from './midi/midi-import';
import { wireSaveManager, bootRecoveryLoad } from './save/save-wiring';
import {
  buildPolySynthUI, addPolyKnob, addPolySelect, refreshPolyKnobsFromState,
  WAVE_OPTS, type PolySynthUIDeps,
} from './polysynth/polysynth-ui';
import {
  wirePolyControls, wirePolyMode, applyPolyParams, applyPresetByName,
  populatePolyPresetSelect, refreshPolyPresetSelect, polyPresetName,
  type PolySynthPresetsDeps, type PolyModeDeps,
} from './polysynth/polysynth-presets';
import { arp, buildArpUI, type ArpUIDeps } from './arp/arp-ui';
import {
  wireAutomationTab, renderLanes as renderLanesFromUI, redrawAllLanes,
  populateAutoParamSelect, type AutomationUIDeps,
} from './automation/automation-ui';
import { clamp01 } from './automation/automation-painter';
import { wireCopyNotesPanel } from './copy/lane-copy';
import { wireSlotCopyPanel } from './copy/slot-copy';
import { wireRandomizeUI } from './core/randomize-ui';
import { wireFxUI, applyDelaySync as fxApplyDelaySync, type FxUIDeps } from './core/fx-ui';
import {
  wireTransport, switchSlot, updateSlotButtons, isChainEnabled, refreshLoopBtn,
  type TransportDeps,
} from './core/transport';
import {
  classicState,
  type ClassicDeps,
} from './classic/classic-state';
import {
  rebuildTracks as classicRebuildTracks,
  wireClassicUI,
  updatePager as classicUpdatePager,
  visibleRange as classicVisibleRange,
} from './classic/classic-tracks';
import { refreshAllCellsFromState as classicRefreshAllCells } from './classic/drum-cells';
import { rebuildPolyTrack as classicRebuildPolyTrack } from './classic/poly-track-area';
import {
  rebuildSynthTabs as classicRebuildSynthTabs,
  setCurrentSynthLane as classicSetCurrentSynthLane,
} from './classic/synth-tabs';
import { rebuildRollsView as classicRebuildRollsView, rollsRollEntries } from './classic/rolls-view';
import { setActivePolyTarget as classicSetActivePolyTarget } from './classic/poly-target';
import { autoScrollRoll } from './classic/piano-roll-helper';
import { startVisualizer } from './core/visualizer';
import { wireDrumMasterUI } from './core/drum-master-ui';
import { wirePresetLibrary } from './presets/preset-library-ui';
import {
  startAutomationTick, resetAutomationPosition, getAutoAbsSubIdx,
  type AutomationTickDeps,
} from './automation/automation-tick';

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb  = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
const fmtSec = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
const fmtCents = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}¢`;
const fmtOct = (v: number) => v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`;

type KnobId = 'cutoff' | 'resonance' | 'envMod' | 'decay' | 'accent';
const KNOB_IDS: KnobId[] = ['cutoff', 'resonance', 'envMod', 'decay', 'accent'];
type ExtraId =
  | 'poly1' | 'poly2' | 'poly3' | 'poly4' | 'poly5' | 'poly6' | 'poly7' | 'poly8'
  | 'poly9' | 'poly10' | 'poly11' | 'poly12' | 'poly13' | 'poly14' | 'poly15' | 'poly16';
const EXTRA_IDS: ExtraId[] = [
  'poly1','poly2','poly3','poly4','poly5','poly6','poly7','poly8',
  'poly9','poly10','poly11','poly12','poly13','poly14','poly15','poly16',
];
type TrackId = 'bass' | 'poly' | 'drumBus' | ExtraId | DrumVoice;
const ALL_TRACKS: TrackId[] = ['bass', 'poly', ...EXTRA_IDS, 'drumBus', ...DRUM_LANES];
const VIEW_SIZE = 32;

const $  = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const $$ = <T extends HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

// ── App mode (Classic vs Session) ──────────────────────────────────────────
export type AppMode = 'classic' | 'session';
let appMode: AppMode = 'classic';
function getAppMode(): AppMode { return appMode; }

// ── Audio graph ────────────────────────────────────────────────────────────
const ctx = new AudioContext();
const master = ctx.createGain();
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;
analyser.connect(ctx.destination);
// Stackable master filters live between `master` and `analyser`.
const filterChain = new FilterChain(ctx, master, analyser);

const fx = new FxBus(ctx, master);
configureDrumsEngineSharedFx(fx);
const bassStrip = new ChannelStrip(ctx, master, fx);
const polyStrip = new ChannelStrip(ctx, master, fx);
// All drum voices route through this bus first, so a single level/EQ/sends
// controls the entire drum machine.
const drumBusStrip = new ChannelStrip(ctx, master, fx);
const synth = new TB303(ctx, bassStrip.input);
configureTB303EngineMainInstance(bassStrip.input, synth);
const drums = new DrumMachine(ctx, fx, drumBusStrip.input);
const polysynth = new PolySynth(ctx, polyStrip.input);

// Extra polyphonic voices are created LAZILY — no PolySynth/ChannelStrip is
// instantiated until a track is actually added (via UI, MIDI import, or demo).
const extraStrips: Partial<Record<ExtraId, ChannelStrip>> = {};
const extraPolys: Partial<Record<ExtraId, PolySynth>> = {};

// Generic per-lane strip cache (keyed by full lane id). Used for non-extra-
// poly lanes like bass2, drums2, etc.
const extraLaneStrips = new Map<string, ChannelStrip>();

function ensureExtraPoly(id: ExtraId): PolySynth {
  let p = extraPolys[id];
  if (p) return p;
  const strip = new ChannelStrip(ctx, master, fx);
  p = new PolySynth(ctx, strip.input);
  p.bpm = seq.bpm;
  extraStrips[id] = strip;
  extraPolys[id] = p;
  return p;
}

const stripFor = (t: TrackId | string): ChannelStrip => {
  if (t === 'bass') return bassStrip;
  if (t === 'poly') return polyStrip;
  if (t === 'drumBus') return drumBusStrip;
  if ((EXTRA_IDS as readonly string[]).includes(t as string)) {
    ensureExtraPoly(t as ExtraId); // creates strip lazily if missing
    return extraStrips[t as ExtraId]!;
  }
  // Per-voice drum channel strips (kick/snare/...).
  if (t in drums.channels) {
    const ch = drums.channels[t as DrumVoice];
    if (ch) return ch;
  }
  // Generic extra Session lanes (bass2 / drums2 / poly3 / etc.) — share the
  // same per-lane ChannelStrip cache used by ensureLaneVoice.
  return ensureLaneStrip(t as string);
};

// Tracks that should appear in the mixer / be iterated for save / mute-solo.
// Excludes extra polys whose track hasn't been created yet (lazy lanes).
function activeTracks(): TrackId[] {
  const used = new Set(seq.pattern.extraPolyTracks.map((t) => t.id));
  return ALL_TRACKS.filter((t) => !(EXTRA_IDS as readonly string[]).includes(t) || used.has(t));
}

// Automation param registry — populated as knobs are created throughout the file.
const automationRegistry = new Map<string, KnobHandle>();
let automationRecording = false;
// Set in the boot section once automationDeps is constructed.
let _automationDeps: AutomationUIDeps | null = null;
// Stable call-site wrappers — set in boot section, after automationDeps is built.
let renderLanes: () => void = () => { /* populated at boot */ };
let populateAutoParamSelectWrapper: () => void = () => { /* populated at boot */ };
function registerKnob(k: KnobHandle) {
  if (!k.meta.id) return;
  automationRegistry.set(k.meta.id, k);
  // Wire knob → record bridge. Only user-driven changes during playback +
  // armed REC actually write into a lane.
  k.onValueChanged = (v, fromUser) => {
    if (fromUser && automationRecording && seq.isPlaying()) {
      recordAutomationValue(k.meta.id!, v);
    }
  };
}

function recordAutomationValue(paramId: string, value: number) {
  const entry = automationRegistry.get(paramId);
  if (!entry) return;
  const range = entry.meta.max - entry.meta.min;
  if (range === 0) return;
  const norm = clamp01((value - entry.meta.min) / range);
  let lane = seq.pattern.automation.find((l) => l.paramId === paramId);
  if (!lane) {
    const lengthBars = Math.max(1, seq.length / 16);
    const total = lengthBars * 16 * AUTOMATION_SUB_RES;
    lane = {
      paramId,
      enabled: true,
      stepped: false,
      lengthBars,
      values: Array.from({ length: total }, () => norm),
    };
    seq.pattern.automation.push(lane);
    renderLanes();
  }
  const idx = getAutoAbsSubIdx() % lane.values.length;
  lane.values[idx] = norm;
  // Smooth a 2-sub-step neighborhood so single fast moves still produce a
  // visible curve, not a single spike.
  if (idx > 0) lane.values[idx - 1] = (lane.values[idx - 1] + norm) / 2;
  if (idx + 1 < lane.values.length) lane.values[idx + 1] = (lane.values[idx + 1] + norm) / 2;
}

const seq = new Sequencer(ctx, synth, drums, polysynth, 32);
let currentEngineId = 'subtractive';
const bank = new PatternBank(32);

// State for mute/solo (synced into the strips on every change)
const muteState: Record<TrackId, boolean> = Object.fromEntries(ALL_TRACKS.map((t) => [t, false])) as Record<TrackId, boolean>;
const soloState: Record<TrackId, boolean> = Object.fromEntries(ALL_TRACKS.map((t) => [t, false])) as Record<TrackId, boolean>;

function applyMuteSolo() {
  const tracks = activeTracks();
  const anySolo = tracks.some((t) => soloState[t]);
  for (const t of tracks) {
    const m = anySolo ? !soloState[t] : muteState[t];
    stripFor(t).setMuted(m);
  }
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const playBtn  = $<HTMLButtonElement>('play');
const bpmInput = $<HTMLInputElement>('bpm');
const swingInput = $<HTMLInputElement>('swing');
const volInput = $<HTMLInputElement>('volume');
const barsSel  = $<HTMLSelectElement>('bars');
const kitSel   = $<HTMLSelectElement>('kit-drums');
const waveSel  = $<HTMLSelectElement>('wave');
const scaleSel = $<HTMLSelectElement>('scale');
const rootSel  = $<HTMLSelectElement>('root');
const bassTracksEl = $<HTMLDivElement>('bass-tracks');
const drumTracksEl = $<HTMLDivElement>('drum-tracks');
const polyTracksEl = $<HTMLDivElement>('poly-tracks');
const mixerEl      = $<HTMLDivElement>('mixer');
const vizCanvas    = $<HTMLCanvasElement>('viz');
const engineSel    = $<HTMLSelectElement>('engine-select');

// ── Populate selects ───────────────────────────────────────────────────────
for (const k of drums.listKits()) {
  const opt = document.createElement('option');
  opt.value = k.id;
  opt.textContent = `${k.name} — ${k.description}`;
  if (k.id === drums.kitId) opt.selected = true;
  kitSel.appendChild(opt);
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const midiLabel = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

for (let m = 24; m <= 48; m++) {
  const opt = document.createElement('option');
  opt.value = String(m);
  opt.textContent = midiLabel(m);
  if (m === 36) opt.selected = true;
  rootSel.appendChild(opt);
}

// ── Per-lane engines (Phase 1B) — state lives in lane-engine-host.ts ───────
// Engine selector UI → src/engines/engine-selector-ui.ts (wireEngineSelector)
const _lehState: LaneEngineHostState = leh.createLaneEngineState();
// deps object is built after rebuildEngineParamUI is defined (further below).
// We use a late-bound wrapper so the deps reference is stable even though
// rebuildEngineParamUI and LANE_LABELS are declared after this point.
const _lehDeps: LaneEngineHostDeps = {
  get seq() { return seq; },
  get bank() { return bank; },
  get engineSel() { return engineSel; },
  get rebuildEngineParamUI() { return rebuildEngineParamUI; },
  get laneLabels() { return LANE_LABELS as Record<string, string>; },
  setCurrentEngineId: (id: string) => { currentEngineId = id; },
};

// Stable call-site wrappers (keep existing callsites in main.ts unchanged)
const getLaneEngineId     = (laneId: string) => leh.getLaneEngineId(_lehState, _lehDeps, laneId);
const getLaneEngineInstance = (laneId: string): SynthEngine | null => leh.getLaneEngineInstance(_lehState, laneId);
const ensureLaneEngine    = (laneId: string, engineId: string) => leh.ensureLaneEngine(_lehState, laneId, engineId);
const setActiveEngineLane = (laneId: string) => leh.setActiveEngineLane(_lehState, _lehDeps, laneId);
const syncEngineToPattern = () => leh.syncEngineToPattern(_lehState, _lehDeps);
const setSlotConfigurators = (cbs: Array<(() => void) | null>) => leh.setSlotConfigurators(_lehState, cbs);

// Cache: laneId → engine voice. Mono engines reuse the same voice; poly
// engines get a fresh voice per call but the strip is cached per lane.
const laneVoices = new Map<string, import('./engines/engine-types').Voice>();

function ensureLaneStrip(laneId: string): ChannelStrip {
  // Built-in lanes use their dedicated strips.
  if (laneId === 'bass')  return bassStrip;
  if (laneId === 'drums') return drumBusStrip;
  if (laneId === 'main')  return polyStrip;
  // Existing extra-poly behaviour for poly1..poly16.
  if ((EXTRA_IDS as readonly string[]).includes(laneId)) {
    ensureExtraPoly(laneId as ExtraId);
    return extraStrips[laneId as ExtraId]!;
  }
  // Generic extra lane (e.g. bass2, drums2): create a strip on demand.
  let s = extraLaneStrips.get(laneId);
  if (!s) {
    s = new ChannelStrip(ctx, master, fx);
    extraLaneStrips.set(laneId, s);
  }
  return s;
}

function ensureLaneVoice(laneId: string, engineId: string): import('./engines/engine-types').Voice | null {
  const cached = laneVoices.get(laneId);
  if (cached) return cached;
  const engine = getEngine(engineId);
  if (!engine) return null;
  const strip = ensureLaneStrip(laneId);
  const voice = engine.createVoice(ctx, strip.input);
  laneVoices.set(laneId, voice);
  return voice;
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

// viewStart, bassCells, melodyCells, drumCells, visibleRange, updatePager
// → moved to src/classic/ (classicState + classicRebuildTracks etc.)

// rebuildTracks, renderBassStepGrid, RollEntry, pianoRoll, mainRollEntry,
// bassRollEntry, extraRolls → moved to src/classic/
function rebuildTracks() { classicRebuildTracks(classicDeps); }
function rebuildPolyTrack() { classicRebuildPolyTrack(classicDeps, () => classicUpdatePager(classicDeps)); }
function rebuildSynthTabs() { classicRebuildSynthTabs(classicDeps, rebuildPolyTrack, rebuildMixer); }
function setCurrentSynthLane(laneId: string) { classicSetCurrentSynthLane(laneId, classicDeps, rebuildPolyTrack); }
function setActivePolyTarget(target: PolySynth, labelText: string) { classicSetActivePolyTarget(target, labelText, classicDeps); }
function rebuildRollsView() { classicRebuildRollsView(classicDeps); }
function refreshAllCellsFromState() { classicRefreshAllCells(classicDeps); }

function setBassMode(mode: 'step' | 'piano') {
  if (seq.pattern.bassMode === mode) return;
  // Convert step → piano so the user doesn't lose existing work on first switch.
  if (mode === 'piano' && seq.pattern.bassNotes.length === 0) {
    seq.pattern.bassNotes = bassStepsToNotes(seq.pattern.bass);
  }
  seq.pattern.bassMode = mode;
  rebuildTracks();
  updateBassModeButtons();
}
function updateBassModeButtons() {
  const stepBtn  = document.getElementById('bass-mode-step')  as HTMLButtonElement | null;
  const pianoBtn = document.getElementById('bass-mode-piano') as HTMLButtonElement | null;
  if (!stepBtn || !pianoBtn) return;
  stepBtn.classList.toggle('primary',  seq.pattern.bassMode === 'step');
  pianoBtn.classList.toggle('primary', seq.pattern.bassMode === 'piano');
}

// ── Copy notes between lanes (303 ↔ main poly ↔ extra polys) ──────────────
// Moved to src/core/copy-notes.ts — wired at boot via wireCopyNotesPanel()

function refreshKnobsFromSynth() {
  for (const id of KNOB_IDS) synthKnobs[id]?.setValue(synth.params[id]);
}

// ── Mixer ──────────────────────────────────────────────────────────────────

const mixerDeps: import('./core/mixer').MixerColumnDeps = {
  stripFor: (t) => stripFor(t as TrackId),
  label:    (t) => LANE_LABELS[t as TrackId] ?? t,
  muteState: muteState as unknown as Record<string, boolean>,
  soloState: soloState as unknown as Record<string, boolean>,
  applyMuteSolo,
  registerKnob,
};

function rebuildMixer() {
  mixerEl.innerHTML = '';
  mixerEl.className = 'mixer mixer-classic';
  for (const t of activeTracks()) {
    mixerEl.appendChild(buildMixerColumn(t, mixerDeps));
  }
}

// ── Transport → moved to src/core/transport.ts (wireTransport) ────────────

bpmInput.addEventListener('input', () => {
  const v = parseInt(bpmInput.value, 10);
  if (!isNaN(v)) {
    seq.bpm = Math.max(40, Math.min(240, v));
    fx.setBpmSync(seq.bpm);
    filterChain.updateBpm(seq.bpm);
    polysynth.bpm = seq.bpm;
    for (const id of EXTRA_IDS) { const p = extraPolys[id]; if (p) p.bpm = seq.bpm; }
  }
});
fx.setBpmSync(seq.bpm);
polysynth.bpm = seq.bpm;
for (const id of EXTRA_IDS) { const p = extraPolys[id]; if (p) p.bpm = seq.bpm; }

// Track activity timestamps for visual "triggered" pulse on track headers.
const trackActiveUntil = new Map<string, number>();
function markTrackActive(trackId: string, audioTime: number) {
  const delayMs = Math.max(0, (audioTime - ctx.currentTime) * 1000);
  window.setTimeout(() => {
    trackActiveUntil.set(trackId, performance.now() + 120);
  }, delayMs);
}

// Route extra track triggers to their dedicated polysynth instance + mark activity.
seq.onExtraPolyTrigger = (trackIdx, note, time, gate, accent) => {
  const id = EXTRA_IDS[trackIdx];
  if (!id) return;
  const engineId = getLaneEngineId(id);
  const directTrigger = (n: number, t: number, g: number, a: boolean) => {
    const poly = ensureExtraPoly(id);
    if (engineId === 'subtractive') {
      poly.trigger(n, t, g, a);
    } else {
      const inst = ensureLaneEngine(id, engineId);
      if (inst) {
        const voice = inst.createVoice(ctx, extraStrips[id]!.input);
        voice.trigger(n, t, { gateDuration: g, accent: a });
      } else {
        poly.trigger(n, t, g, a);
      }
    }
  };
  const useArp = arp.enabled && arp.scope.includes(id);
  if (useArp) scheduleArpForNote(directTrigger, arp, seq.bpm, note, time, gate, accent);
  else directTrigger(note, time, gate, accent);
  markTrackActive(id, time);
};

// chain/loop/slot/onEnded wired in wireTransport() (see boot section)

swingInput.addEventListener('input', () => { seq.swing = parseFloat(swingInput.value); });

volInput.addEventListener('input', () => { master.gain.value = parseFloat(volInput.value); });
master.gain.value = parseFloat(volInput.value);

waveSel.addEventListener('change', () => { synth.params.wave = waveSel.value as Wave; });

barsSel.addEventListener('change', () => {
  seq.setLength(parseInt(barsSel.value, 10));
  classicState.viewStart = 0;
  rebuildTracks();
  renderLanes();
});

kitSel.addEventListener('change', () => { drums.setKit(kitSel.value); });

const synthKnobs: Record<KnobId, KnobHandle> = {} as Record<KnobId, KnobHandle>;
const SYNTH_KNOB_DEFS: Array<{ id: KnobId; label: string; default: number; color: string }> = [
  { id: 'cutoff',    label: 'CUTOFF', default: 0.42, color: '#c0392b' },
  { id: 'resonance', label: 'RES',    default: 0.55, color: '#e67e22' },
  { id: 'envMod',    label: 'ENV',    default: 0.5,  color: '#16a085' },
  { id: 'decay',     label: 'DECAY',  default: 0.4,  color: '#2ecc71' },
  { id: 'accent',    label: 'ACCENT', default: 0.6,  color: '#f7d000' },
];
const synthKnobsRow = $<HTMLDivElement>('synth-knobs');
for (const def of SYNTH_KNOB_DEFS) {
  synth.params[def.id] = def.default;
  const k = createKnob({
    id: `tb303.${def.id}`,
    min: 0, max: 1, step: 0.001,
    value: def.default,
    defaultValue: def.default,
    label: def.label,
    color: def.color,
    size: 48,
    format: fmtPct,
    onChange: (v) => { synth.params[def.id] = v; },
  });
  synthKnobsRow.appendChild(k.el);
  synthKnobs[def.id] = k;
  registerKnob(k);
}

// pager/slots/onPatternChange wired in wireTransport() (see boot section)
// Pre-populate the bank's slot 0 with the sequencer's initial pattern (set up below)
// Done after setupInitialPattern.

// ── Randomize / Clear — moved to src/core/randomize-ui.ts ────────────────
// wireRandomizeUI() is called at boot (see boot section below).

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

// ── Visualizer → src/core/visualizer.ts ───────────────────────────────────

// ── Boot ───────────────────────────────────────────────────────────────────
// setupInitialPattern → src/demo/initial-pattern.ts

// ── Tab switching (static tabs only — synth tabs have their own handler) ───
const pages = $$<HTMLElement>('.page');
for (const t of $$<HTMLButtonElement>('button.tab')) {
  if (t.classList.contains('synth-tab') || t.classList.contains('synth-tab-add')) continue;
  t.addEventListener('click', () => {
    const target = t.dataset.tab;
    document.querySelectorAll<HTMLButtonElement>('button.tab').forEach((x) => x.classList.toggle('active', x === t));
    pages.forEach((p) => { p.hidden = p.dataset.page !== target; });
    if (target === 'rolls') rebuildRollsView();
  });
}

// ── PolySynth knobs (target swappable for multi-poly editing) ─────────────
// activePolyTarget lives in classicState.activePolyTarget — set at boot by wireClassicUI.

// buildPolySynthUI is now in polysynth-ui.ts — see boot section for call.

// ── Master FX tab → moved to src/core/fx-ui.ts (wireFxUI) ─────────────────

// ── Automation tab ─────────────────────────────────────────────────────────
// Lane UI (renderLanes, wireAutomationTab, etc.) → automation-ui.ts
// Painter helpers (drawLane, attachLanePainter, snap) → automation-painter.ts

// ensureLaneSize, snapLaneToSteps, populateAutoParamSelect, addLane, removeLane,
// renderLanes, drawLane, attachLanePainter → automation-ui.ts / automation-painter.ts
// Automation tick state + resetAutomationPosition + startAutomationTick
// → src/automation/automation-tick.ts

// redrawAllLanes, clamp01, wireAutomationTab → imported from automation-ui/painter

// ── Cosmic Arpeggiator ─────────────────────────────────────────────────────
// arp singleton exported from arp-ui.ts (imported above)
const midiToFreqLocal = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Direct triggers (used when arp is off OR scope doesn't include the track).
const polyTriggerDirect = (note: number, time: number, gate: number, accent: boolean) => {
  const engineId = getLaneEngineId('main');
  if (engineId === 'subtractive') {
    polysynth.trigger(note, time, gate, accent);
    return;
  }
  const inst = ensureLaneEngine('main', engineId);
  if (!inst) { polysynth.trigger(note, time, gate, accent); return; }
  const voice = inst.createVoice(ctx, polyStrip.input);
  voice.trigger(note, time, { gateDuration: gate, accent });
};
const bassTriggerDirect = (note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) => {
  const voice = ensureLaneVoice('bass', 'tb303');
  if (!voice) {
    synth.trigger({ freq: midiToFreqLocal(note), accent, slide: slidingIn, duration: gate }, time);
    return;
  }
  voice.trigger(note, time, { gateDuration: gate, accent, slide: slidingIn });
};
const bassTriggerForArp = (note: number, time: number, gate: number, accent: boolean) => {
  const voice = ensureLaneVoice('bass', 'tb303');
  if (!voice) {
    synth.trigger({ freq: midiToFreqLocal(note), accent, slide: false, duration: gate }, time);
    return;
  }
  voice.trigger(note, time, { gateDuration: gate, accent, slide: false });
};

seq.onMelodyTrigger = (note, time, gate, accent) => {
  const useArp = arp.enabled && arp.scope.includes('main');
  if (useArp) scheduleArpForNote(polyTriggerDirect, arp, seq.bpm, note, time, gate, accent);
  else polyTriggerDirect(note, time, gate, accent);
  markTrackActive('main', time);
};
seq.onBassTrigger = (note, time, gate, accent, slidingIn) => {
  const useArp = arp.enabled && arp.scope.includes('bass');
  if (useArp) scheduleArpForNote(bassTriggerForArp, arp, seq.bpm, note, time, gate, accent);
  else bassTriggerDirect(note, time, gate, accent, slidingIn);
  markTrackActive('bass', time);
};

// ── Session host ───────────────────────────────────────────────────────────
const sessionHost = new SessionHost({
  ctx, seq, bank, playBtn,
  resetAutomationPosition,
  bassTriggerDirect,
  bassTriggerForArp,
  polyTriggerDirect,
  drums,
  drumLanes: DRUM_LANES,
  markTrackActive,
  ensureExtraPoly: ensureExtraPoly as (id: string) => PolySynth,
  extraStrips: extraStrips as Partial<Record<string, ChannelStrip>>,
  getLaneEngineId,
  ensureLaneEngine,
  ensureLaneVoice,
  setActivePolyTarget,
  setCurrentSynthLane,
  polysynth,
  mixerDeps,
  getAppMode,
  midiLabel,
  automationRegistry,
  getAutoAbsSubIdx,
});
sessionHost.init();

// buildArpUI moved to arp-ui.ts (imported above)

// PolySynth presets (POLY_PRESETS_KEY, loadUserPolyPresets, applyPolyParams,
// populatePolyPresetSelect, wirePolyControls) → polysynth-presets.ts

// ── Drum master controls → src/core/drum-master-ui.ts ─────────────────────

// setPolyMode, updatePolyModeButtons, polyPresetName, applyPresetByName,
// refreshPolyPresetSelect, wirePolyMode → polysynth-presets.ts

// ── Preset library → src/presets/preset-library-ui.ts ─────────────────────

// onStep still fires for bass/drum/melody cell highlighting; the continuous
// automation engine runs separately via rAF (see startAutomationTick).

// ── REC button (arms knob → lane recording) ───────────────────────────────
const recBtn = $<HTMLButtonElement>('rec');
recBtn.addEventListener('click', () => {
  automationRecording = !automationRecording;
  recBtn.classList.toggle('armed', automationRecording);
  recBtn.textContent = automationRecording ? '● REC ON' : '● REC';
});

// ── Demo: Minimal Techno — see src/demo-minimal-techno.ts ─────────────────
// (functions moved to demo-minimal-techno.ts; called via demoDeps below)

// ── Copy bars between slots — moved to src/save/slot-copy.ts ──────────────
// wireSlotCopyPanel() is called at boot (see boot section below).

const initialPatternDeps: InitialPatternDeps = { seq, bank, drums, bassStrip, polyStrip };
setupInitialPattern(initialPatternDeps);
// All 4 slots are populated by setupInitialPattern; seq is already pointing at slot 0.
barsSel.value = String(seq.length);

// ── Deps objects for extracted UI modules ─────────────────────────────────
const polySynthUIDeps: PolySynthUIDeps = {
  getActivePolyTarget: () => classicState.activePolyTarget ?? polysynth,
  registerKnob,
};

const automationDeps: AutomationUIDeps = {
  seq,
  automationRegistry,
  getAutoAbsSubIdx,
  extraIds: EXTRA_IDS,
  laneLabels: LANE_LABELS as Record<string, string>,
};

// Wire stable wrappers now that deps are built.
_automationDeps = automationDeps;
renderLanes = () => renderLanesFromUI(automationDeps);
populateAutoParamSelectWrapper = () => populateAutoParamSelect(automationDeps);

// Engine selector UI (must come after populateAutoParamSelectWrapper is set)
const engineSelectorDeps: EngineSelectorUIDeps = {
  engineSel,
  getActiveLaneId: () => _lehState.activeLaneId,
  getLaneEngineId,
  getLaneEngineInstance,
  ensureLaneEngine,
  setLaneEngineIdInPattern: (laneId, engineId) => leh.setLaneEngineIdInPattern(_lehDeps, laneId, engineId),
  setCurrentEngineId: (id) => { currentEngineId = id; },
  automationRegistry,
  registerKnob,
  populateAutoParamSelect: () => populateAutoParamSelectWrapper(),
};
wireEngineSelector(engineSelectorDeps, currentEngineId);

const polySynthPresetsDeps: PolySynthPresetsDeps = {
  getActivePolyTarget: () => classicState.activePolyTarget ?? polysynth,
  getActiveEngineLaneId: () => _lehState.activeLaneId,
  getLaneEngineId,
  getLaneEngineInstance,
  rebuildEngineParamUI,
};

const polyModeDeps: PolyModeDeps = {
  getSeqPattern: () => seq.pattern,
  stepsToNotes,
  getMelodySteps: () => seq.pattern.melody,
  setPolyPatternMode: (mode) => { seq.pattern.polyMode = mode; },
  rebuildPolyTrack,
  setBassMode,
  updateBassModeButtons,
};

// ── Classic-mode track rendering deps + thin wrappers ─────────────────────
const classicDeps: ClassicDeps = {
  seq,
  bank,
  polysynth,
  extraPolys: extraPolys as Partial<Record<import('./classic/classic-state').ExtraId, PolySynth>>,
  extraStrips: extraStrips as Partial<Record<import('./classic/classic-state').ExtraId, ChannelStrip>>,
  ensureExtraPoly: ensureExtraPoly as (id: import('./classic/classic-state').ExtraId) => PolySynth,
  extraPolyIds: EXTRA_IDS as import('./classic/classic-state').ExtraId[],
  laneLabels: LANE_LABELS as Record<string, string>,
  bassTracksEl,
  drumTracksEl,
  polyTracksEl,
  VIEW_SIZE,
  midiLabel,
  setBassMode,
  refreshPolyKnobsFromState,
  refreshPolyPresetSelect,
  setActiveEngineLane,
  rebuildMixer,
  buildArpUI: (opts) => buildArpUI(opts),
};

buildPolySynthUI(polySynthUIDeps);
buildArpUI({ getExtraPolyTracks: () => seq.pattern.extraPolyTracks });
const fxUIDeps: FxUIDeps = { fx, filterChain, getBpm: () => seq.bpm };
wireFxUI(fxUIDeps);
wireDrumMasterUI({ drumBusStrip, registerKnob, fmtPct, fmtDb });
fxApplyDelaySync(fxUIDeps);
const transportDeps: TransportDeps = {
  seq, bank, ctx, playBtn, barsSel,
  resetAutomationPosition,
  classicState,
  getViewStart: () => classicState.viewStart,
  setViewStart: (v) => { classicState.viewStart = v; },
  VIEW_SIZE,
  rebuildTracks,
  renderLanes,
  updateBassModeButtons,
  syncEngineToPattern,
  rebuildSynthTabs,
  getClassicVisibleRange: () => classicVisibleRange(classicDeps),
};
wireTransport(transportDeps);
wireClassicUI(classicDeps);
rebuildMixer();
wireAutomationTab(automationDeps);
wirePresetLibrary({ seq, refreshAllCellsFromState });
wirePolyControls(polySynthPresetsDeps);
wirePolyMode(polyModeDeps);
wireSlotCopyPanel({
  bank, seq, barsSel,
  getViewStart: () => classicState.viewStart,
  setViewStart: (v) => { classicState.viewStart = v; },
  rebuildTracks,
  renderLanes,
  flashButton,
});
wireCopyNotesPanel({ seq, rebuildTracks });

// ── Demo wiring (deps built here, functions live in demo-minimal-techno.ts) ─
const demoDeps: import('./demo/demo-minimal-techno').DemoDeps = {
  seq, bank, bpmInput, barsSel,
  chainEnabled: () => isChainEnabled(),
  chainBtn: $<HTMLButtonElement>('chain-toggle'),
  setSlotConfigurators,
  getLaneEngineInstance,
  viewStart: { get value() { return classicState.viewStart; }, set value(v) { classicState.viewStart = v; } },
  rebuildTracks,
  updateSlotButtons,
  renderLanes,
  updateBassModeButtons,
  syncEngineToPattern,
  rebuildMixer,
  rebuildSynthTabs,
};
wireDemoMinimalTechno(demoDeps);

// ── MIDI import wiring (see src/midi-import.ts) ───────────────────────────
wireMidiImport({
  seq,
  muteState: muteState as Record<string, boolean>,
  applyMuteSolo,
  refreshLoopBtn,
  rebuildPolyTrack,
  rebuildMixer,
  flashButton,
  ensureExtraPoly: ensureExtraPoly as (id: Parameters<typeof ensureExtraPoly>[0]) => PolySynth,
  applyPresetByName,
});

// ── App mode toggle (Classic vs Session) ──────────────────────────────────
function applyModeVisibility() {
  const tabBar      = document.querySelector<HTMLElement>('.tab-bar');
  const pages       = document.querySelectorAll<HTMLElement>('.page');
  const sessionView = document.getElementById('session-view');
  const backPill    = document.getElementById('back-to-session');
  const mixerPanel  = document.querySelector<HTMLElement>('.mixer-panel');
  const arpPanel    = document.querySelector<HTMLElement>('.arp-panel');
  const copyPanels  = document.querySelectorAll<HTMLElement>('.copy-row, .copy-track-panel, .presets-panel');
  const inClassic   = appMode === 'classic';
  if (tabBar)      tabBar.hidden      = !inClassic;
  for (const p of pages) p.hidden = !inClassic || p.dataset.page !== getActiveClassicTab();
  if (sessionView) sessionView.hidden = inClassic;
  // Hide Classic-only panels in Session: mixer (per-column strips replace it),
  // copy-pattern row, preset library. Keep ARP visible (it works in both modes).
  if (mixerPanel) mixerPanel.hidden = !inClassic;
  for (const p of copyPanels) p.hidden = !inClassic;
  if (arpPanel) arpPanel.hidden = false;
  // Back-pill only makes sense during Edit tab-swap, never on plain mode switch.
  if (backPill) backPill.hidden = true;
  document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === appMode);
  });
  if (!inClassic) sessionHost.renderWithMixer();
}

function setAppMode(next: AppMode) {
  if (next === appMode) return;
  if (seq.isPlaying()) seq.stop();
  appMode = next;
  seq.sessionMode = appMode === 'session';
  applyModeVisibility();
}

// Exposed so the Session "Back to Session" pill (in session-host) can restore
// proper visibility without re-toggling appMode.
(window as unknown as { __reapplyModeVisibility?: () => void }).__reapplyModeVisibility = applyModeVisibility;
function getActiveClassicTab(): string {
  const active = document.querySelector<HTMLButtonElement>('.tab.active');
  return active?.dataset.tab ?? '303';
}
document.getElementById('mode-classic')?.addEventListener('click', () => setAppMode('classic'));
document.getElementById('mode-session')?.addEventListener('click', () => setAppMode('session'));

wireRandomizeUI({
  seq, synth, scaleSel, rootSel,
  getBassRollEntry: () => classicState.bassRollEntry,
  refreshAllCellsFromState,
  refreshKnobsFromSynth,
  rebuildPolyTrack,
  rebuildRollsView,
  getActiveEngineLaneId: () => _lehState.activeLaneId,
});
const automationTickDeps: AutomationTickDeps = {
  seq,
  automationRegistry,
  getAppMode,
  getLaneStates: () => sessionHost.laneStates,
  ctx,
  redrawAllLanes,
  getBassRollEntry: () => classicState.bassRollEntry,
  getMainRollEntry: () => classicState.mainRollEntry,
  getExtraRolls: () => classicState.extraRolls,
  getRollsRollEntries: () => rollsRollEntries,
  autoScrollRoll,
  getClassicDeps: () => classicDeps,
  trackActiveUntil,
};
startAutomationTick(automationTickDeps);
// Auto-load the minimal techno demo on first boot so the user lands on
// something playable. Press the demo button again to reset, or just edit.
applyMinimalTechnoDemo(demoDeps);
startVisualizer({ ctx, analyser, vizCanvas });

// ── Save Manager v2 (see src/save-wiring.ts) ──────────────────────────────
const saveWiringDeps: import('./save/save-wiring').SaveWiringDeps = {
  seq, synth, polysynth, drums, master,
  volInput, bpmInput, swingInput, kitSel, waveSel, scaleSel, rootSel,
  bank, barsSel,
  viewStart: { get value() { return classicState.viewStart; }, set value(v) { classicState.viewStart = v; } },
  activeTracks: () => activeTracks() as string[],
  stripFor: (t) => stripFor(t as TrackId),
  muteState: muteState as Record<string, boolean>,
  soloState: soloState as Record<string, boolean>,
  applyMuteSolo,
  sessionHost,
  setAppMode,
  getAppMode,
  rebuildTracks,
  rebuildMixer,
  refreshKnobsFromSynth,
  renderLanes,
  fx,
  filterChain,
  flashButton,
};
wireSaveManager(saveWiringDeps);
bootRecoveryLoad(saveWiringDeps);

// ── Pure-Session boot (session.html) ──────────────────────────────────────
// When the host page sets data-pure-session, default to Session mode and
// auto-import the freshly-loaded Classic demo so the user lands on a
// playable grid without pressing "Import from Classic".
if (document.body.dataset.pureSession === 'true') {
  sessionHost.applyLoadedSessionState(importClassicToSession(bank));
  setAppMode('session');
}
