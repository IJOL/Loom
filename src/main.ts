import { listEngines, getEngine, createEngineInstance } from './engines/registry';
import type { SynthEngine } from './engines/engine-types';
import './engines/subtractive';
import './engines/wavetable';
import './engines/fm';
import './engines/karplus';
import { TB303, type Wave } from './synth';
import { Sequencer, type DrumStep, type PolyStep } from './sequencer';
import { DrumMachine, DRUM_LANES, type DrumVoice } from './drums';
import { randomize, randomizePolySynth, clearPattern, type ScaleName, type RandomizeOptions } from './random';
import { FACTORY_POLY_PRESETS } from './poly-presets';
import { FxBus, ChannelStrip, FilterChain, MasterFilter, type ChannelState, type SyncDiv } from './fx';
import { PatternBank, clonePattern, emptyPattern, AUTOMATION_SUB_RES, MAX_EXTRA_POLY_TRACKS, type PatternData, type PolyTrack, type AutomationLane } from './pattern';
import { createKnob, type KnobHandle } from './knob';
import { PolySynth, type PolySynthParams, type LfoTarget, type LfoSync } from './polysynth';
import { DRUM_PRESETS, BASS_PRESETS, MELODY_PRESETS, loadDrumPreset, loadBassPreset, loadMelodyPreset } from './presets';
import { ARP_DEFAULTS, scheduleArpForNote, type ArpPattern, type ArpScale, type ArpSettings } from './arp';
import { stepsToNotes, bassStepsToNotes, notesToBassSteps, notesToPolySteps, TICKS_PER_STEP, patternTicks as ptTicks, type NoteEvent } from './notes';
import { createPianoRoll, type PianoRollHandle } from './pianoroll';
import type { SessionState } from './session';
import {
  saveNamedEntry, readIndex, loadEntry, loadAutosave,
  deleteEntry, renameEntry, clearAll, totalStorageKB,
  downloadAsJson, loadFromFile,
  type SaveIndexEntry,
} from './save-manager';
import { tickSessionEnvelopes } from './session-runtime';
import { buildMixerColumn } from './mixer';
import { SessionHost } from './session-host';
import { applyMinimalTechnoDemo, wireDemoMinimalTechno } from './demo-minimal-techno';

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
  unregisterKnobsByPrefix(`${activeEngineLaneId}.`);

  // Show/hide subtractive-specific rows based on the ACTIVE lane's engine
  const engineId = getLaneEngineId(activeEngineLaneId);
  const subtractiveRows = polyPage.querySelectorAll<HTMLElement>('[data-engine="subtractive"]');
  for (const row of subtractiveRows) {
    row.style.display = engineId === 'subtractive' ? '' : 'none';
  }
  if (engineId === 'subtractive') {
    engineParamEl.style.display = 'none';
    populateAutoParamSelect();
    return;
  }
  const instance = getLaneEngineInstance(activeEngineLaneId);
  if (!instance) return;
  engineParamEl.style.display = '';
  const ctx = {
    laneId: activeEngineLaneId,
    idPrefix: activeEngineLaneId,
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
      const fullId = `${activeEngineLaneId}.${p.id}`;
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
  populateAutoParamSelect();
}

// ── Per-lane engines (Phase 1B) ────────────────────────────────────────────
// One independent SynthEngine instance per lane (main + each extra) whenever
// the lane's engineId is non-subtractive. Subtractive lanes keep using their
// existing PolySynth (polysynth or extraPolys[id]); no map entry needed.
const polyEngineInstances = new Map<string, SynthEngine>();
// Which lane the top engine selector + engine params UI is currently bound to.
// Tracks the EDITING dropdown — switching EDITING also switches what these
// controls operate on. 'main' or an ExtraId.
let activeEngineLaneId: string = 'main';

function getLaneEngineId(laneId: string): string {
  if (laneId === 'main') return seq.pattern.engineId ?? 'subtractive';
  const track = seq.pattern.extraPolyTracks.find((t) => t.id === laneId);
  return track?.engineId ?? 'subtractive';
}

function setLaneEngineIdInPattern(laneId: string, id: string): void {
  if (laneId === 'main') seq.pattern.engineId = id;
  else {
    const track = seq.pattern.extraPolyTracks.find((t) => t.id === laneId);
    if (track) track.engineId = id;
  }
}

// Reconcile the live instance map with the requested engineId for a lane.
// Disposes/recreates as needed. Returns the instance or null (subtractive).
function ensureLaneEngine(laneId: string, engineId: string): SynthEngine | null {
  const existing = polyEngineInstances.get(laneId);
  if (engineId === 'subtractive') {
    if (existing) { existing.dispose(); polyEngineInstances.delete(laneId); }
    return null;
  }
  if (existing && existing.id === engineId) return existing;
  if (existing) existing.dispose();
  const inst = createEngineInstance(engineId);
  if (!inst) return null;
  polyEngineInstances.set(laneId, inst);
  return inst;
}

function getLaneEngineInstance(laneId: string): SynthEngine | null {
  return polyEngineInstances.get(laneId) ?? null;
}

engineSel.addEventListener('change', () => {
  const newId = engineSel.value;
  setLaneEngineIdInPattern(activeEngineLaneId, newId);
  ensureLaneEngine(activeEngineLaneId, newId);
  if (activeEngineLaneId === 'main') currentEngineId = newId; // legacy mirror
  rebuildEngineParamUI();
});

// Switch what the engine selector + engine-controls panel are editing.
function setActiveEngineLane(laneId: string) {
  activeEngineLaneId = laneId;
  const id = getLaneEngineId(laneId);
  engineSel.value = id;
  if (laneId === 'main') currentEngineId = id;
  ensureLaneEngine(laneId, id);
  const laneLabel = document.getElementById('engine-lane-label');
  if (laneLabel) {
    laneLabel.textContent = laneId === 'main' ? 'MAIN' : LANE_LABELS[laneId as keyof typeof LANE_LABELS] ?? laneId.toUpperCase();
  }
  rebuildEngineParamUI();
}

// Optional per-slot hook: runs after engine instances are (re)created for the
// active slot. The demo registers these so each slot's engines start with the
// intended sound (otherwise newly-created instances would use defaults).
let slotEngineConfigurators: Array<(() => void) | null> = [null, null, null, null];
function setSlotConfigurators(cbs: Array<(() => void) | null>) { slotEngineConfigurators = cbs; }

// Recreate engine instances for every lane to match the current pattern's
// engineIds. Called after any slot/pattern swap.
function syncEngineToPattern() {
  ensureLaneEngine('main', getLaneEngineId('main'));
  for (const track of seq.pattern.extraPolyTracks) {
    ensureLaneEngine(track.id, track.engineId ?? 'subtractive');
  }
  // Apply per-slot engine configuration (if registered by demo, etc.)
  const cb = slotEngineConfigurators[bank.current];
  if (cb) cb();
  // Refresh the active-lane UI bindings (engine selector + params panel)
  const id = getLaneEngineId(activeEngineLaneId);
  engineSel.value = id;
  if (activeEngineLaneId === 'main') currentEngineId = id;
  rebuildEngineParamUI();
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

let viewStart = 0;

interface BassCellRefs {
  el: HTMLDivElement;
  noteSel: HTMLSelectElement;
  onBtn: HTMLButtonElement;
  accentBtn: HTMLButtonElement;
  slideBtn: HTMLButtonElement;
}
interface MelodyCellRefs {
  el: HTMLDivElement;
  noteSel: HTMLSelectElement;
  onBtn: HTMLButtonElement;
  accentBtn: HTMLButtonElement;
  tieBtn: HTMLButtonElement;
  chordBtn: HTMLButtonElement;
}

let bassCells: Record<number, BassCellRefs> = {};
let melodyCells: Record<number, MelodyCellRefs> = {};
let drumCells: Record<DrumVoice, Record<number, HTMLButtonElement>> = {
  kick: {}, snare: {}, closedHat: {}, openHat: {}, clap: {}, cowbell: {}, tom: {}, ride: {},
};

function visibleRange(): { start: number; end: number } {
  if (viewStart >= seq.length) viewStart = 0;
  return { start: viewStart, end: Math.min(viewStart + VIEW_SIZE, seq.length) };
}

function updatePager() {
  const totalPages = Math.max(1, Math.ceil(seq.length / VIEW_SIZE));
  const currentPage = Math.floor(viewStart / VIEW_SIZE) + 1;
  $('page-label').textContent = `${currentPage} / ${totalPages}`;
  $<HTMLButtonElement>('page-prev').disabled = currentPage <= 1;
  $<HTMLButtonElement>('page-next').disabled = currentPage >= totalPages;
  $('pager').style.display = totalPages > 1 ? 'flex' : 'none';
}

function rebuildTracks() {
  bassTracksEl.innerHTML = '';
  drumTracksEl.innerHTML = '';
  bassCells = {};
  for (const k of Object.keys(drumCells) as DrumVoice[]) drumCells[k] = {};

  const { start, end } = visibleRange();
  const count = end - start;
  bassTracksEl.style.setProperty('--steps', String(count));
  drumTracksEl.style.setProperty('--steps', String(count));

  // Bass: piano-roll mode renders a single piano-roll instead of the step grid.
  if (seq.pattern.bassMode === 'piano') {
    bassRollEntry = addPianoRollFor({
      parent: bassTracksEl,
      labelText: LANE_LABELS.bass,
      getNotes: () => seq.pattern.bassNotes,
      setNotes: (notes) => { seq.pattern.bassNotes = notes; },
      trackId: 'bass',
    });
  } else {
    bassRollEntry = null;
    renderBassStepGrid(start, end);
  }

  // Drum rows
  for (const lane of DRUM_LANES) {
    const row = document.createElement('div');
    row.className = `track drum-track ${lane}`;
    const label = document.createElement('div');
    label.className = 'track-label';
    label.textContent = LANE_LABELS[lane];
    row.appendChild(label);
    const cellsEl = document.createElement('div');
    cellsEl.className = 'cells drum-cells';
    row.appendChild(cellsEl);

    for (let i = start; i < end; i++) {
      const step = seq.drums[lane][i];
      const b = document.createElement('button');
      b.className = `dcell ${lane}`;
      if (i > start && (i - start) % 16 === 0) b.classList.add('seg-start');
      if (i % 4 === 0) b.classList.add('downbeat');
      applyDrumCellState(b, step);
      b.addEventListener('click', (e) => {
        if (e.shiftKey) cycleDrumRoll(step);
        else cycleDrumStep(step);
        applyDrumCellState(b, step);
      });
      b.title = 'Click: off → on → accent. Shift+click: roll x2 → x4';
      cellsEl.appendChild(b);
      drumCells[lane][i] = b;
    }
    drumTracksEl.appendChild(row);
  }

  rebuildPolyTrack();
  updatePager();
}

function renderBassStepGrid(start: number, end: number) {
  const bassRow = document.createElement('div');
  bassRow.className = 'track bass-track';
  const bassLabel = document.createElement('div');
  bassLabel.className = 'track-label';
  bassLabel.textContent = LANE_LABELS.bass;
  bassRow.appendChild(bassLabel);
  const bassCellsEl = document.createElement('div');
  bassCellsEl.className = 'cells bass-cells';
  bassRow.appendChild(bassCellsEl);

  for (let i = start; i < end; i++) {
    const step = seq.bass[i];
    const cell = document.createElement('div');
    cell.className = 'bcell';
    if (i > start && (i - start) % 16 === 0) cell.classList.add('seg-start');

    const noteSel = document.createElement('select');
    noteSel.className = 'note-sel';
    for (let m = 24; m <= 60; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = midiLabel(m);
      if (m === step.note) opt.selected = true;
      noteSel.appendChild(opt);
    }
    noteSel.addEventListener('change', () => {
      step.note = parseInt(noteSel.value, 10);
    });

    const mkToggle = (label: string, key: 'on' | 'accent' | 'slide') => {
      const b = document.createElement('button');
      b.className = `toggle ${key}`;
      b.textContent = label;
      if (step[key]) b.classList.add('active');
      b.addEventListener('click', () => {
        step[key] = !step[key];
        b.classList.toggle('active', step[key]);
      });
      return b;
    };

    const onBtn = mkToggle('●', 'on');
    const accentBtn = mkToggle('A', 'accent');
    const slideBtn = mkToggle('S', 'slide');
    cell.appendChild(noteSel);
    cell.appendChild(onBtn);
    cell.appendChild(accentBtn);
    cell.appendChild(slideBtn);
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1);
    cell.appendChild(num);

    bassCellsEl.appendChild(cell);
    bassCells[i] = { el: cell, noteSel, onBtn, accentBtn, slideBtn };
  }
  bassTracksEl.appendChild(bassRow);
}

interface RollEntry { handle: PianoRollHandle; scrollEl: HTMLElement; canvasEl: HTMLCanvasElement; }
let pianoRoll: PianoRollHandle | null = null;
let mainRollEntry: RollEntry | null = null;
let bassRollEntry: RollEntry | null = null;
const extraRolls: Map<string, RollEntry> = new Map();

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
interface CopyEndpoint { id: string; label: string; }

function listCopyEndpoints(): CopyEndpoint[] {
  const out: CopyEndpoint[] = [
    { id: 'bass', label: `Bass 303 (${seq.pattern.bassMode})` },
    { id: 'main', label: `Main Poly (${seq.pattern.polyMode})` },
  ];
  for (const t of seq.pattern.extraPolyTracks) {
    out.push({ id: t.id, label: `${t.name || t.id} (piano)` });
  }
  return out;
}

// Read notes from any endpoint, converting from its native format.
function readEndpointAsNotes(id: string): NoteEvent[] {
  if (id === 'bass') {
    return seq.pattern.bassMode === 'piano'
      ? seq.pattern.bassNotes.map((n) => ({ ...n }))
      : bassStepsToNotes(seq.pattern.bass);
  }
  if (id === 'main') {
    return seq.pattern.polyMode === 'piano'
      ? seq.pattern.polyNotes.map((n) => ({ ...n }))
      : stepsToNotes(seq.pattern.melody);
  }
  const extra = seq.pattern.extraPolyTracks.find((t) => t.id === id);
  return extra ? extra.notes.map((n) => ({ ...n })) : [];
}

// Write notes to an endpoint, converting to its native format if needed.
function writeNotesToEndpoint(id: string, notes: NoteEvent[]): void {
  const cloned = notes.map((n) => ({ ...n }));
  if (id === 'bass') {
    if (seq.pattern.bassMode === 'piano') seq.pattern.bassNotes = cloned;
    else seq.pattern.bass = notesToBassSteps(cloned, seq.pattern.length);
    return;
  }
  if (id === 'main') {
    if (seq.pattern.polyMode === 'piano') seq.pattern.polyNotes = cloned;
    else seq.pattern.melody = notesToPolySteps(cloned, seq.pattern.length);
    return;
  }
  const extra = seq.pattern.extraPolyTracks.find((t) => t.id === id);
  if (extra) extra.notes = cloned;
}

function refreshCopyTrackSelects() {
  const fromSel = document.getElementById('copy-track-from') as HTMLSelectElement | null;
  const toSel   = document.getElementById('copy-track-to')   as HTMLSelectElement | null;
  if (!fromSel || !toSel) return;
  const endpoints = listCopyEndpoints();
  const prevFrom = fromSel.value || 'bass';
  const prevTo   = toSel.value   || 'main';
  fromSel.innerHTML = '';
  toSel.innerHTML = '';
  for (const e of endpoints) {
    const a = document.createElement('option'); a.value = e.id; a.textContent = e.label; fromSel.appendChild(a);
    const b = document.createElement('option'); b.value = e.id; b.textContent = e.label; toSel.appendChild(b);
  }
  if (endpoints.some((e) => e.id === prevFrom)) fromSel.value = prevFrom;
  if (endpoints.some((e) => e.id === prevTo))   toSel.value   = prevTo;
}

function wireCopyTrackPanel() {
  refreshCopyTrackSelects();
  const panel = document.querySelector('.copy-track-panel') as HTMLDetailsElement | null;
  // Refresh choices whenever the panel opens — extra polys can come and go.
  panel?.addEventListener('toggle', () => { if (panel.open) refreshCopyTrackSelects(); });
  const goBtn = document.getElementById('copy-track-go') as HTMLButtonElement | null;
  goBtn?.addEventListener('click', () => {
    const fromSel = document.getElementById('copy-track-from') as HTMLSelectElement | null;
    const toSel   = document.getElementById('copy-track-to')   as HTMLSelectElement | null;
    if (!fromSel || !toSel) return;
    if (fromSel.value === toSel.value) return;
    const notes = readEndpointAsNotes(fromSel.value);
    writeNotesToEndpoint(toSel.value, notes);
    rebuildTracks();
  });
}

function setActivePolyTarget(target: PolySynth, labelText: string) {
  activePolyTarget = target;
  $('poly-active-label').textContent = labelText;
  refreshPolyKnobsFromState();
  refreshPolyPresetSelect();
  refreshPolyTargetSelect();
  // Visual: highlight the active track header
  document.querySelectorAll('.track-label.active-edit').forEach((el) => el.classList.remove('active-edit'));
  const node = document.querySelector(`.track-label[data-poly-target="${labelText}"]`);
  if (node) node.classList.add('active-edit');
  // Switch engine selector + engine params panel to match this lane
  let laneId: string = 'main';
  if (target !== polysynth) {
    for (const id of EXTRA_IDS) if (extraPolys[id] && extraPolys[id] === target) { laneId = id; break; }
  }
  setActiveEngineLane(laneId);
}

// Ensure an extra PolyTrack exists for the given slot id (creates an empty
// one if missing) and returns it. Lets the user edit a slot's synth params
// and start painting notes without first loading a MIDI.
function ensureExtraTrack(id: ExtraId): PolyTrack {
  let track = seq.pattern.extraPolyTracks.find((t) => t.id === id);
  if (!track) {
    track = { id, name: LANE_LABELS[id], enabled: true, notes: [] };
    seq.pattern.extraPolyTracks.push(track);
  }
  ensureExtraPoly(id);
  return track;
}

function refreshPolyTargetSelect() {
  const sel = $<HTMLSelectElement>('poly-target-select');
  if (!sel) return;
  sel.innerHTML = '';
  const opts: Array<{ value: string; label: string }> = [{ value: 'main', label: 'MAIN' }];
  for (const id of EXTRA_IDS) {
    const hasTrack = !!seq.pattern.extraPolyTracks.find((t) => t.id === id);
    opts.push({ value: id, label: hasTrack ? `${LANE_LABELS[id]} ●` : `${LANE_LABELS[id]} (empty)` });
  }
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  // Match dropdown to currently active target
  if (activePolyTarget === polysynth) {
    sel.value = 'main';
  } else {
    for (const id of EXTRA_IDS) {
      if (extraPolys[id] && extraPolys[id] === activePolyTarget) { sel.value = id; break; }
    }
  }
}

function wirePolyTargetSelect() {
  const sel = $<HTMLSelectElement>('poly-target-select');
  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v === 'main') {
      setActivePolyTarget(polysynth, 'MAIN');
    } else {
      const id = v as ExtraId;
      // Create empty track if missing so user can immediately paint notes
      const track = ensureExtraTrack(id);
      setActivePolyTarget(ensureExtraPoly(id), track.name);
      rebuildPolyTrack();
      rebuildMixer();
    }
  });

  $<HTMLButtonElement>('poly-add-track').addEventListener('click', () => {
    // Find first ExtraId not already in use
    const used = new Set(seq.pattern.extraPolyTracks.map((t) => t.id));
    const free = EXTRA_IDS.find((id) => !used.has(id));
    if (!free) { alert(`All ${EXTRA_IDS.length} extra polysynth slots are in use.`); return; }
    const track = ensureExtraTrack(free);
    setActivePolyTarget(ensureExtraPoly(free), track.name);
    rebuildPolyTrack();
    rebuildMixer();
  });

  refreshPolyTargetSelect();
}

function autoScrollRoll(entry: RollEntry) {
  if (!seq.isPlaying()) return;
  const playTick = seq.currentPlayPosition() * TICKS_PER_STEP;
  const playX = (playTick / ptTicks(seq.length)) * entry.canvasEl.width;
  const sw = entry.scrollEl;
  const visW = sw.clientWidth;
  // If playhead is past 70% of visible window, scroll so it sits at 30%.
  if (playX > sw.scrollLeft + visW * 0.7 || playX < sw.scrollLeft) {
    sw.scrollLeft = Math.max(0, playX - visW * 0.3);
  }
}

function rangeForNotes(notes: NoteEvent[]): { lo: number; hi: number } {
  if (notes.length === 0) return { lo: 48, hi: 72 };
  let lo = Infinity, hi = -Infinity;
  for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
  // Pad +/-2 semitones and ensure at least 12 visible rows for legibility.
  let pLo = Math.max(0, lo - 2);
  let pHi = Math.min(127, hi + 2);
  if (pHi - pLo < 12) {
    const center = Math.floor((pLo + pHi) / 2);
    pLo = Math.max(0, center - 6);
    pHi = Math.min(127, pLo + 12);
  }
  return { lo: pLo, hi: pHi };
}

function addPianoRollFor(opts: {
  parent: HTMLElement;
  labelText: string;
  height?: number;        // auto-computed when omitted
  getNotes: () => NoteEvent[];
  setNotes: (notes: NoteEvent[]) => void;
  trailingControls?: HTMLElement;
  onLabelClick?: () => void;
  trackId?: string;       // used for the data attribute on the label
}): RollEntry {
  const wrap = document.createElement('div');
  wrap.className = 'track melody-track piano-roll-wrap';
  const label = document.createElement('div');
  label.className = 'track-label';
  label.dataset.polyTarget = opts.labelText;
  if (opts.trackId) label.dataset.trackId = opts.trackId;
  const labelText = document.createElement('span');
  labelText.textContent = opts.labelText;
  label.appendChild(labelText);
  if (opts.onLabelClick) {
    label.style.cursor = 'pointer';
    label.title = 'Click to edit this synth';
    label.addEventListener('click', () => opts.onLabelClick?.());
  }
  if (opts.trailingControls) {
    label.style.display = 'flex';
    label.style.flexDirection = 'column';
    label.style.gap = '4px';
    label.style.justifyContent = 'center';
    label.appendChild(opts.trailingControls);
  }
  wrap.appendChild(label);

  // Auto-fit the visible MIDI range to the notes this track actually uses, so
  // the rows aren't 2px tall and invisible. ~10px/row keeps notes clickable.
  const { lo, hi } = rangeForNotes(opts.getNotes());
  const rows = hi - lo + 1;
  const ROW_PX = 10;
  const height = opts.height ?? Math.min(360, Math.max(140, rows * ROW_PX));

  const PX_PER_STEP = 6;
  const canvasWidth = Math.max(1024, seq.length * PX_PER_STEP);
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'piano-roll-scroll';
  const canvas = document.createElement('canvas');
  canvas.className = 'piano-roll-canvas';
  canvas.width = canvasWidth;
  canvas.height = height;
  canvas.style.height = `${height}px`;
  canvas.style.width = `${canvasWidth}px`;
  scrollWrap.appendChild(canvas);
  wrap.appendChild(scrollWrap);
  opts.parent.appendChild(wrap);
  const handle = createPianoRoll({
    canvas,
    patternTicks: ptTicks(seq.length),
    getNotes: opts.getNotes,
    setNotes: opts.setNotes,
    minMidi: lo,
    maxMidi: hi,
    onChange: () => {},
    getPlayheadTick: () => seq.isPlaying() ? seq.currentPlayPosition() * TICKS_PER_STEP : -1,
  });
  return { handle, scrollEl: scrollWrap, canvasEl: canvas };
}

// The synth tab the user is currently editing. The poly page renders only this
// lane's controls + its single piano roll (or step grid for main).
let currentSynthLane: string = 'main';

function rebuildPolyTrack() {
  polyTracksEl.innerHTML = '';
  melodyCells = {};
  pianoRoll = null;
  extraRolls.clear();

  if (currentSynthLane === 'main') {
    if (seq.pattern.polyMode === 'piano') {
      mainRollEntry = addPianoRollFor({
        parent: polyTracksEl,
        labelText: 'MAIN',
        getNotes: () => seq.pattern.polyNotes,
        setNotes: (notes) => { seq.pattern.polyNotes = notes; },
        trackId: 'main',
      });
      pianoRoll = mainRollEntry.handle;
    } else {
      renderMainPolyStepRow();
      mainRollEntry = null;
    }
  } else {
    // Show only the active extra lane
    const track = seq.pattern.extraPolyTracks.find((t) => t.id === currentSynthLane);
    if (track) {
      const ctrl = document.createElement('div');
      ctrl.style.display = 'flex'; ctrl.style.gap = '4px';
      const toggle = document.createElement('button');
      toggle.className = 'enable' + (track.enabled ? ' active' : '');
      toggle.textContent = track.enabled ? 'ON' : 'OFF';
      toggle.style.fontSize = '9px'; toggle.style.padding = '2px 4px';
      toggle.addEventListener('click', () => {
        track.enabled = !track.enabled;
        toggle.classList.toggle('active', track.enabled);
        toggle.textContent = track.enabled ? 'ON' : 'OFF';
      });
      ctrl.appendChild(toggle);
      const labelText = track.name.slice(0, 14);
      const entry = addPianoRollFor({
        parent: polyTracksEl,
        labelText,
        getNotes: () => track.notes,
        setNotes: (notes) => { track.notes = notes; },
        trailingControls: ctrl,
        trackId: track.id,
      });
      extraRolls.set(track.id, entry);
    }
  }

  // Re-apply active-edit highlight
  const activeLabel = $('poly-active-label').textContent ?? 'MAIN';
  document.querySelectorAll('.track-label.active-edit').forEach((el) => el.classList.remove('active-edit'));
  const node = document.querySelector(`.track-label[data-poly-target="${activeLabel}"]`);
  if (node) node.classList.add('active-edit');

  // Sync the target dropdown so empty/non-empty slot labels stay accurate
  refreshPolyTargetSelect();

  updatePager();
  rebuildRollsView();
}

// ── All Rolls view: stacked piano rolls of every lane ─────────────────────
const rollsRollEntries: RollEntry[] = [];
function rebuildRollsView() {
  const stackEl = document.getElementById('rolls-stack') as HTMLDivElement | null;
  if (!stackEl) return;
  stackEl.innerHTML = '';
  rollsRollEntries.length = 0;

  // Bass 303 — piano-mode or step-mode (round-trip via converters)
  const bassEntry = addPianoRollFor({
    parent: stackEl,
    labelText: seq.pattern.bassMode === 'piano' ? 'BASS' : 'BASS (step)',
    trackId: 'bass',
    getNotes: () => seq.pattern.bassMode === 'piano'
      ? seq.pattern.bassNotes
      : bassStepsToNotes(seq.pattern.bass),
    setNotes: (n) => {
      if (seq.pattern.bassMode === 'piano') seq.pattern.bassNotes = n;
      else seq.pattern.bass = notesToBassSteps(n, seq.pattern.length);
    },
  });
  rollsRollEntries.push(bassEntry);

  // Main poly
  const mainEntry = addPianoRollFor({
    parent: stackEl,
    labelText: seq.pattern.polyMode === 'piano' ? 'MAIN' : 'MAIN (step)',
    trackId: 'main',
    getNotes: () => seq.pattern.polyMode === 'piano'
      ? seq.pattern.polyNotes
      : stepsToNotes(seq.pattern.melody),
    setNotes: (n) => {
      if (seq.pattern.polyMode === 'piano') seq.pattern.polyNotes = n;
      else seq.pattern.melody = notesToPolySteps(n, seq.pattern.length);
    },
  });
  rollsRollEntries.push(mainEntry);

  // Extras
  for (const track of seq.pattern.extraPolyTracks) {
    const entry = addPianoRollFor({
      parent: stackEl,
      labelText: track.name.slice(0, 14),
      trackId: track.id,
      getNotes: () => track.notes,
      setNotes: (n) => { track.notes = n; },
    });
    rollsRollEntries.push(entry);
  }
}

// ── Dynamic synth tabs (MAIN + each extra + "+") ──────────────────────────
function rebuildSynthTabs() {
  const host = document.getElementById('synth-tabs');
  if (!host) return;
  host.innerHTML = '';

  const mkTab = (laneId: string, label: string) => {
    const b = document.createElement('button');
    b.className = 'tab synth-tab';
    b.dataset.tab = 'poly';
    b.dataset.synthLane = laneId;
    b.textContent = label;
    if (laneId === currentSynthLane) b.classList.add('active');
    b.addEventListener('click', () => setCurrentSynthLane(laneId));
    host.appendChild(b);
  };
  mkTab('main', 'MAIN');
  for (const track of seq.pattern.extraPolyTracks) {
    mkTab(track.id, track.name.slice(0, 12));
  }

  // Refresh ARP scope checkboxes (they depend on extras list)
  if (document.getElementById('poly-arp-controls')?.childElementCount) {
    buildArpUI();
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'tab synth-tab-add';
  addBtn.textContent = '+ Synth';
  addBtn.title = 'Add a new polysynth lane';
  addBtn.addEventListener('click', () => {
    const used = new Set(seq.pattern.extraPolyTracks.map((t) => t.id));
    const free = EXTRA_IDS.find((id) => !used.has(id));
    if (!free) { alert(`All ${EXTRA_IDS.length} extra polysynth slots are in use.`); return; }
    ensureExtraTrack(free);
    rebuildSynthTabs();
    rebuildMixer();
    setCurrentSynthLane(free);
  });
  host.appendChild(addBtn);
}

function setCurrentSynthLane(laneId: string) {
  currentSynthLane = laneId;
  // Switch the existing tab plumbing to show the poly page
  document.querySelectorAll<HTMLButtonElement>('button.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === 'poly' && t.dataset.synthLane === laneId);
  });
  // Also flip the active 303/drums/fx/auto tabs off
  document.querySelectorAll<HTMLButtonElement>('button.tab').forEach((t) => {
    if (!t.dataset.synthLane && t.dataset.tab !== 'poly') t.classList.remove('active');
  });
  document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
    p.hidden = p.dataset.page !== 'poly';
  });
  // Move active edit to this lane's PolySynth + matching engine instance
  if (laneId === 'main') {
    setActivePolyTarget(polysynth, 'MAIN');
  } else {
    const id = laneId as ExtraId;
    const track = ensureExtraTrack(id);
    setActivePolyTarget(ensureExtraPoly(id), track.name);
  }
  rebuildPolyTrack();
}

function renderMainPolyStepRow() {

  const { start, end } = visibleRange();
  const count = end - start;
  polyTracksEl.style.setProperty('--steps', String(count));

  const row = document.createElement('div');
  row.className = 'track melody-track';
  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = 'POLYSYNTH';
  row.appendChild(label);
  const cellsEl = document.createElement('div');
  cellsEl.className = 'cells melody-cells';
  row.appendChild(cellsEl);

  for (let i = start; i < end; i++) {
    const step = seq.melody[i];
    const cell = document.createElement('div');
    cell.className = 'bcell mcell';
    if (i > start && (i - start) % 16 === 0) cell.classList.add('seg-start');

    const noteSel = document.createElement('select');
    noteSel.className = 'note-sel';
    const rootNote = step.notes[0] ?? 60;
    for (let m = 36; m <= 84; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = midiLabel(m);
      if (m === rootNote) opt.selected = true;
      noteSel.appendChild(opt);
    }
    noteSel.addEventListener('change', () => {
      const newRoot = parseInt(noteSel.value, 10);
      const oldRoot = step.notes[0] ?? newRoot;
      const delta = newRoot - oldRoot;
      step.notes = step.notes.length === 0 ? [newRoot] : step.notes.map((n) => n + delta);
    });

    // Chord cycle button: mono (1) → triad (3) → tetrad (4) → mono. Triad shape
    // is minor by default (root + minor 3rd + perfect 5th), tetrad adds minor 7th.
    // When user changes the root note (above), all chord notes shift to keep the
    // shape — so you build a chord once and modulate the root freely.
    const chordBtn = document.createElement('button');
    chordBtn.className = 'toggle chord';
    const renderChordBtn = () => {
      const n = step.notes.length === 4 ? 4 : step.notes.length === 3 ? 3 : 1;
      chordBtn.textContent = n === 1 ? '♪1' : n === 3 ? '♪3' : '♪4';
      chordBtn.classList.toggle('active', n > 1);
    };
    chordBtn.addEventListener('click', () => {
      const root = step.notes[0] ?? 60;
      const cur = step.notes.length === 4 ? 4 : step.notes.length === 3 ? 3 : 1;
      const next = cur === 1 ? 3 : cur === 3 ? 4 : 1;
      if (next === 1) step.notes = [root];
      else if (next === 3) step.notes = [root, root + 3, root + 7];
      else step.notes = [root, root + 3, root + 7, root + 10];
      renderChordBtn();
    });
    renderChordBtn();

    const mkToggle = (label: string, key: 'on' | 'accent' | 'tie') => {
      const b = document.createElement('button');
      b.className = `toggle ${key === 'tie' ? 'slide' : key}`;
      b.textContent = label;
      if (step[key]) b.classList.add('active');
      b.addEventListener('click', () => {
        step[key] = !step[key];
        b.classList.toggle('active', step[key]);
      });
      return b;
    };

    const onBtn = mkToggle('●', 'on');
    const accentBtn = mkToggle('A', 'accent');
    const tieBtn = mkToggle('T', 'tie');
    cell.appendChild(noteSel);
    cell.appendChild(onBtn);
    cell.appendChild(accentBtn);
    cell.appendChild(tieBtn);
    cell.appendChild(chordBtn);
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1);
    cell.appendChild(num);

    cellsEl.appendChild(cell);
    melodyCells[i] = { el: cell, noteSel, onBtn, accentBtn, tieBtn, chordBtn };
  }
  polyTracksEl.appendChild(row);
}

function cycleDrumStep(s: DrumStep) {
  if (!s.on) { s.on = true; s.accent = false; }
  else if (!s.accent) { s.accent = true; }
  else { s.on = false; s.accent = false; s.roll = 0; }
}

function cycleDrumRoll(s: DrumStep) {
  // Roll only makes sense on a hit; if cell is off, just turn it on first.
  if (!s.on) { s.on = true; s.accent = false; }
  const cur = s.roll ?? 0;
  s.roll = cur === 0 ? 2 : cur === 2 ? 4 : 0;
}

function applyDrumCellState(b: HTMLButtonElement, s: DrumStep) {
  b.classList.toggle('on', s.on && !s.accent);
  b.classList.toggle('accent', s.on && s.accent);
  b.classList.toggle('roll-2', !!s.on && s.roll === 2);
  b.classList.toggle('roll-4', !!s.on && s.roll === 4);
}

function refreshAllCellsFromState() {
  const { start, end } = visibleRange();
  for (let i = start; i < end; i++) {
    const c = bassCells[i];
    if (c) {
      const step = seq.bass[i];
      c.noteSel.value = String(step.note);
      c.onBtn.classList.toggle('active', step.on);
      c.accentBtn.classList.toggle('active', step.accent);
      c.slideBtn.classList.toggle('active', step.slide);
    }
    const mc = melodyCells[i];
    if (mc) {
      const mstep = seq.melody[i];
      mc.noteSel.value = String(mstep.notes[0] ?? 60);
      mc.onBtn.classList.toggle('active', mstep.on);
      mc.accentBtn.classList.toggle('active', mstep.accent);
      mc.tieBtn.classList.toggle('active', mstep.tie);
      const n = mstep.notes.length === 4 ? 4 : mstep.notes.length === 3 ? 3 : 1;
      mc.chordBtn.textContent = n === 1 ? '♪1' : n === 3 ? '♪3' : '♪4';
      mc.chordBtn.classList.toggle('active', n > 1);
    }
    for (const lane of DRUM_LANES) {
      const b = drumCells[lane][i];
      if (b) applyDrumCellState(b, seq.drums[lane][i]);
    }
  }
}

function refreshKnobsFromSynth() {
  for (const id of KNOB_IDS) synthKnobs[id]?.setValue(synth.params[id]);
}

// ── Mixer ──────────────────────────────────────────────────────────────────
const fmtPan = (v: number) => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;

const mixerDeps: import('./mixer').MixerColumnDeps = {
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

// ── Transport ──────────────────────────────────────────────────────────────
playBtn.addEventListener('click', () => {
  void ctx.resume();
  if (seq.isPlaying()) {
    seq.stop();
    playBtn.textContent = '▶';
    for (const i of Object.keys(bassCells)) bassCells[+i].el.classList.remove('current');
    for (const i of Object.keys(melodyCells)) melodyCells[+i].el.classList.remove('current');
    for (const lane of DRUM_LANES) for (const i of Object.keys(drumCells[lane])) drumCells[lane][+i].classList.remove('current');
  } else {
    resetAutomationPosition();
    seq.start();
    playBtn.textContent = '■';
  }
});

seq.onStep = (i) => {
  // Highlight only cells in current view
  const { start, end } = visibleRange();
  for (let j = start; j < end; j++) {
    const c = bassCells[j];
    if (c) c.el.classList.toggle('current', i === j);
    const mc = melodyCells[j];
    if (mc) mc.el.classList.toggle('current', i === j);
    for (const lane of DRUM_LANES) {
      const b = drumCells[lane][j];
      if (b) b.classList.toggle('current', i === j);
    }
  }
};

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

// Chain mode: at end of pattern, advance to next slot (A→B→C→D→A...) and
// keep playing. Overrides LOOP while active (loop is force-off internally).
let chainEnabled = false;
let chainSavedLoopState = true;

// Loop toggle in transport
const loopBtn = $<HTMLButtonElement>('loop-toggle');
function refreshLoopBtn() {
  loopBtn.classList.toggle('primary', seq.loopEnabled);
  loopBtn.textContent = seq.loopEnabled ? '↻ LOOP' : '⤳ ONESHOT';
  loopBtn.disabled = chainEnabled;
  loopBtn.style.opacity = chainEnabled ? '0.4' : '';
}
loopBtn.addEventListener('click', () => {
  seq.loopEnabled = !seq.loopEnabled;
  refreshLoopBtn();
});
refreshLoopBtn();

const chainBtn = $<HTMLButtonElement>('chain-toggle');
function refreshChainBtn() {
  chainBtn.classList.toggle('primary', chainEnabled);
  chainBtn.textContent = chainEnabled ? '→ CHAIN' : '→ chain';
}
chainBtn.addEventListener('click', () => {
  chainEnabled = !chainEnabled;
  if (chainEnabled) {
    chainSavedLoopState = seq.loopEnabled;
    seq.loopEnabled = false;
  } else {
    seq.loopEnabled = chainSavedLoopState;
  }
  refreshChainBtn();
  refreshLoopBtn();
});
refreshChainBtn();

seq.onEnded = () => {
  if (chainEnabled) {
    const next = (bank.current + 1) % bank.slots.length;
    switchSlot(next);
    // switchSlot queues when playing — but we just stopped, so trigger it inline.
    if (!seq.isPlaying()) seq.start();
    return;
  }
  playBtn.textContent = '▶';
};

swingInput.addEventListener('input', () => { seq.swing = parseFloat(swingInput.value); });

volInput.addEventListener('input', () => { master.gain.value = parseFloat(volInput.value); });
master.gain.value = parseFloat(volInput.value);

waveSel.addEventListener('change', () => { synth.params.wave = waveSel.value as Wave; });

barsSel.addEventListener('change', () => {
  seq.setLength(parseInt(barsSel.value, 10));
  viewStart = 0;
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

// ── Pager ──────────────────────────────────────────────────────────────────
$('page-prev').addEventListener('click', () => {
  if (viewStart >= VIEW_SIZE) { viewStart -= VIEW_SIZE; rebuildTracks(); }
});
$('page-next').addEventListener('click', () => {
  if (viewStart + VIEW_SIZE < seq.length) { viewStart += VIEW_SIZE; rebuildTracks(); }
});

// ── Pattern slots (musical queue: swap at next loop boundary) ──────────────
let pendingSlotIdx: number | null = null;

function switchSlot(newIdx: number) {
  if (newIdx === bank.current && pendingSlotIdx === null) return;
  // Save edits to current slot immediately (even if swap is queued)
  bank.slots[bank.current] = clonePattern(seq.pattern);
  if (!seq.isPlaying()) {
    // Not playing — swap right now
    bank.current = newIdx;
    seq.setPattern(bank.slots[newIdx]);
    barsSel.value = String(seq.length);
    viewStart = 0;
    rebuildTracks();
    updateSlotButtons();
    renderLanes();
    syncEngineToPattern();
  } else {
    // Playing — queue the swap, it'll happen at the next loop start
    pendingSlotIdx = newIdx;
    seq.queuePattern(bank.slots[newIdx]);
    updateSlotButtons();
  }
}

function updateSlotButtons() {
  $$('button.slot').forEach((b) => {
    const idx = parseInt(b.dataset.slot ?? '0', 10);
    b.classList.toggle('active', idx === bank.current);
    b.classList.toggle('pending', idx === pendingSlotIdx);
  });
}

seq.onPatternChange = () => {
  if (pendingSlotIdx !== null) {
    bank.current = pendingSlotIdx;
    pendingSlotIdx = null;
    barsSel.value = String(seq.length);
    viewStart = 0;
    rebuildTracks();
    updateSlotButtons();
    renderLanes();
    updateBassModeButtons();
    syncEngineToPattern();
    rebuildSynthTabs();
  }
};

$$('button.slot').forEach((b) => {
  b.addEventListener('click', () => switchSlot(parseInt(b.dataset.slot ?? '0', 10)));
});

// Pre-populate the bank's slot 0 with the sequencer's initial pattern (set up below)
// Done after setupInitialPattern.

// ── Randomize / Clear ──────────────────────────────────────────────────────
function currentRandomBase(): RandomizeOptions {
  return { scale: scaleSel.value as ScaleName, rootNote: parseInt(rootSel.value, 10) };
}

// ── Per-lane randomize helpers (replaces the old global toolbar) ──────────
function randomizeBassNotes() {
  const base = currentRandomBase();
  randomize(seq, synth, { ...base, bassNotes: true, accents: true, slides: true });
  refreshAllCellsFromState();
  if (bassRollEntry) bassRollEntry.handle.redraw();
}
function randomizeBassSound() {
  const base = currentRandomBase();
  randomize(seq, synth, { ...base, mod: true });
  refreshKnobsFromSynth();
}
function randomizeDrumsLane() {
  const base = currentRandomBase();
  randomize(seq, synth, { ...base, drums: true });
  refreshAllCellsFromState();
}
// Random notes for a single poly lane: scale-aware, sparse, musical.
function randomizePolyLaneNotes(laneId: string) {
  const scale = scaleSel.value as ScaleName;
  const root  = parseInt(rootSel.value, 10);
  // Scale intervals; same set used by random.ts
  const SCALE_INTERVALS: Record<string, number[]> = {
    major:     [0,2,4,5,7,9,11],
    minor:     [0,2,3,5,7,8,10],
    pentMinor: [0,3,5,7,10],
    phrygian:  [0,1,3,5,7,8,10],
    chromatic: [0,1,2,3,4,5,6,7,8,9,10,11],
  };
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.pentMinor;
  // Random note from scale around `root + 24` for poly range
  const pickMidi = () => {
    const oct = Math.floor(Math.random() * 3); // 0..2 octaves above root
    const iv  = intervals[Math.floor(Math.random() * intervals.length)];
    return root + 36 + oct * 12 + iv;
  };
  const len = seq.pattern.length;
  if (laneId === 'main') {
    if (seq.pattern.polyMode === 'piano') {
      // Sparse piano-roll: ~30% step density, notes of 1-2 steps duration
      const out: NoteEvent[] = [];
      for (let i = 0; i < len; i++) {
        if (Math.random() < 0.3) {
          out.push({
            start: i * TICKS_PER_STEP,
            duration: TICKS_PER_STEP * (Math.random() < 0.3 ? 2 : 1),
            midi: pickMidi(),
            velocity: Math.random() < 0.25 ? 115 : 80,
          });
        }
      }
      seq.pattern.polyNotes = out;
    } else {
      // Step mode: fill melody[] array
      for (let i = 0; i < len; i++) {
        const on = Math.random() < 0.35;
        seq.pattern.melody[i] = {
          on,
          notes: on ? [pickMidi()] : [60],
          accent: on && Math.random() < 0.2,
          tie: on && Math.random() < 0.1,
        };
      }
    }
  } else {
    const track = seq.pattern.extraPolyTracks.find((t) => t.id === laneId);
    if (!track) return;
    const out: NoteEvent[] = [];
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.3) {
        out.push({
          start: i * TICKS_PER_STEP,
          duration: TICKS_PER_STEP * (Math.random() < 0.3 ? 2 : 1),
          midi: pickMidi(),
          velocity: Math.random() < 0.25 ? 115 : 80,
        });
      }
    }
    track.notes = out;
  }
  rebuildPolyTrack();
  rebuildRollsView();
}

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
  viewStart = 0;

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
// Sweet Dreams-inspired demo: 4 slots × 4 bars (64 steps), key of C minor.
// The iconic Eurythmics bass riff is two notes alternating: C and A♭ (♭6) one
// octave below. Eighth-note feel: C C C C - A♭ A♭ A♭ A♭ - repeat.
// MIDI roots: C2 = 36, A♭1 = 32, B♭1 = 34, G1 = 31, E♭2 = 39, F2 = 41.


// Real bass riff transcribed from the Sweet Dreams MIDI (Track 8, Synth Bass).
// 8th-note pattern over 2 bars (32 16th-steps), C minor, octave: C2/Eb2/Ab1/G1.
const SWEET_BASS_2BAR: Array<{ i: number; note: number }> = [
  { i: 0,  note: 36 }, { i: 2,  note: 36 }, { i: 4,  note: 36 }, { i: 6,  note: 36 },
  { i: 8,  note: 39 }, { i: 10, note: 39 }, { i: 12, note: 36 }, { i: 14, note: 36 },
  { i: 16, note: 32 }, { i: 18, note: 32 }, { i: 20, note: 32 }, { i: 22, note: 36 },
  { i: 24, note: 31 }, { i: 26, note: 31 }, { i: 28, note: 31 }, { i: 30, note: 36 },
];

// "Sweet dreams are made of this" hook (Track 2). Eb5-D5-C5-D5-Eb5-C5(long).
const SWEET_HOOK_1BAR: Array<{ i: number; note: number; tie?: boolean }> = [
  { i: 0,  note: 75 },                    // Eb5
  { i: 3,  note: 74 },                    // D5
  { i: 5,  note: 72 },                    // C5
  { i: 8,  note: 74, tie: true },         // D5 long
  { i: 12, note: 75 },                    // Eb5
  { i: 14, note: 72, tie: true },         // C5 long
];

// Cm chord (from track 1 chord track): C4 + Eb4 + G#4
const CM_CHORD = [60, 63, 68];

function fillSweetSlot(slot: PatternData, parts: {
  drum: 'silent' | 'verse' | 'chorus' | 'breakdown';
  bass: boolean;
  hook: 'none' | 'mono' | 'octave';
  chord: boolean;
}) {
  const N = 64; // 4 bars
  slot.length = N;
  slot.bass.length = N;
  slot.melody.length = N;
  for (const lane of DRUM_LANES) slot.drums[lane].length = N;
  for (let i = 0; i < N; i++) {
    slot.bass[i]   = { on: false, note: 36, accent: false, slide: false };
    slot.melody[i] = { on: false, notes: [60], accent: false, tie: false };
    for (const lane of DRUM_LANES) slot.drums[lane][i] = { on: false, accent: false };
  }

  // Bass: tile the 2-bar riff twice across 4 bars
  if (parts.bass) {
    for (let rep = 0; rep < 2; rep++) {
      for (const s of SWEET_BASS_2BAR) {
        const idx = rep * 32 + s.i;
        Object.assign(slot.bass[idx], { on: true, note: s.note, accent: s.i === 0 });
      }
    }
  }

  // Drums: classic LinnDrum-style 4-on-the-floor + backbeat snare
  if (parts.drum !== 'silent') {
    for (let b = 0; b < 4; b++) {
      const off = b * 16;
      if (parts.drum === 'breakdown') {
        if (b % 2 === 0) slot.drums.kick[off].on = true;
        slot.drums.closedHat[off + 4].on = true;
        slot.drums.closedHat[off + 12].on = true;
      } else {
        [0, 4, 8, 12].forEach((i) => { slot.drums.kick[off + i].on = true; });
        [4, 12].forEach((i) => { slot.drums.snare[off + i].on = true; });
        for (let i = 0; i < 16; i++) {
          if (parts.drum === 'chorus' || i % 2 === 0) slot.drums.closedHat[off + i].on = true;
        }
        if (parts.drum === 'chorus') {
          slot.drums.clap[off + 4].on = true;
          slot.drums.clap[off + 12].on = true;
          slot.drums.openHat[off + 6].on = true;
          if (b === 3) slot.drums.snare[off + 14].roll = 4, slot.drums.snare[off + 14].on = true;
        }
      }
    }
  }

  // Hook melody: place at bar 0 and bar 2 so it's heard immediately on play
  if (parts.hook !== 'none') {
    for (const barOff of [0, 32]) {
      for (const h of SWEET_HOOK_1BAR) {
        const idx = barOff + h.i;
        if (idx >= N) continue;
        const baseNote = h.note;
        const notes = parts.hook === 'octave' ? [baseNote - 12, baseNote] : [baseNote];
        Object.assign(slot.melody[idx], { on: true, notes, accent: h.i === 0, tie: !!h.tie });
      }
    }
  }

  // Sustained Cm chord pad — held across bars 0 and 2
  if (parts.chord) {
    for (const barOff of [0, 32]) {
      Object.assign(slot.melody[barOff], { on: true, notes: [...CM_CHORD], accent: false, tie: true });
    }
  }
}

function setupInitialPattern() {
  // 4 slots × 4 bars each, all using the real Sweet Dreams bass + hook from MIDI.
  fillSweetSlot(bank.slots[0], { drum: 'silent',     bass: true,  hook: 'none',   chord: false }); // A - intro: bass solo
  fillSweetSlot(bank.slots[1], { drum: 'verse',      bass: true,  hook: 'mono',   chord: false }); // B - verse + hook
  fillSweetSlot(bank.slots[2], { drum: 'chorus',     bass: true,  hook: 'octave', chord: true  }); // C - chorus full
  fillSweetSlot(bank.slots[3], { drum: 'breakdown',  bass: true,  hook: 'none',   chord: true  }); // D - breakdown w/ pad

  // Default to slot B (verse with everything playing) so play is instantly recognizable.
  bank.current = 1;
  seq.setPattern(bank.slots[1]);

  // Sensible default sends
  drums.channels.snare.setReverbSend(0.25);
  drums.channels.clap.setReverbSend(0.35);
  drums.channels.openHat.setReverbSend(0.2);
  drums.channels.ride.setReverbSend(0.3);
  drums.channels.tom.setReverbSend(0.2);
  bassStrip.setReverbSend(0.1);
  polyStrip.setReverbSend(0.25);
  polyStrip.setDelaySend(0.15);
}

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
// `activePolyTarget` is the polysynth currently being edited by the OSC /
// FILTER / AMP / LFO knobs. Click a piano-roll track header to switch.
let activePolyTarget: PolySynth = polysynth;
const polyKnobs: KnobHandle[] = [];
const refreshFns: Array<() => void> = [];

function addPolyKnob(parent: HTMLElement, opts: Parameters<typeof createKnob>[0], getCurrent: () => number) {
  // Auto-derive an automation id if not supplied: 'poly.<section>.<label>' from
  // the parent container's id (e.g. 'poly-osc1-knobs') + the knob's label.
  if (!opts.id && opts.label) {
    const sec = parent.id.replace(/^poly-/, '').replace(/-knobs$/, '').replace('-', '');
    const lab = opts.label.toLowerCase().replace(/[^a-z0-9]+/g, '');
    opts.id = `poly.${sec}.${lab}`;
  }
  const k = createKnob(opts);
  parent.appendChild(k.el);
  polyKnobs.push(k);
  refreshFns.push(() => k.setValue(getCurrent()));
  registerKnob(k);
  return k;
}

function addPolySelect(parent: HTMLElement, label: string, options: Array<{ value: string; label: string }>, getCurrent: () => string, onChange: (v: string) => void) {
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  const lab = document.createElement('div');
  lab.className = 'knob-label';
  lab.textContent = label;
  wrap.appendChild(lab);
  const sel = document.createElement('select');
  sel.className = 'poly-wave-sel';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === getCurrent()) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  parent.appendChild(wrap);
  refreshFns.push(() => { sel.value = getCurrent(); });
}

function refreshPolyKnobsFromState() {
  for (const fn of refreshFns) fn();
}

const WAVE_OPTS = [
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square',   label: 'Sqr' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sine',     label: 'Sin' },
];

function buildPolySynthUI() {
  const osc1Row  = $<HTMLDivElement>('poly-osc1-knobs');
  const osc2Row  = $<HTMLDivElement>('poly-osc2-knobs');
  const subRow   = $<HTMLDivElement>('poly-sub-knobs');
  const noiseRow = $<HTMLDivElement>('poly-noise-knobs');
  const filtRow  = $<HTMLDivElement>('poly-filter-knobs');
  const ampRow   = $<HTMLDivElement>('poly-amp-knobs');
  const masterRow= $<HTMLDivElement>('poly-master-knobs');
  const lfo1Row  = $<HTMLDivElement>('poly-lfo1-knobs');
  const lfo2Row  = $<HTMLDivElement>('poly-lfo2-knobs');

  const SIZE = 44;
  const oscColor = '#e67e22';
  const subColor = '#9b59b6';
  const noiseColor = '#7f8c8d';
  const filtColor = '#16a085';
  const ampColor = '#2ecc71';
  const lfoColor = '#3498db';
  const masterColor = '#f7d000';

  // OSC 1
  addPolySelect(osc1Row, 'WAVE', WAVE_OPTS, () => activePolyTarget.params.osc1.wave,
    (v) => { activePolyTarget.params.osc1.wave = v as OscillatorType; });
  addPolyKnob(osc1Row, { min: 0, max: 1, step: 0.01, value: activePolyTarget.params.osc1.level, defaultValue: 0.6,
    label: 'LEVEL', color: oscColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.osc1.level = v; }, }, () => activePolyTarget.params.osc1.level);
  addPolyKnob(osc1Row, { min: -2, max: 2, step: 1, value: activePolyTarget.params.osc1.octave, defaultValue: 0,
    label: 'OCT', color: oscColor, size: SIZE, format: fmtOct,
    onChange: (v) => { activePolyTarget.params.osc1.octave = v; }, }, () => activePolyTarget.params.osc1.octave);
  addPolyKnob(osc1Row, { min: -12, max: 12, step: 1, value: activePolyTarget.params.osc1.semi, defaultValue: 0,
    label: 'SEMI', color: oscColor, size: SIZE, format: fmtOct,
    onChange: (v) => { activePolyTarget.params.osc1.semi = v; }, }, () => activePolyTarget.params.osc1.semi);
  addPolyKnob(osc1Row, { min: -100, max: 100, step: 1, value: activePolyTarget.params.osc1.detune, defaultValue: 0,
    label: 'DETUNE', color: oscColor, size: SIZE, format: fmtCents,
    onChange: (v) => { activePolyTarget.params.osc1.detune = v; }, }, () => activePolyTarget.params.osc1.detune);

  // OSC 2
  addPolySelect(osc2Row, 'WAVE', WAVE_OPTS, () => activePolyTarget.params.osc2.wave,
    (v) => { activePolyTarget.params.osc2.wave = v as OscillatorType; });
  addPolyKnob(osc2Row, { min: 0, max: 1, step: 0.01, value: activePolyTarget.params.osc2.level, defaultValue: 0.4,
    label: 'LEVEL', color: oscColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.osc2.level = v; }, }, () => activePolyTarget.params.osc2.level);
  addPolyKnob(osc2Row, { min: -2, max: 2, step: 1, value: activePolyTarget.params.osc2.octave, defaultValue: 0,
    label: 'OCT', color: oscColor, size: SIZE, format: fmtOct,
    onChange: (v) => { activePolyTarget.params.osc2.octave = v; }, }, () => activePolyTarget.params.osc2.octave);
  addPolyKnob(osc2Row, { min: -12, max: 12, step: 1, value: activePolyTarget.params.osc2.semi, defaultValue: 0,
    label: 'SEMI', color: oscColor, size: SIZE, format: fmtOct,
    onChange: (v) => { activePolyTarget.params.osc2.semi = v; }, }, () => activePolyTarget.params.osc2.semi);
  addPolyKnob(osc2Row, { min: -100, max: 100, step: 1, value: activePolyTarget.params.osc2.detune, defaultValue: 7,
    label: 'DETUNE', color: oscColor, size: SIZE, format: fmtCents,
    onChange: (v) => { activePolyTarget.params.osc2.detune = v; }, }, () => activePolyTarget.params.osc2.detune);

  // SUB
  addPolyKnob(subRow, { min: 0, max: 1, step: 0.01, value: activePolyTarget.params.sub.level, defaultValue: 0.3,
    label: 'LEVEL', color: subColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.sub.level = v; }, }, () => activePolyTarget.params.sub.level);
  addPolyKnob(subRow, { min: -2, max: -1, step: 1, value: activePolyTarget.params.sub.octave, defaultValue: -1,
    label: 'OCT', color: subColor, size: SIZE, format: fmtOct,
    onChange: (v) => { activePolyTarget.params.sub.octave = v; }, }, () => activePolyTarget.params.sub.octave);

  // NOISE
  addPolyKnob(noiseRow, { min: 0, max: 1, step: 0.01, value: activePolyTarget.params.noise.level, defaultValue: 0,
    label: 'LEVEL', color: noiseColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.noise.level = v; }, }, () => activePolyTarget.params.noise.level);
  addPolyKnob(noiseRow, { min: 0, max: 1, step: 0.01, value: activePolyTarget.params.noise.color, defaultValue: 0.6,
    label: 'COLOR', color: noiseColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.noise.color = v; }, }, () => activePolyTarget.params.noise.color);

  // FILTER
  addPolySelect(filtRow, 'TYPE',
    [{ value: 'lowpass', label: 'LP' }, { value: 'highpass', label: 'HP' }, { value: 'bandpass', label: 'BP' }],
    () => activePolyTarget.params.filter.type, (v) => { activePolyTarget.params.filter.type = v as 'lowpass' | 'highpass' | 'bandpass'; });
  addPolyKnob(filtRow, { id: 'poly.filter.cutoff', min: 0, max: 1, step: 0.001, value: activePolyTarget.params.filter.cutoff, defaultValue: 0.55,
    label: 'CUTOFF', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.filter.cutoff = v; }, }, () => activePolyTarget.params.filter.cutoff);
  addPolyKnob(filtRow, { id: 'poly.filter.resonance', min: 0, max: 1, step: 0.001, value: activePolyTarget.params.filter.resonance, defaultValue: 0.25,
    label: 'RES', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.filter.resonance = v; }, }, () => activePolyTarget.params.filter.resonance);
  addPolyKnob(filtRow, { id: 'poly.filter.envAmount', min: 0, max: 1, step: 0.001, value: activePolyTarget.params.filter.envAmount, defaultValue: 0.45,
    label: 'ENV', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.filter.envAmount = v; }, }, () => activePolyTarget.params.filter.envAmount);
  addPolyKnob(filtRow, { min: 0, max: 1, step: 0.01, value: activePolyTarget.params.filter.keyTrack, defaultValue: 0,
    label: 'KEY TRK', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.filter.keyTrack = v; }, }, () => activePolyTarget.params.filter.keyTrack);
  addPolyKnob(filtRow, { id: 'poly.filter.drive', min: 0, max: 1, step: 0.01, value: activePolyTarget.params.filter.drive, defaultValue: 0,
    label: 'DRIVE', color: '#c0392b', size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.filter.drive = v; }, }, () => activePolyTarget.params.filter.drive);
  addPolyKnob(filtRow, { min: 0.001, max: 2, step: 0.001, value: activePolyTarget.params.filter.attack, defaultValue: 0.01,
    label: 'ATK', color: filtColor, size: SIZE, format: fmtSec,
    onChange: (v) => { activePolyTarget.params.filter.attack = v; }, }, () => activePolyTarget.params.filter.attack);
  addPolyKnob(filtRow, { min: 0.001, max: 2, step: 0.001, value: activePolyTarget.params.filter.decay, defaultValue: 0.3,
    label: 'DEC', color: filtColor, size: SIZE, format: fmtSec,
    onChange: (v) => { activePolyTarget.params.filter.decay = v; }, }, () => activePolyTarget.params.filter.decay);
  addPolyKnob(filtRow, { min: 0, max: 1, step: 0.01, value: activePolyTarget.params.filter.sustain, defaultValue: 0.4,
    label: 'SUS', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.filter.sustain = v; }, }, () => activePolyTarget.params.filter.sustain);
  addPolyKnob(filtRow, { min: 0.001, max: 3, step: 0.001, value: activePolyTarget.params.filter.release, defaultValue: 0.35,
    label: 'REL', color: filtColor, size: SIZE, format: fmtSec,
    onChange: (v) => { activePolyTarget.params.filter.release = v; }, }, () => activePolyTarget.params.filter.release);

  // AMP
  addPolyKnob(ampRow, { min: 0.001, max: 2, step: 0.001, value: activePolyTarget.params.amp.attack, defaultValue: 0.01,
    label: 'ATK', color: ampColor, size: SIZE, format: fmtSec,
    onChange: (v) => { activePolyTarget.params.amp.attack = v; }, }, () => activePolyTarget.params.amp.attack);
  addPolyKnob(ampRow, { min: 0.001, max: 2, step: 0.001, value: activePolyTarget.params.amp.decay, defaultValue: 0.2,
    label: 'DEC', color: ampColor, size: SIZE, format: fmtSec,
    onChange: (v) => { activePolyTarget.params.amp.decay = v; }, }, () => activePolyTarget.params.amp.decay);
  addPolyKnob(ampRow, { min: 0, max: 1, step: 0.01, value: activePolyTarget.params.amp.sustain, defaultValue: 0.7,
    label: 'SUS', color: ampColor, size: SIZE, format: fmtPct,
    onChange: (v) => { activePolyTarget.params.amp.sustain = v; }, }, () => activePolyTarget.params.amp.sustain);
  addPolyKnob(ampRow, { min: 0.001, max: 3, step: 0.001, value: activePolyTarget.params.amp.release, defaultValue: 0.3,
    label: 'REL', color: ampColor, size: SIZE, format: fmtSec,
    onChange: (v) => { activePolyTarget.params.amp.release = v; }, }, () => activePolyTarget.params.amp.release);

  // MASTER
  addPolyKnob(masterRow, { id: 'poly.master.tune', min: -24, max: 24, step: 1, value: activePolyTarget.params.master.tune, defaultValue: 0,
    label: 'TUNE', color: masterColor, size: SIZE, format: fmtOct,
    onChange: (v) => { activePolyTarget.params.master.tune = v; }, }, () => activePolyTarget.params.master.tune);

  // LFOs
  const LFO_TARGET_OPTS = [
    { value: 'off',    label: 'Off' },
    { value: 'pitch',  label: 'Pitch' },
    { value: 'cutoff', label: 'Cutoff' },
    { value: 'amp',    label: 'Amp' },
  ];
  for (const idx of [1, 2] as const) {
    const row = idx === 1 ? lfo1Row : lfo2Row;
    const lfo = () => activePolyTarget.params[`lfo${idx}` as 'lfo1' | 'lfo2'];
    addPolySelect(row, 'WAVE', WAVE_OPTS, () => lfo().wave, (v) => { lfo().wave = v as OscillatorType; });
    addPolySelect(row, 'TARGET', LFO_TARGET_OPTS, () => lfo().target, (v) => { lfo().target = v as LfoTarget; });
    addPolySelect(row, 'SYNC',
      [{ value:'free',label:'Free' },
       { value:'4/1',label:'4 bars' },{ value:'3/1',label:'3 bars' },{ value:'2/1',label:'2 bars' },{ value:'1/1',label:'1 bar' },
       { value:'1/2',label:'1/2' },{ value:'1/4',label:'1/4' },
       { value:'1/8.',label:'1/8.' },{ value:'1/8',label:'1/8' },{ value:'1/8t',label:'1/8t' },
       { value:'1/16',label:'1/16' },{ value:'1/16t',label:'1/16t' },{ value:'1/32',label:'1/32' }],
      () => lfo().sync ?? 'free', (v) => { lfo().sync = v as LfoSync; });
    addPolyKnob(row, { id: `poly.lfo${idx}.rate`, min: 0.01, max: 200, step: 0.01, value: lfo().rate, defaultValue: idx === 1 ? 4 : 0.5,
      label: 'RATE', color: lfoColor, size: SIZE,
      format: (v) => v < 1 ? `${v.toFixed(2)}Hz` : v < 100 ? `${v.toFixed(1)}Hz` : `${Math.round(v)}Hz`,
      onChange: (v) => { lfo().rate = v; }, }, () => lfo().rate);
    addPolyKnob(row, { id: `poly.lfo${idx}.depth`, min: 0, max: 1, step: 0.01, value: lfo().depth, defaultValue: 0,
      label: 'DEPTH', color: lfoColor, size: SIZE, format: fmtPct,
      onChange: (v) => { lfo().depth = v; }, }, () => lfo().depth);
  }
}

// ── Master FX tab (reverb + delay + stackable filter chain) ────────────────
const SYNC_OPTS: Array<{ value: SyncDiv; label: string }> = [
  { value: 'off',   label: 'Free' },
  { value: '4/1',   label: '4 bars' },
  { value: '3/1',   label: '3 bars' },
  { value: '2/1',   label: '2 bars' },
  { value: '1/1',   label: '1 bar' },
  { value: '1/2',   label: '1/2' },
  { value: '1/4',   label: '1/4' },
  { value: '1/8.',  label: '1/8.' },
  { value: '1/8',   label: '1/8' },
  { value: '1/8t',  label: '1/8t' },
  { value: '1/16',  label: '1/16' },
  { value: '1/16t', label: '1/16t' },
  { value: '1/32',  label: '1/32' },
];

let delaySyncDiv: SyncDiv = '1/8.';

function buildFxUI() {
  const revRow = $<HTMLDivElement>('fx-reverb-knobs');
  const dlyRow = $<HTMLDivElement>('fx-delay-knobs');
  const SIZE = 44;
  const revColor = '#9b59b6';
  const dlyColor = '#3498db';

  // REVERB
  addPolyKnob(revRow, { id: 'fx.reverb.wet', min: 0, max: 1, step: 0.01, value: fx.getReverbWet(), defaultValue: 0.9,
    label: 'WET', color: revColor, size: SIZE, format: fmtPct,
    onChange: (v) => fx.setReverbWet(v) }, () => fx.getReverbWet());
  addPolyKnob(revRow, { id: 'fx.reverb.size', min: 0.1, max: 6, step: 0.1, value: fx.getReverbSize(), defaultValue: 2.5,
    label: 'SIZE', color: revColor, size: SIZE, format: (v) => `${v.toFixed(1)}s`,
    onChange: (v) => fx.setReverbSize(v) }, () => fx.getReverbSize());
  addPolyKnob(revRow, { id: 'fx.reverb.decay', min: 0.5, max: 8, step: 0.1, value: fx.getReverbDecay(), defaultValue: 3,
    label: 'DECAY', color: revColor, size: SIZE, format: (v) => v.toFixed(1),
    onChange: (v) => fx.setReverbDecay(v) }, () => fx.getReverbDecay());
  addPolyKnob(revRow, { id: 'fx.reverb.predly', min: 0, max: 0.5, step: 0.005, value: fx.getReverbPredelay(), defaultValue: 0,
    label: 'PREDLY', color: revColor, size: SIZE, format: fmtSec,
    onChange: (v) => fx.setReverbPredelay(v) }, () => fx.getReverbPredelay());

  // DELAY
  addPolySelect(dlyRow, 'SYNC', SYNC_OPTS, () => delaySyncDiv, (v) => {
    delaySyncDiv = v as SyncDiv;
    applyDelaySync();
  });
  addPolyKnob(dlyRow, { id: 'fx.delay.feedback', min: 0, max: 0.95, step: 0.01, value: fx.getDelayFeedback(), defaultValue: 0.45,
    label: 'FBACK', color: dlyColor, size: SIZE, format: fmtPct,
    onChange: (v) => fx.setDelayFeedback(v) }, () => fx.getDelayFeedback());
  addPolyKnob(dlyRow, { id: 'fx.delay.wet', min: 0, max: 1, step: 0.01, value: fx.getDelayWet(), defaultValue: 0.8,
    label: 'WET', color: dlyColor, size: SIZE, format: fmtPct,
    onChange: (v) => fx.setDelayWet(v) }, () => fx.getDelayWet());
  addPolyKnob(dlyRow, { id: 'fx.delay.damp', min: 200, max: 16000, step: 50, value: fx.getDelayDamping(), defaultValue: 4500,
    label: 'DAMP', color: dlyColor, size: SIZE, format: (v) => `${Math.round(v)}Hz`,
    onChange: (v) => fx.setDelayDamping(v) }, () => fx.getDelayDamping());

  // Add Filter button
  $<HTMLButtonElement>('fx-add-filter').addEventListener('click', () => {
    const mf = filterChain.add();
    appendFilterRow(mf);
  });
}

function applyDelaySync() {
  const beatFractions: Record<SyncDiv, number> = {
    'off': 0.375,
    '4/1': 4, '3/1': 3, '2/1': 2, '1/1': 1,
    '1/2': 0.5, '1/4': 0.25, '1/8': 0.125, '1/8.': 0.1875, '1/8t': 1/12,
    '1/16': 0.0625, '1/16t': 1/24, '1/32': 0.03125,
  };
  const frac = beatFractions[delaySyncDiv];
  fx.setBpmSync(seq.bpm, frac);
}

function appendFilterRow(mf: MasterFilter) {
  const container = $<HTMLDivElement>('fx-filters');
  const row = document.createElement('div');
  row.className = 'fx-filter-row';

  const typeSel = document.createElement('select');
  typeSel.className = 'poly-wave-sel';
  for (const t of ['lowpass', 'highpass', 'bandpass', 'notch'] as BiquadFilterType[]) {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t.toUpperCase();
    if (t === mf.state.type) opt.selected = true;
    typeSel.appendChild(opt);
  }
  typeSel.addEventListener('change', () => mf.setType(typeSel.value as BiquadFilterType));
  const typeWrap = document.createElement('div'); typeWrap.className = 'knob';
  const typeLab = document.createElement('div'); typeLab.className = 'knob-label'; typeLab.textContent = 'TYPE';
  typeWrap.append(typeLab, typeSel);
  row.appendChild(typeWrap);

  const cutoffKnob = createKnob({
    min: 40, max: 18000, step: 1, value: mf.state.cutoff, defaultValue: 8000,
    label: 'CUTOFF', color: '#16a085', size: 44, format: (v) => `${Math.round(v)}Hz`,
    onChange: (v) => mf.setCutoff(v),
  });
  row.appendChild(cutoffKnob.el);

  const qKnob = createKnob({
    min: 0.1, max: 30, step: 0.1, value: mf.state.q, defaultValue: 1,
    label: 'Q', color: '#16a085', size: 44, format: (v) => v.toFixed(1),
    onChange: (v) => mf.setQ(v),
  });
  row.appendChild(qKnob.el);

  // LFO sub-section for this filter
  const lfoWaveSel = document.createElement('select');
  lfoWaveSel.className = 'poly-wave-sel';
  for (const o of WAVE_OPTS) {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === mf.state.lfoWave) opt.selected = true;
    lfoWaveSel.appendChild(opt);
  }
  const lwWrap = document.createElement('div'); lwWrap.className = 'knob';
  const lwLab = document.createElement('div'); lwLab.className = 'knob-label'; lwLab.textContent = 'LFO';
  lwWrap.append(lwLab, lfoWaveSel);
  row.appendChild(lwWrap);

  const syncSel = document.createElement('select');
  syncSel.className = 'poly-wave-sel';
  for (const s of SYNC_OPTS) {
    const opt = document.createElement('option');
    opt.value = s.value; opt.textContent = s.label;
    if (s.value === mf.state.lfoSync) opt.selected = true;
    syncSel.appendChild(opt);
  }
  const ssWrap = document.createElement('div'); ssWrap.className = 'knob';
  const ssLab = document.createElement('div'); ssLab.className = 'knob-label'; ssLab.textContent = 'SYNC';
  ssWrap.append(ssLab, syncSel);
  row.appendChild(ssWrap);

  const depthKnob = createKnob({
    min: 0, max: 1, step: 0.01, value: mf.state.lfoDepth, defaultValue: 0,
    label: 'DEPTH', color: '#3498db', size: 44, format: fmtPct,
    onChange: (v) => mf.setLfo(lfoWaveSel.value as OscillatorType, syncSel.value as SyncDiv, v, seq.bpm),
  });
  row.appendChild(depthKnob.el);
  lfoWaveSel.addEventListener('change', () => mf.setLfo(lfoWaveSel.value as OscillatorType, syncSel.value as SyncDiv, mf.state.lfoDepth, seq.bpm));
  syncSel.addEventListener('change', () => mf.setLfo(lfoWaveSel.value as OscillatorType, syncSel.value as SyncDiv, mf.state.lfoDepth, seq.bpm));

  const removeBtn = document.createElement('button');
  removeBtn.className = 'io';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove filter';
  removeBtn.addEventListener('click', () => {
    filterChain.remove(mf);
    row.remove();
  });
  row.appendChild(removeBtn);

  container.appendChild(row);
}

// ── Automation tab ─────────────────────────────────────────────────────────
// Each pattern carries a list of AutomationLanes. Each lane targets a
// registered knob (by id) and stores one normalized value per step. During
// playback we apply lane.values[step] → knob.setValue(denormalized).

type AutoBrush = 'line' | 'flat';
let autoBrush: AutoBrush = 'line';
let autoCurrentSubIdx = 0;  // current sub-step index for the playhead overlay
const laneCanvases: Array<{ paramId: string; draw: () => void }> = [];

// Ensure a lane's values array matches its own `lengthBars * 16 * SUB_RES`.
// Auto-migrates lanes saved in older formats (no lengthBars, or step-based).
function ensureLaneSize(lane: { values: number[]; stepped?: boolean; lengthBars?: number }) {
  // Old format had no lengthBars — derive from the data we have.
  if (lane.lengthBars == null) {
    if (lane.values.length === seq.length) {
      // Step-per-value (very old): default to current pattern length.
      lane.lengthBars = Math.max(1, seq.length / 16);
    } else if (lane.values.length === seq.length * AUTOMATION_SUB_RES) {
      // Sub-res-per-value (one revision ago): default to current pattern length.
      lane.lengthBars = Math.max(1, seq.length / 16);
    } else {
      lane.lengthBars = Math.max(1, seq.length / 16);
    }
  }
  const expected = lane.lengthBars * 16 * AUTOMATION_SUB_RES;
  if (lane.values.length === expected) return;
  // Step-per-value migration: expand to sub-res.
  if (lane.values.length === seq.length) {
    const expanded: number[] = [];
    for (let s = 0; s < seq.length; s++) {
      const v = lane.values[s];
      for (let r = 0; r < AUTOMATION_SUB_RES; r++) expanded.push(v);
    }
    lane.values = expanded;
  }
  // Pad or truncate to expected length.
  if (lane.values.length < expected) {
    const last = lane.values[lane.values.length - 1] ?? 0.5;
    while (lane.values.length < expected) lane.values.push(last);
  } else if (lane.values.length > expected) {
    lane.values.length = expected;
  }
}

function snapLaneToSteps(lane: { values: number[]; lengthBars?: number }) {
  const totalSteps = (lane.lengthBars ?? 1) * 16;
  for (let s = 0; s < totalSteps; s++) {
    const start = s * AUTOMATION_SUB_RES;
    if (start >= lane.values.length) break;
    const v = lane.values[start];
    for (let i = 1; i < AUTOMATION_SUB_RES && start + i < lane.values.length; i++) {
      lane.values[start + i] = v;
    }
  }
}

function populateAutoParamSelect() {
  const sel = $<HTMLSelectElement>('auto-param-select');
  sel.innerHTML = '';
  // Group by id prefix.
  const groups: Record<string, Array<{ id: string; label: string }>> = {};
  for (const [id, k] of automationRegistry) {
    const prefix = id.split('.')[0];
    (groups[prefix] = groups[prefix] || []).push({ id, label: k.meta.label ?? id });
  }
  const groupOrder = ['tb303', 'poly', 'fx', 'mix', 'main', ...EXTRA_IDS];
  const groupNames: Record<string, string> = {
    tb303: 'TB-303', poly: 'PolySynth (subtractive)', fx: 'Master FX', mix: 'Mixer',
    main: 'MAIN (engine)',
  };
  for (const id of EXTRA_IDS) groupNames[id] = `${LANE_LABELS[id]} (engine)`;
  for (const g of groupOrder) {
    if (!groups[g] || groups[g].length === 0) continue;
    const og = document.createElement('optgroup');
    og.label = groupNames[g] ?? g;
    for (const { id, label } of groups[g]) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${id}  —  ${label}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
}

function addLane(paramId: string) {
  const entry = automationRegistry.get(paramId);
  if (!entry) return;
  // New lane defaults to the current pattern length in bars. User can grow it
  // up to 32 bars from the lane header to get long, slow modulations.
  const lengthBars = Math.max(1, seq.length / 16);
  const total = lengthBars * 16 * AUTOMATION_SUB_RES;
  seq.pattern.automation.push({
    paramId,
    enabled: true,
    stepped: false,
    lengthBars,
    values: Array.from({ length: total }, () => 0.5),
  });
  renderLanes();
}

function removeLane(idx: number) {
  seq.pattern.automation.splice(idx, 1);
  renderLanes();
}

function renderLanes() {
  const container = $<HTMLDivElement>('auto-lanes');
  container.innerHTML = '';
  laneCanvases.length = 0;

  seq.pattern.automation.forEach((lane, idx) => {
    const entry = automationRegistry.get(lane.paramId);
    if (!entry) return;
    ensureLaneSize(lane);
    if (lane.stepped === undefined) lane.stepped = false;

    const wrap = document.createElement('div');
    wrap.className = 'auto-lane';

    const header = document.createElement('div');
    header.className = 'auto-lane-header';
    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = `${lane.paramId}  —  ${entry.meta.label ?? ''}`;
    const enableBtn = document.createElement('button');
    enableBtn.className = 'enable' + (lane.enabled ? ' active' : '');
    enableBtn.textContent = lane.enabled ? 'ON' : 'OFF';
    enableBtn.addEventListener('click', () => {
      lane.enabled = !lane.enabled;
      enableBtn.classList.toggle('active', lane.enabled);
      enableBtn.textContent = lane.enabled ? 'ON' : 'OFF';
    });
    const steppedBtn = document.createElement('button');
    steppedBtn.className = 'enable' + (lane.stepped ? ' active' : '');
    steppedBtn.textContent = lane.stepped ? 'Stepped' : 'Smooth';
    steppedBtn.title = 'Toggle smooth/step-snapped editing';
    steppedBtn.addEventListener('click', () => {
      lane.stepped = !lane.stepped;
      if (lane.stepped) snapLaneToSteps(lane);
      steppedBtn.classList.toggle('active', lane.stepped);
      steppedBtn.textContent = lane.stepped ? 'Stepped' : 'Smooth';
      draw();
    });
    const barsSel = document.createElement('select');
    barsSel.className = 'poly-wave-sel';
    barsSel.style.maxWidth = '70px';
    for (const b of [1, 2, 4, 8, 16, 32]) {
      const opt = document.createElement('option');
      opt.value = String(b);
      opt.textContent = `${b} bar${b > 1 ? 's' : ''}`;
      if (b === lane.lengthBars) opt.selected = true;
      barsSel.appendChild(opt);
    }
    barsSel.title = 'Lane length (independent of pattern length)';
    barsSel.addEventListener('change', () => {
      const newBars = parseInt(barsSel.value, 10);
      const newLen = newBars * 16 * AUTOMATION_SUB_RES;
      if (newLen > lane.values.length) {
        // Extend by repeating existing pattern so the new bars don't start empty.
        const oldLen = lane.values.length;
        while (lane.values.length < newLen) lane.values.push(lane.values[lane.values.length % oldLen]);
      } else {
        lane.values.length = newLen;
      }
      lane.lengthBars = newBars;
      draw();
    });

    const rangeEl = document.createElement('div');
    rangeEl.style.fontSize = '10px';
    rangeEl.style.color = '#888';
    rangeEl.textContent = `[${formatNum(entry.meta.min)} .. ${formatNum(entry.meta.max)}]`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove lane';
    removeBtn.addEventListener('click', () => removeLane(idx));

    header.append(labelEl, enableBtn, steppedBtn, barsSel, rangeEl, removeBtn);
    wrap.appendChild(header);

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 90;
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    const draw = () => drawLane(canvas, lane);
    attachLanePainter(canvas, lane, draw);
    draw();
    laneCanvases.push({ paramId: lane.paramId, draw });
  });
}

function drawLane(canvas: HTMLCanvasElement, lane: { values: number[]; enabled: boolean; stepped?: boolean }) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const w = canvas.width, h = canvas.height;
  c.fillStyle = lane.enabled ? '#0a0a0a' : '#181818';
  c.fillRect(0, 0, w, h);

  const n = lane.values.length;
  const subsPerStep = AUTOMATION_SUB_RES;
  const stepCount = Math.max(1, Math.round(n / subsPerStep));

  // Grid: step boundaries (faint) + bar boundaries (every 16 steps, bright)
  for (let s = 0; s <= stepCount; s++) {
    const x = (s / stepCount) * w;
    if (s % 16 === 0 && s > 0) c.strokeStyle = '#555';
    else if (s % 4 === 0) c.strokeStyle = '#2a2a2a';
    else c.strokeStyle = '#1a1a1a';
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
  // Mid line at 0.5
  c.strokeStyle = '#222';
  c.beginPath(); c.moveTo(0, h * 0.5); c.lineTo(w, h * 0.5); c.stroke();

  const xFor = (i: number) => (i / Math.max(1, n - 1)) * w;
  const yFor = (v: number) => h - v * h;

  // Filled area under curve.
  c.fillStyle = lane.enabled ? 'rgba(52, 152, 219, 0.35)' : 'rgba(80, 80, 80, 0.25)';
  c.beginPath();
  c.moveTo(0, h);
  for (let i = 0; i < n; i++) c.lineTo(xFor(i), yFor(lane.values[i]));
  c.lineTo(w, h);
  c.closePath();
  c.fill();

  // Curve line on top.
  c.strokeStyle = lane.enabled ? '#3498db' : '#555';
  c.lineWidth = 1.5;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xFor(i), y = yFor(lane.values[i]);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();

  // Playhead — position relative to THIS lane's length, not the pattern's.
  if (seq.isPlaying()) {
    const idxInLane = autoAbsSubIdx % n;
    const x = xFor(idxInLane);
    c.strokeStyle = '#f7d000';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
}

function attachLanePainter(
  canvas: HTMLCanvasElement,
  lane: { values: number[]; stepped?: boolean },
  draw: () => void,
) {
  let dragging = false;
  let lastIdx = -1;
  let initialValue = 0;

  const pointerToSubVal = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    const subIdx = Math.min(lane.values.length - 1, Math.floor(x * lane.values.length));
    const value = 1 - y;
    return { subIdx, value };
  };

  const paint = (fromIdx: number, toIdx: number, fromV: number, toV: number) => {
    const lo = Math.min(fromIdx, toIdx);
    const hi = Math.max(fromIdx, toIdx);
    if (lo === hi) {
      lane.values[lo] = autoBrush === 'flat' ? initialValue : toV;
    } else {
      const span = toIdx - fromIdx;
      for (let i = lo; i <= hi; i++) {
        if (autoBrush === 'flat') {
          lane.values[i] = initialValue;
        } else {
          const t = span === 0 ? 1 : (i - fromIdx) / span;
          lane.values[i] = clamp01(fromV + (toV - fromV) * t);
        }
      }
    }
    if (lane.stepped) snapLaneToSteps(lane);
  };

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    const { subIdx, value } = pointerToSubVal(e);
    initialValue = value;
    lastIdx = subIdx;
    lane.values[subIdx] = value;
    if (lane.stepped) snapLaneToSteps(lane);
    draw();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { subIdx, value } = pointerToSubVal(e);
    paint(lastIdx, subIdx, lane.values[lastIdx], value);
    lastIdx = subIdx;
    draw();
  });
  const release = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('dblclick', (e) => {
    const { subIdx } = pointerToSubVal(e as unknown as PointerEvent);
    // Reset the step containing this sub-point to 0.5.
    const step = Math.floor(subIdx / AUTOMATION_SUB_RES);
    const start = step * AUTOMATION_SUB_RES;
    for (let i = 0; i < AUTOMATION_SUB_RES && start + i < lane.values.length; i++) {
      lane.values[start + i] = 0.5;
    }
    draw();
  });
}

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
      if (bassRollEntry) { bassRollEntry.handle.redraw(); autoScrollRoll(bassRollEntry); }
      if (mainRollEntry) { mainRollEntry.handle.redraw(); autoScrollRoll(mainRollEntry); }
      for (const e of extraRolls.values()) { e.handle.redraw(); autoScrollRoll(e); }
      for (const e of rollsRollEntries) { e.handle.redraw(); autoScrollRoll(e); }
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

function redrawAllLanes() {
  for (const { draw } of laneCanvases) draw();
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function formatNum(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10)  return v.toFixed(1);
  return v.toFixed(2);
}

function wireAutomationTab() {
  populateAutoParamSelect();
  $<HTMLButtonElement>('auto-add').addEventListener('click', () => {
    const sel = $<HTMLSelectElement>('auto-param-select');
    if (sel.value) addLane(sel.value);
  });
  const setBrush = (b: AutoBrush) => {
    autoBrush = b;
    $$('button.rnd').forEach((btn) => {
      if (btn.id === 'auto-brush-line') btn.classList.toggle('primary', b === 'line');
      if (btn.id === 'auto-brush-flat') btn.classList.toggle('primary', b === 'flat');
    });
  };
  $<HTMLButtonElement>('auto-brush-line').addEventListener('click', () => setBrush('line'));
  $<HTMLButtonElement>('auto-brush-flat').addEventListener('click', () => setBrush('flat'));
  $<HTMLButtonElement>('auto-fill-random').addEventListener('click', () => {
    for (const lane of seq.pattern.automation) lane.values = lane.values.map(() => Math.random());
    redrawAllLanes();
  });
  $<HTMLButtonElement>('auto-fill-ramp').addEventListener('click', () => {
    for (const lane of seq.pattern.automation) {
      const n = lane.values.length;
      lane.values = lane.values.map((_, i) => i / Math.max(1, n - 1));
    }
    redrawAllLanes();
  });
  $<HTMLButtonElement>('auto-fill-half').addEventListener('click', () => {
    for (const lane of seq.pattern.automation) lane.values = lane.values.map(() => 0.5);
    redrawAllLanes();
  });
  setBrush('line');
}

// ── Cosmic Arpeggiator ─────────────────────────────────────────────────────
const arp: ArpSettings = { ...ARP_DEFAULTS };
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

function buildArpUI() {
  const row = $<HTMLDivElement>('poly-arp-controls');
  row.innerHTML = '';
  const SIZE = 44;
  const arpColor = '#9b59b6';

  // ENABLE toggle (styled like a knob slot but as a button)
  const enableWrap = document.createElement('div');
  enableWrap.className = 'knob';
  const enableLab = document.createElement('div');
  enableLab.className = 'knob-label';
  enableLab.textContent = 'ENABLE';
  const enableBtn = document.createElement('button');
  enableBtn.className = 'rnd';
  enableBtn.textContent = arp.enabled ? 'ON' : 'OFF';
  enableBtn.style.background = arp.enabled ? '#c0392b' : '#2a2a2a';
  enableBtn.style.color = arp.enabled ? 'white' : '#888';
  enableBtn.addEventListener('click', () => {
    arp.enabled = !arp.enabled;
    enableBtn.textContent = arp.enabled ? 'ON' : 'OFF';
    enableBtn.style.background = arp.enabled ? '#c0392b' : '#2a2a2a';
    enableBtn.style.color = arp.enabled ? 'white' : '#888';
  });
  enableWrap.append(enableLab, enableBtn);
  row.appendChild(enableWrap);

  const mkSel = (label: string, opts: { value: string; label: string }[], get: () => string, set: (v: string) => void) => {
    const wrap = document.createElement('div');
    wrap.className = 'knob';
    const lab = document.createElement('div'); lab.className = 'knob-label'; lab.textContent = label;
    const sel = document.createElement('select'); sel.className = 'poly-wave-sel';
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      if (o.value === get()) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => set(sel.value));
    wrap.append(lab, sel);
    row.appendChild(wrap);
  };

  // SCOPE — dynamic checkboxes, one per lane (303 + main + each extra).
  const scopeWrap = document.createElement('div');
  scopeWrap.className = 'knob arp-scope';
  scopeWrap.style.display = 'flex';
  scopeWrap.style.flexDirection = 'column';
  scopeWrap.style.alignItems = 'flex-start';
  const scopeLab = document.createElement('div');
  scopeLab.className = 'knob-label';
  scopeLab.textContent = 'SCOPE';
  scopeWrap.appendChild(scopeLab);
  const scopeBoxes = document.createElement('div');
  scopeBoxes.style.display = 'grid';
  scopeBoxes.style.gridTemplateColumns = 'repeat(2, auto)';
  scopeBoxes.style.gap = '2px 6px';
  scopeBoxes.style.fontSize = '10px';
  const addScopeBox = (laneId: string, label: string) => {
    const lab = document.createElement('label');
    lab.style.display = 'flex'; lab.style.alignItems = 'center'; lab.style.gap = '3px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = arp.scope.includes(laneId);
    cb.addEventListener('change', () => {
      const set = new Set(arp.scope);
      if (cb.checked) set.add(laneId); else set.delete(laneId);
      arp.scope = Array.from(set);
    });
    lab.append(cb, document.createTextNode(label));
    scopeBoxes.appendChild(lab);
  };
  addScopeBox('bass', '303');
  addScopeBox('main', 'MAIN');
  for (const track of seq.pattern.extraPolyTracks) {
    addScopeBox(track.id, track.name.slice(0, 10));
  }
  scopeWrap.appendChild(scopeBoxes);
  row.appendChild(scopeWrap);
  mkSel('PATTERN',
    [{ value:'up',label:'Up' },{ value:'down',label:'Down' },{ value:'updown',label:'Up-Down' },
     { value:'random',label:'Random' },{ value:'cosmic',label:'Cosmic' }],
    () => arp.pattern, (v) => { arp.pattern = v as ArpPattern; });
  mkSel('SCALE',
    [{ value:'major',label:'Major' },{ value:'minor',label:'Minor' },{ value:'pentMinor',label:'Penta Min' },
     { value:'phrygian',label:'Phrygian' },{ value:'chromatic',label:'Chromatic' }],
    () => arp.scale, (v) => { arp.scale = v as ArpScale; });
  mkSel('RATE',
    [{ value:'free',label:'Free' },
     { value:'4/1',label:'4 bars' },{ value:'3/1',label:'3 bars' },{ value:'2/1',label:'2 bars' },{ value:'1/1',label:'1 bar' },
     { value:'1/2',label:'1/2' },{ value:'1/4',label:'1/4' },
     { value:'1/8.',label:'1/8.' },{ value:'1/8',label:'1/8' },{ value:'1/8t',label:'1/8t' },
     { value:'1/16',label:'1/16' },{ value:'1/16t',label:'1/16t' },{ value:'1/32',label:'1/32' }],
    () => arp.rate, (v) => { arp.rate = v as ArpSettings['rate']; });

  // Free-rate Hz (used when RATE = Free)
  const freeKnob = createKnob({
    min: 0.5, max: 32, step: 0.1, value: arp.rateFreeHz, defaultValue: 8,
    label: 'FREE Hz', color: arpColor, size: SIZE,
    format: (v) => `${v.toFixed(1)}Hz`,
    onChange: (v) => { arp.rateFreeHz = v; },
  });
  row.appendChild(freeKnob.el);
  // OCTAVES
  const octKnob = createKnob({
    min: 1, max: 4, step: 1, value: arp.octaves, defaultValue: 2,
    label: 'OCT', color: arpColor, size: SIZE, format: (v) => String(v),
    onChange: (v) => { arp.octaves = v; },
  });
  row.appendChild(octKnob.el);
  // GATE
  const gateKnob = createKnob({
    min: 0.05, max: 1, step: 0.01, value: arp.gate, defaultValue: 0.7,
    label: 'GATE', color: arpColor, size: SIZE, format: fmtPct,
    onChange: (v) => { arp.gate = v; },
  });
  row.appendChild(gateKnob.el);
}

// ── PolySynth randomize + presets ─────────────────────────────────────────
const POLY_PRESETS_KEY = 'tb303-poly-presets-v1';

function loadUserPolyPresets(): Record<string, PolySynthParams> {
  const raw = localStorage.getItem(POLY_PRESETS_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function saveUserPolyPresets(presets: Record<string, PolySynthParams>) {
  localStorage.setItem(POLY_PRESETS_KEY, JSON.stringify(presets));
}

function applyPolyParams(params: PolySynthParams) {
  // Preset / load / randomize → apply to the polysynth currently being edited.
  const d = JSON.parse(JSON.stringify(activePolyTarget.params)) as PolySynthParams;
  activePolyTarget.params = {
    master: { ...d.master, ...params.master },
    osc1:   { ...d.osc1,   ...params.osc1 },
    osc2:   { ...d.osc2,   ...params.osc2 },
    sub:    { ...d.sub,    ...params.sub },
    noise:  { ...d.noise,  ...params.noise },
    filter: { ...d.filter, ...params.filter },
    amp:    { ...d.amp,    ...params.amp },
    lfo1:   { ...d.lfo1,   ...params.lfo1 },
    lfo2:   { ...d.lfo2,   ...params.lfo2 },
  };
  refreshPolyKnobsFromState();
}

function populatePolyPresetSelect() {
  const sel = $<HTMLSelectElement>('poly-preset-select');
  sel.innerHTML = '';

  // Sentinel for synths with no preset applied (after randomize / manual tweak)
  const custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = '(custom — no preset)';
  sel.appendChild(custom);

  const factoryGroup = document.createElement('optgroup');
  factoryGroup.label = 'Factory';
  for (const p of FACTORY_POLY_PRESETS) {
    const opt = document.createElement('option');
    opt.value = `factory:${p.name}`;
    opt.textContent = p.name;
    factoryGroup.appendChild(opt);
  }
  sel.appendChild(factoryGroup);

  const user = loadUserPolyPresets();
  const userNames = Object.keys(user).sort();
  if (userNames.length > 0) {
    const userGroup = document.createElement('optgroup');
    userGroup.label = 'User';
    for (const name of userNames) {
      const opt = document.createElement('option');
      opt.value = `user:${name}`;
      opt.textContent = name;
      userGroup.appendChild(opt);
    }
    sel.appendChild(userGroup);
  }
}

function wirePolyControls() {
  $<HTMLButtonElement>('poly-randomize').addEventListener('click', () => {
    const engineId = getLaneEngineId(activeEngineLaneId);
    if (engineId === 'subtractive') {
      randomizePolySynth(activePolyTarget);
      polyPresetName.delete(activePolyTarget);
      refreshPolyKnobsFromState();
      refreshPolyPresetSelect();
      return;
    }
    // Non-subtractive: randomize the ACTIVE LANE's instance (not the singleton).
    const instance = getLaneEngineInstance(activeEngineLaneId);
    if (!instance) return;
    const eng = instance as unknown as { randomize?: () => void; setParam?: (id: string, v: number) => void };
    if (eng.randomize) {
      eng.randomize();
    } else {
      for (const p of instance.params) {
        const v = p.min + Math.random() * (p.max - p.min);
        eng.setParam?.(p.id, v);
      }
    }
    rebuildEngineParamUI();
  });

  populatePolyPresetSelect();

  $<HTMLButtonElement>('poly-preset-load').addEventListener('click', () => {
    const sel = $<HTMLSelectElement>('poly-preset-select');
    const val = sel.value;
    if (!val || val === '__custom__') return;
    if (val.startsWith('factory:')) {
      const name = val.slice('factory:'.length);
      const p = FACTORY_POLY_PRESETS.find((x) => x.name === name);
      if (p) { applyPolyParams(p.params); polyPresetName.set(activePolyTarget, val); }
    } else if (val.startsWith('user:')) {
      const name = val.slice('user:'.length);
      const presets = loadUserPolyPresets();
      if (presets[name]) { applyPolyParams(presets[name]); polyPresetName.set(activePolyTarget, val); }
    }
  });

  $<HTMLButtonElement>('poly-preset-save').addEventListener('click', () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const presets = loadUserPolyPresets();
    presets[trimmed] = JSON.parse(JSON.stringify(activePolyTarget.params)) as PolySynthParams;
    saveUserPolyPresets(presets);
    populatePolyPresetSelect();
    polyPresetName.set(activePolyTarget, `user:${trimmed}`);
    refreshPolyPresetSelect();
  });

  $<HTMLButtonElement>('poly-preset-delete').addEventListener('click', () => {
    const sel = $<HTMLSelectElement>('poly-preset-select');
    const val = sel.value;
    if (!val.startsWith('user:')) {
      alert('Solo se pueden borrar presets de usuario (no los Factory).');
      return;
    }
    const name = val.slice('user:'.length);
    if (!confirm(`Borrar preset "${name}"?`)) return;
    const presets = loadUserPolyPresets();
    delete presets[name];
    saveUserPolyPresets(presets);
    populatePolyPresetSelect();
  });
}

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

// ── Polysynth track: STEP vs PIANO mode + MIDI import ────────────────────
function setPolyMode(mode: 'step' | 'piano') {
  if (seq.pattern.polyMode === mode) return;
  if (mode === 'piano' && seq.pattern.polyNotes.length === 0) {
    // First switch into piano: convert existing step pattern to free notes
    seq.pattern.polyNotes = stepsToNotes(seq.pattern.melody);
  }
  seq.pattern.polyMode = mode;
  rebuildPolyTrack();
  updatePolyModeButtons();
}

function updatePolyModeButtons() {
  const stepBtn = $<HTMLButtonElement>('poly-mode-step');
  const pianoBtn = $<HTMLButtonElement>('poly-mode-piano');
  stepBtn.classList.toggle('primary', seq.pattern.polyMode === 'step');
  pianoBtn.classList.toggle('primary', seq.pattern.polyMode === 'piano');
}

// Minimal SMF parser inlined here (matches scripts/parse-midi.mjs).
interface ParsedTrack {
  index: number;
  name: string;
  program: number;
  notes: { startTick: number; duration: number; midi: number; velocity: number; channel: number }[];
}

function parseMidiFile(buf: Uint8Array): { division: number; tracks: ParsedTrack[] } {
  let p = 0;
  const u8 = () => buf[p++];
  const u16 = () => (buf[p++] << 8) | buf[p++];
  const u32 = () => (buf[p++] * 0x1000000) + (buf[p++] << 16) + (buf[p++] << 8) + buf[p++];
  const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'MThd') throw new Error('not SMF');
  p = 4;
  const hLen = u32(); u16(); /* format */ const ntracks = u16(); const division = u16();
  p = 4 + 4 + hLen;
  const tracks: ParsedTrack[] = [];
  for (let t = 0; t < ntracks; t++) {
    if (String.fromCharCode(buf[p], buf[p+1], buf[p+2], buf[p+3]) !== 'MTrk') break;
    p += 4;
    const tlen = u32();
    const tend = p + tlen;
    let abs = 0; let lastStatus = 0; let name = ''; let program = -1;
    const noteOn = new Map<number, number>();
    const notes: ParsedTrack['notes'] = [];
    while (p < tend) {
      abs += vlq();
      let status = buf[p];
      if (status < 0x80) { status = lastStatus; } else { p++; lastStatus = status; }
      if (status === 0xff) {
        const type = u8(); const len = vlq();
        if (type === 0x03) name = String.fromCharCode(...buf.slice(p, p + len));
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        const len = vlq(); p += len;
      } else {
        const high = status & 0xf0;
        const ch = status & 0x0f;
        if (high === 0x80 || high === 0x90) {
          const note = u8(); const vel = u8();
          const isOff = high === 0x80 || vel === 0;
          const key = (ch << 8) | note;
          if (!isOff) noteOn.set(key, abs);
          else {
            const start = noteOn.get(key);
            if (start != null) {
              notes.push({ startTick: start, duration: abs - start, midi: note, velocity: 80, channel: ch });
              noteOn.delete(key);
            }
          }
        } else if (high === 0xc0) {
          program = u8();
        } else if (high === 0xa0 || high === 0xb0 || high === 0xe0) {
          p += 2;
        } else if (high === 0xd0) {
          p += 1;
        }
      }
    }
    tracks.push({ index: t, name, program, notes });
  }
  return { division, tracks };
}

let parsedMidi: ReturnType<typeof parseMidiFile> | null = null;

// Map GM program number to a factory polysynth preset name so imported MIDI
// tracks get a tone that roughly matches their original instrument.
// GM program → factory preset. Now mapped to the expanded preset library so
// different programs get distinct sounds (multiple bass types, multiple leads
// and pads). Per-program because tracks within the same family should still
// sound different (acoustic vs synth bass, synth strings vs choir, etc.).
function presetFromProgram(prog: number): string {
  // 0-7 pianos / EP / harpsichord
  if (prog === 0 || prog === 1) return 'KEY Acoustic Piano';   // Grand / Bright Acoustic
  if (prog === 2) return 'KEY Acoustic Piano';                  // Electric Grand
  if (prog === 3) return 'KEY Acoustic Piano';                  // Honky-tonk
  if (prog === 4 || prog === 5) return 'KEY Rhodes';            // EP 1, EP 2
  if (prog === 6) return 'KEY Rhodes';                          // Harpsichord
  if (prog === 7) return 'PLUCK Digital';                       // Clavinet
  // 8-15 chromatic percussion (celesta, glock, music box, vibes, marimba, xylophone, tubular, dulcimer)
  if (prog === 8)  return 'BELL FM';
  if (prog === 9 || prog === 10) return 'BELL FM';
  if (prog === 11 || prog === 12) return 'PLUCK Marimba';
  if (prog === 13) return 'PLUCK Marimba';
  if (prog === 14 || prog === 15) return 'BELL FM';
  // 16-23 organs
  if (prog >= 16 && prog <= 20) return 'PAD Organ';
  if (prog >= 21 && prog <= 23) return 'PAD Organ';
  // 24-31 guitars
  if (prog >= 24 && prog <= 27) return 'PLUCK Digital';
  if (prog >= 28 && prog <= 31) return 'LEAD Bright Saw';
  // 32-39 basses — varied!
  if (prog === 32) return 'BASS Plucky';      // Acoustic Bass
  if (prog === 33) return 'BASS Big Saws';    // Fingered Bass
  if (prog === 34) return 'BASS Punchy';      // Picked Bass
  if (prog === 35) return 'BASS Sub 808';     // Fretless
  if (prog === 36) return 'BASS Plucky';      // Slap 1
  if (prog === 37) return 'BASS Punchy';      // Slap 2
  if (prog === 38) return 'BASS Wobble';      // Synth Bass 1
  if (prog === 39) return 'BASS Reese';       // Synth Bass 2
  // 40-47 solo strings / pizz / harp
  if (prog >= 40 && prog <= 44) return 'PAD Detuned Strings';
  if (prog === 45) return 'PLUCK Marimba';     // Pizz
  if (prog === 46) return 'BELL FM';           // Harp
  if (prog === 47) return 'PLUCK Digital';     // Timpani
  // 48-49 string ensembles
  if (prog === 48) return 'PAD Detuned Strings';
  if (prog === 49) return 'PAD Detuned Strings';
  // 50-51 synth strings
  if (prog === 50) return 'PAD Sweep';
  if (prog === 51) return 'PAD Warm';
  // 52-54 choir / voice oohs / synth voice
  if (prog === 52) return 'VOX Aah';        // Choir Aahs
  if (prog === 53) return 'VOX Ooh';        // Voice Oohs (THE Sweet Dreams sound)
  if (prog === 54) return 'VOX Hum Choir';  // Synth Voice
  // 55 orchestra hit
  if (prog === 55) return 'LEAD Brass Stab';
  // 56-63 brass
  if (prog === 56 || prog === 57) return 'LEAD Brass Stab';
  if (prog === 58 || prog === 59) return 'LEAD Brass Stab';
  if (prog >= 60 && prog <= 63) return 'LEAD Brass Stab';
  // 64-71 reed (sax, oboe, clarinet)
  if (prog >= 64 && prog <= 71) return 'LEAD Soft Sine';
  // 72-79 pipe (flute, recorder)
  if (prog >= 72 && prog <= 79) return 'LEAD Soft Sine';
  // 80-87 synth lead
  if (prog === 80) return 'LEAD Square';        // Square Lead
  if (prog === 81) return 'LEAD Bright Saw';    // Saw Lead
  if (prog === 82) return 'LEAD Soft Sine';     // Calliope
  if (prog === 83) return 'LEAD Bright Saw';    // Chiff
  if (prog === 84) return 'LEAD Supersaw';      // Charang
  if (prog === 85) return 'VOX Hum Choir';      // Voice (Synth Lead 6)
  if (prog === 86) return 'LEAD Trance';        // Fifths
  if (prog === 87) return 'LEAD Hoover';        // Bass+Lead
  // 88-95 synth pad
  if (prog === 88) return 'PAD Warm';           // New Age
  if (prog === 89) return 'PAD Sweep';          // Warm
  if (prog === 90) return 'PAD Glass';          // Polysynth
  if (prog === 91) return 'PAD Choir Aah';      // Choir
  if (prog === 92) return 'PAD Detuned Strings'; // Bowed
  if (prog === 93) return 'PAD Glass';          // Metallic
  if (prog === 94) return 'PAD Sweep';          // Halo
  if (prog === 95) return 'PAD Sweep';          // Sweep
  // 96-103 synth effects
  if (prog >= 96 && prog <= 103) return 'FX Sci-Fi';
  // 104-111 ethnic / 112-119 percussive / 120-127 SFX
  if (prog >= 120) return 'FX Noise Sweep';
  return 'Init';
}

// Remembers which preset is currently applied to each polysynth so the
// preset dropdown can reflect the active synth's choice when you switch.
const polyPresetName = new Map<PolySynth, string>();

function applyPresetByName(poly: PolySynth, name: string) {
  const p = FACTORY_POLY_PRESETS.find((x) => x.name === name);
  if (p) {
    poly.params = JSON.parse(JSON.stringify(p.params)) as PolySynthParams;
    polyPresetName.set(poly, `factory:${name}`);
  }
}

function refreshPolyPresetSelect() {
  const sel = $<HTMLSelectElement>('poly-preset-select');
  const current = polyPresetName.get(activePolyTarget);
  if (current) sel.value = current;
  else sel.value = '__custom__';
}

function wirePolyMode() {
  $<HTMLButtonElement>('poly-mode-step').addEventListener('click', () => setPolyMode('step'));
  $<HTMLButtonElement>('poly-mode-piano').addEventListener('click', () => setPolyMode('piano'));
  updatePolyModeButtons();
  $<HTMLButtonElement>('bass-mode-step').addEventListener('click', () => setBassMode('step'));
  $<HTMLButtonElement>('bass-mode-piano').addEventListener('click', () => setBassMode('piano'));
  updateBassModeButtons();

  const fileInput = $<HTMLInputElement>('poly-midi-file');
  const trackListEl = $<HTMLDivElement>('poly-midi-tracklist');
  const loadBtn = $<HTMLButtonElement>('poly-midi-load');

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    try {
      parsedMidi = parseMidiFile(buf);
    } catch (err) {
      alert('Not a valid SMF: ' + (err as Error).message);
      return;
    }
    // Build a checkbox list for every track that has notes.
    trackListEl.innerHTML = '';
    parsedMidi.tracks.forEach((tr) => {
      if (tr.notes.length === 0) return;
      const lo = Math.min(...tr.notes.map((n) => n.midi));
      const hi = Math.max(...tr.notes.map((n) => n.midi));
      const lbl = document.createElement('label');
      lbl.className = 'midi-track-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.idx = String(tr.index);
      cb.checked = true; // default check all
      const txt = document.createElement('span');
      txt.textContent = ` [${tr.index}] ${tr.name || 'untitled'} — ${tr.notes.length} notes, range ${lo}-${hi}, prog ${tr.program} → preset "${presetFromProgram(tr.program)}"`;
      lbl.append(cb, txt);
      trackListEl.appendChild(lbl);
    });
    trackListEl.style.display = '';
    loadBtn.style.display = '';
  });

  loadBtn.addEventListener('click', () => {
    if (!parsedMidi) return;
    const TICKS_PER_QUARTER = 96;
    const scale = TICKS_PER_QUARTER / parsedMidi.division;
    const checks = Array.from(trackListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'));

    // Clear existing extras
    seq.pattern.extraPolyTracks = [];

    // Global min start across all selected tracks so they align.
    let globalMinStart = Infinity;
    let globalMaxEnd = 0;
    const selected = checks
      .map((cb) => parsedMidi!.tracks.find((t) => t.index === parseInt(cb.dataset.idx ?? '', 10)))
      .filter((t): t is NonNullable<typeof t> => !!t);
    for (const tr of selected) {
      for (const n of tr.notes) {
        if (n.startTick < globalMinStart) globalMinStart = n.startTick;
        const end = n.startTick + n.duration;
        if (end > globalMaxEnd) globalMaxEnd = end;
      }
    }
    if (!isFinite(globalMinStart)) globalMinStart = 0;

    // Expand pattern length to fit the full MIDI duration.
    const songTicks = Math.ceil((globalMaxEnd - globalMinStart) * scale);
    const requiredSteps = Math.max(seq.length, Math.ceil(songTicks / TICKS_PER_STEP) + 4);
    if (requiredSteps !== seq.length) seq.setLength(requiredSteps);

    // Split selected tracks: drums (channel 9 in 0-indexed) vs tonal.
    const drumTracks = selected.filter((tr) => tr.notes.some((n) => n.channel === 9));
    const polyTracks = selected.filter((tr) => !tr.notes.some((n) => n.channel === 9));

    // Drum tracks → step grid via GM percussion map (quantize to 16ths).
    if (drumTracks.length > 0) {
      for (const lane of DRUM_LANES) {
        for (const s of seq.drums[lane]) { s.on = false; s.accent = false; s.roll = 0; }
      }
      for (const tr of drumTracks) {
        for (const n of tr.notes) {
          const voice = midiNoteToDrumVoice(n.midi);
          if (!voice) continue;
          const stepIdx = Math.floor((n.startTick - globalMinStart) * scale / TICKS_PER_STEP);
          if (stepIdx < 0 || stepIdx >= seq.length) continue;
          seq.drums[voice][stepIdx].on = true;
          if (n.velocity >= 100) seq.drums[voice][stepIdx].accent = true;
        }
      }
    }

    // Tonal tracks → extra polysynth slots
    let nextSlot = 0;
    for (const tr of polyTracks) {
      if (nextSlot >= MAX_EXTRA_POLY_TRACKS) break;
      const notes: NoteEvent[] = tr.notes.map((n) => ({
        start: Math.round((n.startTick - globalMinStart) * scale),
        duration: Math.max(6, Math.round(n.duration * scale)),
        midi: n.midi,
        velocity: n.velocity,
      }));
      const id = EXTRA_IDS[nextSlot];
      seq.pattern.extraPolyTracks.push({
        id,
        name: tr.name || `Track ${tr.index}`,
        enabled: true,
        notes,
      });
      applyPresetByName(ensureExtraPoly(id), presetFromProgram(tr.program));
      nextSlot++;
    }

    // Auto-mute the step-based "demo" tracks (bass + main poly).
    // Drums only mute if NO drum track came from the MIDI (otherwise we want
    // the DrumMachine playing the MIDI drums).
    muteState.bass = true;
    muteState.poly = true;
    if (drumTracks.length === 0) {
      for (const lane of DRUM_LANES) muteState[lane] = true;
    } else {
      for (const lane of DRUM_LANES) muteState[lane] = false;
    }
    applyMuteSolo();

    // MIDI is a one-shot song, not a 1-bar loop. Stop looping.
    seq.loopEnabled = false;
    refreshLoopBtn();

    rebuildPolyTrack();
    rebuildMixer();
    flashButton(loadBtn, `Loaded ${nextSlot} poly + ${drumTracks.length} drum, ${requiredSteps} steps, no loop`);
  });
}

// GM drum channel (MIDI ch 10 = 0-indexed 9) note → DrumMachine voice.
const DRUM_NOTE_TO_VOICE: Record<number, DrumVoice> = {
  35: 'kick', 36: 'kick',
  37: 'snare', 38: 'snare', 40: 'snare',
  39: 'clap',
  42: 'closedHat', 44: 'closedHat',
  46: 'openHat',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom',
  49: 'ride', 51: 'ride', 53: 'ride', 57: 'ride', 59: 'ride',
  56: 'cowbell',
};
function midiNoteToDrumVoice(note: number): DrumVoice | null {
  return DRUM_NOTE_TO_VOICE[note] ?? null;
}

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

// ── Copy bars between slots ───────────────────────────────────────────────
function wireCopyPanel() {
  const fromSel = $<HTMLSelectElement>('copy-from');
  const toSel   = $<HTMLSelectElement>('copy-to');
  for (const sel of [fromSel, toSel]) {
    for (let i = 0; i < bank.slots.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String.fromCharCode(65 + i); // A B C D
      sel.appendChild(opt);
    }
  }
  fromSel.value = '0';
  toSel.value = '1';

  $<HTMLButtonElement>('copy-go').addEventListener('click', () => {
    const from = parseInt(fromSel.value, 10);
    const to   = parseInt(toSel.value, 10);
    if (from === to) return;
    const copyBass   = $<HTMLInputElement>('copy-bass').checked;
    const copyDrums  = $<HTMLInputElement>('copy-drums').checked;
    const copyMelody = $<HTMLInputElement>('copy-melody').checked;
    const copyAuto   = $<HTMLInputElement>('copy-auto').checked;

    // If we're currently editing the source, snapshot live state into it first.
    if (from === bank.current) bank.slots[from] = clonePattern(seq.pattern);

    const src = bank.slots[from];
    const dst = bank.slots[to];

    // Resize destination if needed so the copy fits.
    if (src.length !== dst.length) {
      // Grow/shrink dst to match src for the tracks we're copying. Simplest:
      // make dst length === src length (affects all its tracks but harmless).
      const diff = src.length - dst.length;
      if (diff > 0) {
        for (let i = 0; i < diff; i++) {
          dst.bass.push({ on: false, note: 36, accent: false, slide: false });
          dst.melody.push({ on: false, notes: [60], accent: false, tie: false });
          for (const lane of DRUM_LANES) dst.drums[lane].push({ on: false, accent: false });
        }
      } else if (diff < 0) {
        dst.bass.length = src.length;
        dst.melody.length = src.length;
        for (const lane of DRUM_LANES) dst.drums[lane].length = src.length;
      }
      dst.length = src.length;
    }

    if (copyBass)   dst.bass   = src.bass.map((s) => ({ ...s }));
    if (copyMelody) dst.melody = src.melody.map((s) => ({ ...s }));
    if (copyDrums) {
      dst.drums = Object.fromEntries(
        DRUM_LANES.map((lane) => [lane, src.drums[lane].map((s) => ({ ...s }))]),
      ) as typeof dst.drums;
    }
    if (copyAuto) {
      dst.automation = src.automation.map((l) => ({ ...l, values: [...l.values] }));
    }

    // If we just overwrote the currently-playing/edited slot, re-render.
    if (to === bank.current) {
      seq.setPattern(bank.slots[to]);
      barsSel.value = String(seq.length);
      viewStart = 0;
      rebuildTracks();
      renderLanes();
    }
    flashButton($<HTMLButtonElement>('copy-go'), `${String.fromCharCode(65+from)}→${String.fromCharCode(65+to)} ✓`);
  });
}

setupInitialPattern();
// All 4 slots are populated by setupInitialPattern; seq is already pointing at slot 0.
barsSel.value = String(seq.length);

buildPolySynthUI();
buildArpUI();
buildFxUI();
buildDrumMasterUI();
applyDelaySync();
rebuildTracks();
rebuildMixer();
wireAutomationTab();
wirePresets();
wirePolyControls();
wirePolyMode();
wirePolyTargetSelect();
wireCopyPanel();
wireCopyTrackPanel();

// ── Demo wiring (deps built here, functions live in demo-minimal-techno.ts) ─
const demoDeps: import('./demo-minimal-techno').DemoDeps = {
  seq, bank, bpmInput, barsSel,
  chainEnabled: () => chainEnabled,
  chainBtn,
  setSlotConfigurators,
  getLaneEngineInstance,
  viewStart: { get value() { return viewStart; }, set value(v) { viewStart = v; } },
  rebuildTracks,
  updateSlotButtons,
  renderLanes,
  updateBassModeButtons,
  syncEngineToPattern,
  rebuildMixer,
  rebuildSynthTabs,
};
wireDemoMinimalTechno(demoDeps);

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

// Per-lane randomize buttons (replaces the old global toolbar)
$<HTMLButtonElement>('bass-random-sound').addEventListener('click', randomizeBassSound);
$<HTMLButtonElement>('bass-random-notes').addEventListener('click', randomizeBassNotes);
$<HTMLButtonElement>('drums-random').addEventListener('click', randomizeDrumsLane);
$<HTMLButtonElement>('poly-random-notes').addEventListener('click', () => randomizePolyLaneNotes(activeEngineLaneId));
startAutomationTick();
// Auto-load the minimal techno demo on first boot so the user lands on
// something playable. Press the demo button again to reset, or just edit.
applyMinimalTechnoDemo(demoDeps);
rebuildSynthTabs();
startVisualizer();

// ── Save Manager v2 ────────────────────────────────────────────────────────
function buildSavedStateV2(): Record<string, unknown> {
  return {
    version: 2,
    bpm: seq.bpm,
    swing: seq.swing,
    masterVol: parseFloat(volInput.value),
    kit: drums.kitId,
    wave: synth.params.wave,
    scale: scaleSel.value,
    rootNote: parseInt(rootSel.value, 10),
    synthParams: { ...synth.params },
    polyParams: JSON.parse(JSON.stringify(polysynth.params)),
    currentSlot: bank.current,
    slots: bank.slots.map(clonePattern),
    channels: Object.fromEntries(activeTracks().map((t) => [t, stripFor(t).serialize()])),
    mutes: { ...muteState },
    solos: { ...soloState },
    session: sessionHost.getStateForSave(),
    mode: appMode,
  };
}

function applyLoadedState(data: unknown): void {
  if (!data || typeof data !== 'object') { alert('Invalid save data'); return; }
  const s = data as Record<string, unknown>;
  if (typeof s.bpm === 'number') { seq.bpm = s.bpm; bpmInput.value = String(s.bpm); }
  if (typeof s.swing === 'number') { seq.swing = s.swing; swingInput.value = String(s.swing); }
  if (typeof s.masterVol === 'number') { master.gain.value = s.masterVol; volInput.value = String(s.masterVol); }
  if (typeof s.kit === 'string') { drums.setKit(s.kit); kitSel.value = s.kit; }
  if (s.wave) { synth.params.wave = s.wave as typeof synth.params.wave; waveSel.value = String(s.wave); }
  if (s.scale) scaleSel.value = String(s.scale);
  if (typeof s.rootNote === 'number') rootSel.value = String(s.rootNote);
  if (s.synthParams) synth.params = { ...synth.params, ...(s.synthParams as object) };
  if (s.polyParams)  polysynth.params = JSON.parse(JSON.stringify(s.polyParams));
  if (Array.isArray(s.slots)) {
    bank.slots = s.slots.map((p) => clonePattern(normalizePattern(p as PatternData)));
    bank.current = typeof s.currentSlot === 'number' ? s.currentSlot : 0;
    seq.setPattern(bank.slots[bank.current]);
    barsSel.value = String(seq.length);
    viewStart = 0;
  }
  if (s.channels && typeof s.channels === 'object') {
    for (const t of activeTracks()) {
      const cs = (s.channels as Record<string, unknown>)[t];
      if (cs) stripFor(t).restore(cs as Parameters<ReturnType<typeof stripFor>['restore']>[0]);
    }
  }
  if (s.mutes && typeof s.mutes === 'object') Object.assign(muteState, s.mutes);
  if (s.solos && typeof s.solos === 'object') Object.assign(soloState, s.solos);
  if (s.session && typeof s.session === 'object') {
    sessionHost.applyLoadedSessionState(s.session as SessionState);
  }
  if (s.mode === 'session') setAppMode('session');
  else setAppMode('classic');
  rebuildTracks();
  rebuildMixer();
  sessionHost.renderWithMixer();
  applyMuteSolo();
  refreshKnobsFromSynth();
  renderLanes();
  fx.setBpmSync(seq.bpm);
  filterChain.updateBpm(seq.bpm);
  $$('button.slot').forEach((b) => b.classList.toggle('active', b.dataset.slot === String(bank.current)));
}

function openSaveManager() {
  const modal = document.getElementById('save-manager-modal')!;
  const list  = document.getElementById('save-manager-list')!;
  modal.hidden = false;
  list.innerHTML = '';

  const autosaveRow = document.createElement('div');
  autosaveRow.className = 'save-manager-row autosave';
  autosaveRow.innerHTML = `
    <span>Auto-save (latest)</span>
    <span>—</span>
    <span>—</span>
    <button data-act="load">Load</button>
    <span></span><span></span><span></span>
  `;
  autosaveRow.querySelector<HTMLButtonElement>('[data-act=load]')!.onclick = () => {
    const data = loadAutosave();
    if (data) applyLoadedState(data);
    closeSaveManager();
  };
  list.appendChild(autosaveRow);

  const idx: SaveIndexEntry[] = readIndex().sort((a, b) => b.timestamp - a.timestamp);
  for (const entry of idx) {
    const row = document.createElement('div');
    row.className = 'save-manager-row';
    const d = new Date(entry.timestamp).toLocaleString();
    row.innerHTML = `
      <span>${entry.name}</span>
      <span>${d}</span>
      <span>${entry.sizeKB} KB</span>
      <button data-act="load">Load</button>
      <button data-act="dl">⤓</button>
      <button data-act="ren">✎</button>
      <button data-act="del">🗑</button>
    `;
    row.querySelector<HTMLButtonElement>('[data-act=load]')!.onclick = () => {
      const data = loadEntry(entry.id);
      if (data) applyLoadedState(data);
      closeSaveManager();
    };
    row.querySelector<HTMLButtonElement>('[data-act=dl]')!.onclick = () => {
      const data = loadEntry(entry.id);
      if (data) downloadAsJson(`tb303-${entry.name.replace(/[^\w-]+/g, '_')}.json`, data);
    };
    row.querySelector<HTMLButtonElement>('[data-act=ren]')!.onclick = () => {
      const next = window.prompt('Rename:', entry.name);
      if (next) { renameEntry(entry.id, next); openSaveManager(); }
    };
    row.querySelector<HTMLButtonElement>('[data-act=del]')!.onclick = () => {
      if (window.confirm(`Delete "${entry.name}"?`)) { deleteEntry(entry.id); openSaveManager(); }
    };
    list.appendChild(row);
  }

  const sizeEl = document.getElementById('save-manager-size')!;
  sizeEl.textContent = `Total: ${totalStorageKB()} KB`;
}

function closeSaveManager() {
  document.getElementById('save-manager-modal')!.hidden = true;
}

document.getElementById('save-manager-close')!.addEventListener('click', closeSaveManager);
document.querySelector('.save-manager-backdrop')!.addEventListener('click', closeSaveManager);

document.getElementById('save-manager-load-file')!.addEventListener('click', () => {
  document.getElementById('save-manager-file')!.click();
});
document.getElementById('save-manager-file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const data = await loadFromFile(file);
    applyLoadedState(data);
    closeSaveManager();
  } catch (err) {
    alert('Invalid save file: ' + (err as Error).message);
  }
});
document.getElementById('save-manager-clear-all')!.addEventListener('click', () => {
  if (window.confirm('Clear ALL saves? Autosave is preserved.')) {
    clearAll();
    openSaveManager();
  }
});

// Replace existing Save/Load button handlers
const existingSaveBtn = document.getElementById('save');
const existingLoadBtn = document.getElementById('load');
if (existingSaveBtn) {
  // Remove any existing listeners by cloning the node
  const newSave = existingSaveBtn.cloneNode(true) as HTMLButtonElement;
  existingSaveBtn.parentNode!.replaceChild(newSave, existingSaveBtn);
  newSave.addEventListener('click', () => {
    const def = `Sesión ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const name = window.prompt('Save name:', def);
    if (!name) return;
    const state = buildSavedStateV2();
    saveNamedEntry(name, state);
    downloadAsJson(`tb303-${name.replace(/[^\w-]+/g, '_')}.json`, state);
    flashButton(newSave, 'Saved!');
  });
}
if (existingLoadBtn) {
  const newLoad = existingLoadBtn.cloneNode(true) as HTMLButtonElement;
  existingLoadBtn.parentNode!.replaceChild(newLoad, existingLoadBtn);
  newLoad.addEventListener('click', openSaveManager);
}

// Boot recovery from autosave
const _recoveredBoot = loadAutosave();
if (_recoveredBoot) applyLoadedState(_recoveredBoot);
