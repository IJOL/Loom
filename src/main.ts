import { listEngines } from './engines/registry';
import type { SynthEngine } from './engines/engine-types';
import * as leh from './engines/lane-engine-host';
import type { LaneEngineHostState, LaneEngineHostDeps } from './engines/lane-engine-host';
import './engines/subtractive';
import './engines/wavetable';
import './engines/fm';
import './engines/karplus';
import { TB303, type Wave } from './core/synth';
import { Sequencer, type PolyStep } from './core/sequencer';
import { DrumMachine, DRUM_LANES, type DrumVoice } from './core/drums';
import { clearPattern, type ScaleName } from './core/random';
import { FxBus, ChannelStrip, FilterChain, type ChannelState } from './core/fx';
import { PatternBank, clonePattern, emptyPattern, AUTOMATION_SUB_RES, MAX_EXTRA_POLY_TRACKS, type PatternData, type PolyTrack, type AutomationLane } from './core/pattern';
import { createKnob, type KnobHandle } from './core/knob';
import { PolySynth, type PolySynthParams } from './polysynth/polysynth';
import { DRUM_PRESETS, BASS_PRESETS, MELODY_PRESETS, loadDrumPreset, loadBassPreset, loadMelodyPreset } from './presets/presets';
import { scheduleArpForNote } from './arp/arp';
import { stepsToNotes, bassStepsToNotes } from './core/notes';
import { tickSessionEnvelopes } from './session/session-runtime';
import { buildMixerColumn } from './core/mixer';
import { SessionHost } from './session/session-host';
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
const bassStrip = new ChannelStrip(ctx, master, fx);
const polyStrip = new ChannelStrip(ctx, master, fx);
// All drum voices route through this bus first, so a single level/EQ/sends
// controls the entire drum machine.
const drumBusStrip = new ChannelStrip(ctx, master, fx);
const synth = new TB303(ctx, bassStrip.input);
const drums = new DrumMachine(ctx, fx, drumBusStrip.input);
const polysynth = new PolySynth(ctx, polyStrip.input);

// Extra polyphonic voices are created LAZILY — no PolySynth/ChannelStrip is
// instantiated until a track is actually added (via UI, MIDI import, or demo).
const extraStrips: Partial<Record<ExtraId, ChannelStrip>> = {};
const extraPolys: Partial<Record<ExtraId, PolySynth>> = {};

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

const stripFor = (t: TrackId): ChannelStrip => {
  if (t === 'bass') return bassStrip;
  if (t === 'poly') return polyStrip;
  if (t === 'drumBus') return drumBusStrip;
  if ((EXTRA_IDS as readonly string[]).includes(t)) {
    ensureExtraPoly(t as ExtraId); // creates strip lazily if missing
    return extraStrips[t as ExtraId]!;
  }
  return drums.channels[t as DrumVoice];
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
  const idx = autoAbsSubIdx % lane.values.length;
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

// Populate engine selector from registry
function populateEngineSelect() {
  engineSel.innerHTML = '';
  for (const engine of listEngines('polyhost')) {
    const opt = document.createElement('option');
    opt.value = engine.id;
    opt.textContent = engine.name;
    if (engine.id === currentEngineId) opt.selected = true;
    engineSel.appendChild(opt);
  }
}
populateEngineSelect();

// Engine-specific param knobs container
const engineParamEl = document.createElement('div');
engineParamEl.id = 'engine-params';
engineParamEl.style.display = 'none';
const polyPage = document.querySelector('[data-page="poly"]')!;
const firstPolyRow = polyPage.querySelector('.poly-section')!;
firstPolyRow.parentNode!.insertBefore(engineParamEl, firstPolyRow.nextSibling);

function unregisterKnobsByPrefix(prefix: string) {
  for (const id of Array.from(automationRegistry.keys())) {
    if (id.startsWith(prefix)) automationRegistry.delete(id);
  }
}

function rebuildEngineParamUI() {
  engineParamEl.innerHTML = '';
  // Drop any previously-registered knobs for this lane so we don't accumulate
  // stale handles in the automation registry.
  const activeLaneId = _lehState.activeLaneId;
  unregisterKnobsByPrefix(`${activeLaneId}.`);

  // Show/hide subtractive-specific rows based on the ACTIVE lane's engine
  const engineId = getLaneEngineId(activeLaneId);
  const subtractiveRows = polyPage.querySelectorAll<HTMLElement>('[data-engine="subtractive"]');
  for (const row of subtractiveRows) {
    row.style.display = engineId === 'subtractive' ? '' : 'none';
  }
  if (engineId === 'subtractive') {
    engineParamEl.style.display = 'none';
    populateAutoParamSelectWrapper();
    return;
  }
  const instance = getLaneEngineInstance(activeLaneId);
  if (!instance) return;
  engineParamEl.style.display = '';
  const ctx = {
    laneId: activeLaneId,
    idPrefix: activeLaneId,
    registerKnob: (k: unknown) => registerKnob(k as KnobHandle),
  };
  instance.buildParamUI(engineParamEl, ctx);
  if (engineParamEl.childElementCount === 0) {
    const row = document.createElement('div');
    row.className = 'row poly-section';
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    const eng = instance as unknown as { setParam?: (id: string, v: number) => void; getParam?: (id: string) => number };
    for (const p of instance.params) {
      const fullId = `${activeLaneId}.${p.id}`;
      const k = createKnob({
        id: fullId,
        label: p.label, min: p.min, max: p.max,
        value: eng.getParam?.(p.id) ?? p.default,
        onChange: (v) => { eng.setParam?.(p.id, v); },
      });
      registerKnob(k);
      knobRow.appendChild(k.el);
    }
    row.appendChild(knobRow);
    engineParamEl.appendChild(row);
  }
  populateAutoParamSelectWrapper();
}

// ── Per-lane engines (Phase 1B) — state lives in lane-engine-host.ts ───────
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


engineSel.addEventListener('change', () => {
  const newId = engineSel.value;
  leh.setLaneEngineIdInPattern(_lehDeps, _lehState.activeLaneId, newId);
  ensureLaneEngine(_lehState.activeLaneId, newId);
  if (_lehState.activeLaneId === 'main') currentEngineId = newId; // legacy mirror
  rebuildEngineParamUI();
});

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
const fmtPan = (v: number) => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;

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

// ── Save / Load (localStorage) ─────────────────────────────────────────────
const STORE_KEY = 'tb303-state-v1';

interface SavedState {
  bpm: number;
  swing: number;
  masterVol: number;
  bars: number;
  kit: string;
  wave: Wave;
  scale: ScaleName;
  rootNote: number;
  synthParams: typeof synth.params;
  polyParams?: PolySynthParams;
  currentSlot: number;
  slots: PatternData[];
  channels: Partial<Record<TrackId, ChannelState>>;
  mutes: Partial<Record<TrackId, boolean>>;
  solos: Partial<Record<TrackId, boolean>>;
}

function saveAll() {
  // Make sure current edits are captured in the bank before serializing
  bank.slots[bank.current] = clonePattern(seq.pattern);
  const state: SavedState = {
    bpm: seq.bpm,
    swing: seq.swing,
    masterVol: master.gain.value,
    bars: seq.length,
    kit: drums.kitId,
    wave: synth.params.wave,
    scale: scaleSel.value as ScaleName,
    rootNote: parseInt(rootSel.value, 10),
    synthParams: { ...synth.params },
    polyParams: JSON.parse(JSON.stringify(polysynth.params)) as PolySynthParams,
    currentSlot: bank.current,
    slots: bank.slots.map(clonePattern),
    channels: Object.fromEntries(activeTracks().map((t) => [t, stripFor(t).serialize()])) as Partial<Record<TrackId, ChannelState>>,
    mutes: { ...muteState }, solos: { ...soloState },
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  flashButton($<HTMLButtonElement>('save'), 'Saved!');
}

function loadAll() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) { flashButton($<HTMLButtonElement>('load'), 'No save'); return; }
  const s = JSON.parse(raw) as SavedState;

  seq.bpm = s.bpm; bpmInput.value = String(s.bpm);
  seq.swing = s.swing; swingInput.value = String(s.swing);
  master.gain.value = s.masterVol; volInput.value = String(s.masterVol);
  drums.setKit(s.kit); kitSel.value = s.kit;
  synth.params = { ...s.synthParams }; waveSel.value = s.wave;
  scaleSel.value = s.scale; rootSel.value = String(s.rootNote);

  // Slots may come from older saves missing the melody field — patch them.
  bank.slots = s.slots.map((p) => clonePattern(normalizePattern(p)));
  bank.current = s.currentSlot;
  seq.setPattern(bank.slots[bank.current]);
  barsSel.value = String(seq.length);
  classicState.viewStart = 0;

  for (const t of activeTracks()) {
    const cs = s.channels[t];
    if (cs) stripFor(t).restore(cs);
    muteState[t] = !!s.mutes[t];
    soloState[t] = !!s.solos[t];
  }
  applyMuteSolo();

  if (s.polyParams) {
    polysynth.params = JSON.parse(JSON.stringify(s.polyParams)) as PolySynthParams;
    refreshPolyKnobsFromState();
  }

  fx.setBpmSync(seq.bpm);
  filterChain.updateBpm(seq.bpm);
  rebuildTracks();
  rebuildMixer();
  refreshKnobsFromSynth();
  renderLanes();
  $$('button.slot').forEach((b) => b.classList.toggle('active', b.dataset.slot === String(bank.current)));
  flashButton($<HTMLButtonElement>('load'), 'Loaded!');
}

function normalizePattern(p: PatternData): PatternData {
  if (!p.melody) {
    p.melody = Array.from({ length: p.length }, () => ({ on: false, notes: [60], accent: false, tie: false }));
  }
  // Migrate older saves: PolyStep used to have `note: number`; now it has `notes: number[]`.
  for (const s of p.melody) {
    const legacy = s as PolyStep & { note?: number };
    if (!Array.isArray(s.notes)) s.notes = [legacy.note ?? 60];
  }
  return p;
}

function flashButton(b: HTMLButtonElement, msg: string) {
  const orig = b.textContent;
  b.textContent = msg;
  b.disabled = true;
  setTimeout(() => { b.textContent = orig; b.disabled = false; }, 800);
}

// Save/Load buttons are wired in the Save Manager v2 section below.

// ── Visualizer ─────────────────────────────────────────────────────────────
function startVisualizer() {
  const c = vizCanvas.getContext('2d');
  if (!c) return;
  const data = new Uint8Array(analyser.fftSize);
  const draw = () => {
    requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(data);
    c.fillStyle = '#1a1a1a';
    c.fillRect(0, 0, vizCanvas.width, vizCanvas.height);
    c.lineWidth = 1.5;
    c.strokeStyle = '#f7d000';
    c.beginPath();
    const slice = vizCanvas.width / data.length;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0;
      const y = (v * vizCanvas.height) / 2;
      if (i === 0) c.moveTo(0, y); else c.lineTo(i * slice, y);
    }
    c.stroke();
  };
  draw();
}

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

let autoCurrentSubIdx = 0;  // current sub-step index for the playhead overlay

// ensureLaneSize, snapLaneToSteps, populateAutoParamSelect, addLane, removeLane,
// renderLanes, drawLane, attachLanePainter → automation-ui.ts / automation-painter.ts

// Continuous (sub-step) automation tick driven by rAF. Tracks an ABSOLUTE
// play position (sub-steps since play started) so each lane can have its own
// length and wraps independently of the pattern.
let autoTickRunning = false;
let autoAbsSubIdx = 0;        // monotonically growing while playing
let autoLoopCount = 0;        // how many times the pattern has wrapped
let autoPrevPlayPos = 0;
function resetAutomationPosition() {
  autoAbsSubIdx = 0;
  autoLoopCount = 0;
  autoPrevPlayPos = 0;
  autoCurrentSubIdx = 0;
}
function startAutomationTick() {
  if (autoTickRunning) return;
  autoTickRunning = true;
  const tick = () => {
    if (!autoTickRunning) return;
    requestAnimationFrame(tick);
    if (!seq.isPlaying()) return;
    const playPos = seq.currentPlayPosition();          // 0 .. pattern.length
    // Detect pattern wrap (playPos jumps backwards) and bump the loop count.
    if (playPos < autoPrevPlayPos - 1) autoLoopCount++;
    autoPrevPlayPos = playPos;
    const patternSubs = seq.length * AUTOMATION_SUB_RES;
    autoAbsSubIdx = autoLoopCount * patternSubs + Math.floor(playPos * AUTOMATION_SUB_RES);
    // For the playhead overlay (within-pattern), just use mod patternSubs.
    const playheadIdx = autoAbsSubIdx % patternSubs;
    if (playheadIdx !== autoCurrentSubIdx) {
      autoCurrentSubIdx = playheadIdx;
      redrawAllLanes();
      // Keep all piano-roll playheads live (bass + main + extras + rolls view).
      if (classicState.bassRollEntry) { classicState.bassRollEntry.handle.redraw(); autoScrollRoll(classicState.bassRollEntry, classicDeps); }
      if (classicState.mainRollEntry) { classicState.mainRollEntry.handle.redraw(); autoScrollRoll(classicState.mainRollEntry, classicDeps); }
      for (const e of classicState.extraRolls.values()) { e.handle.redraw(); autoScrollRoll(e, classicDeps); }
      for (const e of rollsRollEntries) { e.handle.redraw(); autoScrollRoll(e, classicDeps); }
      // Update activity indicators (track labels pulse when recently triggered)
      const now = performance.now();
      document.querySelectorAll<HTMLElement>('.track-label[data-track-id]').forEach((el) => {
        const id = el.dataset.trackId ?? '';
        const until = trackActiveUntil.get(id) ?? 0;
        el.classList.toggle('triggered', now < until);
      });
    }
    for (const lane of seq.pattern.automation) {
      if (!lane.enabled) continue;
      const entry = automationRegistry.get(lane.paramId);
      if (!entry) continue;
      const laneLen = lane.values.length;
      if (laneLen === 0) continue;
      const idx = autoAbsSubIdx % laneLen;
      const v = lane.values[idx];
      if (v == null) continue;
      const denorm = entry.meta.min + clamp01(v) * (entry.meta.max - entry.meta.min);
      entry.setValue(denorm);
    }
    if (appMode === 'session') {
      tickSessionEnvelopes(sessionHost.laneStates, ctx.currentTime, seq.bpm, (paramId, normalised) => {
        const k = automationRegistry.get(paramId);
        if (!k) return;
        const range = k.meta.max - k.meta.min;
        k.setValue(k.meta.min + normalised * range);
      });
    }
  };
  requestAnimationFrame(tick);
}

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
const bassTriggerDirect = (note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) =>
  synth.trigger({ freq: midiToFreqLocal(note), accent, slide: slidingIn, duration: gate }, time);
const bassTriggerForArp = (note: number, time: number, gate: number, accent: boolean) =>
  synth.trigger({ freq: midiToFreqLocal(note), accent, slide: false, duration: gate }, time);

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
  polyTriggerDirect,
  drums,
  drumLanes: DRUM_LANES,
  markTrackActive,
  ensureExtraPoly: ensureExtraPoly as (id: string) => PolySynth,
  extraStrips: extraStrips as Partial<Record<string, ChannelStrip>>,
  getLaneEngineId,
  ensureLaneEngine,
  setActivePolyTarget,
  setCurrentSynthLane,
  polysynth,
  mixerDeps,
  getAppMode,
});
sessionHost.init();

// buildArpUI moved to arp-ui.ts (imported above)

// PolySynth presets (POLY_PRESETS_KEY, loadUserPolyPresets, applyPolyParams,
// populatePolyPresetSelect, wirePolyControls) → polysynth-presets.ts

// ── Drum master controls (drums tab) ──────────────────────────────────────
function buildDrumMasterUI() {
  const row = $<HTMLDivElement>('drum-master-knobs');
  const SIZE = 42;
  const state = drumBusStrip.serialize();
  const mk = (opts: Parameters<typeof createKnob>[0]) => {
    const k = createKnob({ ...opts, size: SIZE });
    row.appendChild(k.el);
    registerKnob(k);
  };
  mk({ id: 'mix.drumBus.level', min: 0, max: 1.5, step: 0.01, value: state.level, defaultValue: 1,
    label: 'DRUM VOL', color: '#f7d000', format: fmtPct, onChange: (v) => drumBusStrip.setLevel(v) });
  mk({ id: 'mix.drumBus.pan', min: -1, max: 1, step: 0.01, value: state.pan ?? 0, defaultValue: 0,
    label: 'PAN', color: '#e67e22', format: fmtPan, onChange: (v) => drumBusStrip.setPan(v) });
  mk({ id: 'mix.drumBus.rev', min: 0, max: 1, step: 0.01, value: state.reverbSend, defaultValue: 0,
    label: 'REV', color: '#9b59b6', format: fmtPct, onChange: (v) => drumBusStrip.setReverbSend(v) });
  mk({ id: 'mix.drumBus.dly', min: 0, max: 1, step: 0.01, value: state.delaySend, defaultValue: 0,
    label: 'DLY', color: '#3498db', format: fmtPct, onChange: (v) => drumBusStrip.setDelaySend(v) });
  mk({ id: 'mix.drumBus.eqlow', min: -18, max: 18, step: 0.5, value: state.eqLow, defaultValue: 0,
    label: 'LO',  color: '#c0392b', format: fmtDb, onChange: (v) => drumBusStrip.setEqLow(v) });
  mk({ id: 'mix.drumBus.eqmid', min: -18, max: 18, step: 0.5, value: state.eqMid, defaultValue: 0,
    label: 'MID', color: '#f7d000', format: fmtDb, onChange: (v) => drumBusStrip.setEqMid(v) });
  mk({ id: 'mix.drumBus.eqhi', min: -18, max: 18, step: 0.5, value: state.eqHigh, defaultValue: 0,
    label: 'HI',  color: '#2ee0c0', format: fmtDb, onChange: (v) => drumBusStrip.setEqHigh(v) });
}

// setPolyMode, updatePolyModeButtons, polyPresetName, applyPresetByName,
// refreshPolyPresetSelect, wirePolyMode → polysynth-presets.ts

// ── Preset library (patterns) ─────────────────────────────────────────────
function wirePresets() {
  const drumSel   = $<HTMLSelectElement>('preset-drums');
  const bassSel   = $<HTMLSelectElement>('preset-bass');
  const melodySel = $<HTMLSelectElement>('preset-melody');

  for (const p of DRUM_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — ${p.description}`;
    drumSel.appendChild(opt);
  }
  for (const p of BASS_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — ${p.description}`;
    bassSel.appendChild(opt);
  }
  for (const p of MELODY_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — ${p.description}`;
    melodySel.appendChild(opt);
  }

  $<HTMLButtonElement>('preset-drums-load').addEventListener('click', () => {
    const p = DRUM_PRESETS.find((x) => x.id === drumSel.value);
    if (!p) return;
    loadDrumPreset(seq, p);
    refreshAllCellsFromState();
  });
  $<HTMLButtonElement>('preset-bass-load').addEventListener('click', () => {
    const p = BASS_PRESETS.find((x) => x.id === bassSel.value);
    if (!p) return;
    loadBassPreset(seq, p);
    refreshAllCellsFromState();
  });
  $<HTMLButtonElement>('preset-melody-load').addEventListener('click', () => {
    const p = MELODY_PRESETS.find((x) => x.id === melodySel.value);
    if (!p) return;
    loadMelodyPreset(seq, p);
    refreshAllCellsFromState();
  });
}

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
  getAutoAbsSubIdx: () => autoAbsSubIdx,
  extraIds: EXTRA_IDS,
  laneLabels: LANE_LABELS as Record<string, string>,
};

// Wire stable wrappers now that deps are built.
_automationDeps = automationDeps;
renderLanes = () => renderLanesFromUI(automationDeps);
populateAutoParamSelectWrapper = () => populateAutoParamSelect(automationDeps);

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
buildDrumMasterUI();
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
wirePresets();
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
function setAppMode(next: AppMode) {
  if (next === appMode) return;
  // Stop audio at every mode flip to avoid ambiguous state.
  if (seq.isPlaying()) seq.stop();
  appMode = next;
  seq.sessionMode = appMode === 'session';
  document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === appMode);
  });
  const tabBar      = document.querySelector<HTMLElement>('.tab-bar');
  const pages       = document.querySelectorAll<HTMLElement>('.page');
  const sessionView = document.getElementById('session-view');
  const inClassic   = appMode === 'classic';
  if (tabBar)      tabBar.hidden      = !inClassic;
  for (const p of pages) p.hidden = !inClassic || p.dataset.page !== getActiveClassicTab();
  if (sessionView) sessionView.hidden = inClassic;
}
function getActiveClassicTab(): string {
  const active = document.querySelector<HTMLButtonElement>('.tab.active');
  return active?.dataset.tab ?? '303';
}
document.getElementById('mode-classic')!.addEventListener('click', () => setAppMode('classic'));
document.getElementById('mode-session')!.addEventListener('click', () => setAppMode('session'));

wireRandomizeUI({
  seq, synth, scaleSel, rootSel,
  getBassRollEntry: () => classicState.bassRollEntry,
  refreshAllCellsFromState,
  refreshKnobsFromSynth,
  rebuildPolyTrack,
  rebuildRollsView,
  getActiveEngineLaneId: () => _lehState.activeLaneId,
});
startAutomationTick();
// Auto-load the minimal techno demo on first boot so the user lands on
// something playable. Press the demo button again to reset, or just edit.
applyMinimalTechnoDemo(demoDeps);
startVisualizer();

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
  normalizePattern,
  flashButton,
};
wireSaveManager(saveWiringDeps);
bootRecoveryLoad(saveWiringDeps);
