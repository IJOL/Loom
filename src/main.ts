import {
  wireEngineSelector, rebuildEngineParamUI,
  type EngineSelectorUIDeps,
} from './engines/engine-selector-ui';
import type { SynthEngine } from './engines/engine-types';
import * as leh from './engines/lane-engine-host';
import type { LaneEngineHostState, LaneEngineHostDeps } from './engines/lane-engine-host';
import { getEngine, createEngineInstance } from './engines/registry';
import './engines/subtractive';
import './engines/wavetable';
import './engines/fm';
import './engines/karplus';
import { configureTB303EngineMainInstance, tb303Engine } from './engines/tb303';
import { wireEngineParams } from './engines/engine-ui';
import './engines/drums-engine';
import { configureDrumsEngineSharedFx } from './engines/drums-engine';
import { TB303, type Wave } from './core/synth';
import { Sequencer } from './core/sequencer';
import { DrumMachine, DRUM_LANES, type DrumVoice } from './core/drums';
import { clearPattern } from './core/random';
import { FxBus, ChannelStrip, FilterChain } from './core/fx';
import { PatternBank, emptyPattern, AUTOMATION_SUB_RES, MAX_EXTRA_POLY_TRACKS, type PolyTrack, type AutomationLane } from './core/pattern';
import { type KnobHandle } from './core/knob';
import { PolySynth } from './polysynth/polysynth';
import { scheduleArpForNote } from './arp/arp';
import { stepsToNotes, bassStepsToNotes } from './core/notes';
import { buildMixerColumn } from './core/mixer';
import * as laneTrackHelpers from './core/lane-display';
import { SessionHost } from './session/session-host';
import { applyMinimalTechnoDemo, wireDemoMinimalTechno, buildMinimalTechnoDemoSession } from './demo/demo-minimal-techno';
import { setupInitialPattern, type InitialPatternDeps } from './demo/initial-pattern';
import { wireMidiImport } from './midi/midi-import';
import { wireSaveManager, bootRecoveryLoad } from './save/save-wiring';
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
  showPolyEditor,
  synthEditorState,
} from './session/synth-editor-routing';
import { startVisualizer } from './core/visualizer';
import { wireDrumMasterUI } from './core/drum-master-ui';
import { wirePresetLibrary } from './presets/preset-library-ui';
import {
  startAutomationTick, resetAutomationPosition, getAutoAbsSubIdx,
  type AutomationTickDeps,
} from './automation/automation-tick';
import { setCurrentLaneForVoice, getActiveModVoice } from './modulation/active-mods';
import { LaneResourceMap } from './core/lane-resources';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from './core/lane-ids';
import { GM_DRUM_MAP } from './engines/drum-gm-map';

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb  = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
const fmtSec = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
const fmtCents = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}¢`;
const fmtOct = (v: number) => v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`;

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
// Retrieve the registry instance so we can wire polysynth into it.
// (The singleton `subtractiveEngine` export has been removed; we go through
// the registry, which holds the representative instance registered in
// subtractive.ts at module load time.)
const mainSubtractive = getEngine('subtractive');
if (mainSubtractive) {
  (mainSubtractive as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(polysynth);
}

// Phase A: per-lane resources unified into a single Map. The objects are
// the SAME instances as the existing globals (polysynth / bassStrip / etc.) —
// reading either path returns identical state. Phase B will replace each
// global with a laneResources.get(id) lookup; Phase E deletes the globals.
const laneResources = new LaneResourceMap();
const drumsEngineInstance = getEngine('drums-machine');
if (drumsEngineInstance && mainSubtractive) {
  laneResources.set(LANE_ID_BASS,  { strip: bassStrip,    engine: tb303Engine });
  laneResources.set(LANE_ID_DRUMS, { strip: drumBusStrip, engine: drumsEngineInstance });
  laneResources.set(LANE_ID_POLY,  { strip: polyStrip,    engine: mainSubtractive });
}

// Extra polyphonic voices are created LAZILY — no PolySynth/ChannelStrip is
// instantiated until a track is actually added (via UI, MIDI import, or demo).
const extraStrips: Partial<Record<ExtraId, ChannelStrip>> = {};
const extraPolys: Partial<Record<ExtraId, PolySynth>> = {};

// Generic per-lane strip cache (keyed by full lane id). Used for non-extra-
// poly lanes like bass2, drums2, etc.
const extraLaneStrips = new Map<string, ChannelStrip>();

// poly1 → subtractive-2, poly2 → subtractive-3, …
function slugFromExtraId(id: ExtraId): string {
  const n = parseInt(id.replace('poly', ''), 10) + 1;
  return `subtractive-${n}`;
}

function ensureExtraPoly(id: ExtraId): PolySynth {
  let p = extraPolys[id];
  if (p) return p;
  const strip = new ChannelStrip(ctx, master, fx);
  p = new PolySynth(ctx, strip.input);
  p.bpm = seq.bpm;
  extraStrips[id] = strip;
  extraPolys[id] = p;
  // Phase A: also seed laneResources so consumers can opt into the new path.
  // Each extra subtractive lane gets its OWN SubtractiveEngine instance via
  // the factory (no shared singleton modHost). The factory-created engine
  // has setPolySynth on its prototype; we attach the freshly-allocated
  // polysynth so its createVoice can route notes through it.
  const engine = createEngineInstance('subtractive');
  if (engine) {
    const setPS = (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth;
    if (setPS) setPS.call(engine, p);
    laneResources.set(slugFromExtraId(id), { strip, engine });
  }
  return p;
}

const stripFor = (t: TrackId | string): ChannelStrip => {
  // Per-voice drum channel strips (kick/snare/...) — not session lanes, just
  // sub-busses of the drum bus.
  if (t in drums.channels) {
    const ch = drums.channels[t as DrumVoice];
    if (ch) return ch;
  }
  // Slug session lanes — single source of truth.
  const res = laneResources.get(t as string);
  if (res) return res.strip;
  // Legacy mixer track ids still emitted by the classic step-grid mixer:
  // map them onto the canonical slug lane ids.
  if (t === 'bass')    return laneResources.get(LANE_ID_BASS)!.strip;
  if (t === 'poly')    return laneResources.get(LANE_ID_POLY)!.strip;
  if (t === 'drumBus') return laneResources.get(LANE_ID_DRUMS)!.strip;
  // Lazy extras — `poly1`/`poly2`/... aren't in laneResources yet because
  // ensureExtraPoly hasn't been called. Trigger the lazy alloc (which now
  // registers under the slug id too).
  if ((EXTRA_IDS as readonly string[]).includes(t as string)) {
    ensureExtraPoly(t as ExtraId);
    return extraStrips[t as ExtraId]!;
  }
  // Generic extra Session lanes (bass2 / drums2 / etc.) — share the
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

interface LaneWiringDeps {
  laneId: string;
  engine: SynthEngine;
  parent: HTMLElement;
  formatter?: (id: string, v: number) => string;
}

// Phase C: late-bound ref so mountSubtractiveLaneKnobs (defined before
// sessionHost) can still pass sessionState to the mirror once it is available.
let _sessionStateForKnobs: import('./session/session').SessionState | undefined;

/** Walks engine.params, builds the knob/select per param, registers each
 *  under '<laneId>.<spec.id>'. Click/drag writes via engine.setBaseValue.
 *  Delegates to the shared wireEngineParams helper used by engine.buildParamUI. */
function wireLaneKnobs(deps: LaneWiringDeps): void {
  const ctx: import('./engines/engine-types').EngineUIContext = {
    laneId: deps.laneId,
    registerKnob: (k) => registerKnob(k as KnobHandle),
    registry: automationRegistry as unknown as Map<string, unknown>,
    sessionState: _sessionStateForKnobs,
  };
  wireEngineParams(deps.engine, ctx, deps.parent, { formatter: deps.formatter });
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
// Late-bound: set after sessionHost is constructed (sessionHost is const and
// declared further below; this fn reference bridges the temporal gap).
let _lookupEngineIdFn: (laneId: string) => string = (laneId) => {
  // Fallback: consult the pattern for backward compat before sessionHost is ready.
  if (laneId === 'subtractive-1') return seq.pattern.engineId ?? 'subtractive';
  const track = seq.pattern.extraPolyTracks.find((t) => t.id === laneId);
  return track?.engineId ?? 'subtractive';
};

const _lehDeps: LaneEngineHostDeps = {
  get seq() { return seq; },
  get bank() { return bank; },
  get engineSel() { return engineSel; },
  get rebuildEngineParamUI() { return rebuildEngineParamUI; },
  get laneLabels() { return LANE_LABELS as Record<string, string>; },
  lookupEngineId: (laneId: string) => _lookupEngineIdFn(laneId),
};

// Stable call-site wrappers (keep existing callsites in main.ts unchanged)
const getLaneEngineId     = (laneId: string) => leh.getLaneEngineId(_lehState, _lehDeps, laneId);
const getLaneEngineInstance = (laneId: string): SynthEngine | null =>
  laneResources.get(laneId)?.engine ?? null;
const setActiveEngineLane = (laneId: string) => leh.setActiveEngineLane(_lehState, _lehDeps, laneId);
const setSlotConfigurators = (cbs: Array<(() => void) | null>) => leh.setSlotConfigurators(_lehState, cbs);

// Cache: laneId → engine voice. Mono engines reuse the same voice; poly
// engines get a fresh voice per call but the strip is cached per lane.
const laneVoices = new Map<string, import('./engines/engine-types').Voice>();

function ensureLaneStrip(laneId: string): ChannelStrip {
  // Built-in lanes use their dedicated strips.
  if (laneId === 'tb-303-1')      return bassStrip;
  if (laneId === 'drums-1')       return drumBusStrip;
  if (laneId === 'subtractive-1') return polyStrip;
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
  setCurrentLaneForVoice(laneId);
  const voice = engine.createVoice(ctx, strip.input);
  setCurrentLaneForVoice(null);
  laneVoices.set(laneId, voice);
  return voice;
}

// Phase E: allocates a fresh ChannelStrip + engine instance for a dynamically
// added lane and registers them in laneResources. This replaces the old
// ensureExtraPoly(newId) call in onAddLane — the slug-keyed entry is now the
// canonical path; the legacy poly1..poly16 ExtraId mechanism is unchanged.
function ensureLaneResource(laneId: string, engineId: string): void {
  if (laneResources.get(laneId)) return; // already allocated
  const strip = new ChannelStrip(ctx, master, fx);
  const engine = createEngineInstance(engineId);
  if (!engine) return;
  if (engineId === 'subtractive') {
    // SubtractiveEngine needs a PolySynth wired to its audio output before it
    // can schedule notes. Allocate a fresh one per lane.
    const p = new PolySynth(ctx, strip.input);
    p.bpm = seq.bpm;
    (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(p);
  }
  laneResources.set(laneId, { strip, engine });
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

function setBassMode(mode: 'step' | 'piano') {
  if (seq.pattern.bassMode === mode) return;
  // Convert step → piano so the user doesn't lose existing work on first switch.
  if (mode === 'piano' && seq.pattern.bassNotes.length === 0) {
    seq.pattern.bassNotes = bassStepsToNotes(seq.pattern.bass);
  }
  seq.pattern.bassMode = mode;
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
  // Param specs use 'filter.cutoff', 'env.amount', etc.; the runtime
  // TB303.params still uses the legacy short ids ('cutoff', 'envMod'...).
  // Map spec id → live value and push it back into the registered knob.
  const liveValue = (specId: string): number | null => {
    switch (specId) {
      case 'filter.cutoff':    return synth.params.cutoff;
      case 'filter.resonance': return synth.params.resonance;
      case 'env.amount':       return synth.params.envMod;
      case 'env.decay':        return synth.params.decay;
      case 'env.accent':       return synth.params.accent;
      case 'osc.wave':         return synth.params.wave === 'square' ? 1 : 0;
    }
    return null;
  };
  for (const spec of tb303Engine.params) {
    const v = liveValue(spec.id);
    if (v == null) continue;
    automationRegistry.get(`bass.${spec.id}`)?.setValue(v);
  }
}

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
};

function rebuildMixer() {
  mixerEl.innerHTML = '';
  mixerEl.className = 'mixer mixer-classic';
  for (const t of activeTracks()) {
    mixerEl.appendChild(buildMixerColumn(t, mixerDeps));
  }
}

// ── Transport → moved to src/core/transport.ts (wireTransport) ────────────

function propagateBpmToLaneEngines(bpm: number): void {
  // Lane-host engines (fm, karplus, subtractive, wavetable, drums-machine)
  // each carry their own `bpm` field for LFO sync. Push the global tempo
  // through the registry so modulator voices follow tempo changes.
  for (const id of ['fm', 'karplus', 'subtractive', 'wavetable', 'drums-machine']) {
    const eng = getEngine(id) as unknown as { bpm?: number } | undefined;
    if (eng && typeof eng.bpm === 'number') eng.bpm = bpm;
  }
}

bpmInput.addEventListener('input', () => {
  const v = parseInt(bpmInput.value, 10);
  if (!isNaN(v)) {
    seq.bpm = Math.max(40, Math.min(240, v));
    fx.setBpmSync(seq.bpm);
    filterChain.updateBpm(seq.bpm);
    polysynth.bpm = seq.bpm;
    for (const id of EXTRA_IDS) { const p = extraPolys[id]; if (p) p.bpm = seq.bpm; }
    propagateBpmToLaneEngines(seq.bpm);
  }
});
fx.setBpmSync(seq.bpm);
polysynth.bpm = seq.bpm;
for (const id of EXTRA_IDS) { const p = extraPolys[id]; if (p) p.bpm = seq.bpm; }
propagateBpmToLaneEngines(seq.bpm);

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
      const inst = laneResources.get(slugFromExtraId(id))?.engine ?? null;
      if (inst) {
        setCurrentLaneForVoice(id);
        const voice = inst.createVoice(ctx, extraStrips[id]!.input);
        setCurrentLaneForVoice(null);
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
  renderLanes();
});

kitSel.addEventListener('change', () => { drums.setKit(kitSel.value); });

const synthKnobsRow = $<HTMLDivElement>('synth-knobs');
synthKnobsRow.innerHTML = '';
wireLaneKnobs({
  laneId: 'bass',
  engine: tb303Engine,
  parent: synthKnobsRow,
  formatter: (id, v) => id.includes('decay') ? `${(v * 1000).toFixed(0)}ms` : fmtPct(v),
});

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
  });
}

// ── PolySynth knobs (target swappable for multi-poly editing) ─────────────
// activePolyTarget lives in synthEditorState (src/session/synth-editor-routing.ts).

// Subtractive knobs for the 'main' lane are mounted via wireLaneKnobs in the
// boot section (replaces the old buildPolySynthUI / polysynth-ui.ts).

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

// ── Single-entry-point trigger dispatch ───────────────────────────────────
// triggerForLane consults laneResources to get the live engine instance for
// the given lane and dispatches by engine.id. This is the Phase B canonical
// trigger path; the named wrappers below are thin aliases kept so existing
// callers don't need to change (Phase E will delete them).
const triggerForLane = (
  laneId: string,
  note: number,
  time: number,
  gate: number,
  accent: boolean,
  slidingIn: boolean = false,
): void => {
  const res = laneResources.get(laneId);
  if (!res) return;
  const engineId = res.engine.id;

  if (engineId === 'tb303') {
    setCurrentLaneForVoice(laneId);
    const voice = res.engine.createVoice(ctx, res.strip.input);
    setCurrentLaneForVoice(null);
    voice.trigger(note, time, { gateDuration: gate, accent, slide: slidingIn });
    return;
  }

  if (engineId === 'drums-machine') {
    // Drums route through the per-voice DrumMachine API rather than the
    // engine's createVoice path. Map midi → DrumVoice via GM_DRUM_MAP and
    // call drums.trigger directly.
    // NOTE: This branch is not yet exercised by any caller in Phase B — drums
    // still route through separate sequencer paths. Present for completeness
    // so future callers (Phase C/D) can use triggerForLane for drums too.
    const dv = GM_DRUM_MAP[note];
    if (dv) drums.trigger(dv, time, accent);
    return;
  }

  // Poly engines (subtractive / wavetable / fm / karplus).
  // ALL engines must trigger through createVoice so the modulation host can
  // bind LFO/ADSR outputs to the new voice's AudioParams. Direct
  // polysynth.trigger(...) bypasses SubtractiveVoice and its rebind hook —
  // modulator routings would silently drop.
  setCurrentLaneForVoice(laneId);
  const voice = res.engine.createVoice(ctx, res.strip.input);
  setCurrentLaneForVoice(null);
  voice.trigger(note, time, { gateDuration: gate, accent });
};

// Direct triggers (used when arp is off OR scope doesn't include the track).
// These are thin aliases over triggerForLane kept for backward compatibility.
const polyTriggerDirect = (note: number, time: number, gate: number, accent: boolean) => {
  triggerForLane(LANE_ID_POLY, note, time, gate, accent);
};
const bassTriggerDirect = (note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) => {
  triggerForLane(LANE_ID_BASS, note, time, gate, accent, slidingIn);
};
const bassTriggerForArp = (note: number, time: number, gate: number, accent: boolean) => {
  triggerForLane(LANE_ID_BASS, note, time, gate, accent, false);
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
// synthEditorDeps is constructed later (after polySynthUIDeps + polySynthPresetsDeps
// exist). showPolyEditorWrapper reads it lazily at call time.
let synthEditorDeps: import('./session/synth-editor-routing').SetActivePolyTargetDeps | null = null;
const showPolyEditorWrapper = (laneId: string, target: PolySynth, displayName: string) => {
  if (!synthEditorDeps) return;
  showPolyEditor(laneId, target, displayName, synthEditorDeps);
};
const sessionHost = new SessionHost({
  ctx, seq, bank, playBtn,
  resetAutomationPosition,
  triggerForLane,
  drums,
  drumLanes: DRUM_LANES,
  markTrackActive,
  ensureExtraPoly: ensureExtraPoly as (id: string) => PolySynth,
  extraStrips: extraStrips as Partial<Record<string, ChannelStrip>>,
  getLaneEngineId,
  ensureLaneVoice,
  showPolyEditor: showPolyEditorWrapper,
  polysynth,
  mixerDeps,
  getAppMode,
  midiLabel,
  automationRegistry,
  getAutoAbsSubIdx,
  onActiveLaneChanged: () => populateAutoParamSelectWrapper(),
  laneResources,
  ensureLaneResource,
});
synthEditorState.activePolyTarget = polysynth;
sessionHost.init();
// Phase C: bind sessionState into knob ctx so future knob changes mirror into
// lane.engineState.params. Set AFTER sessionHost.init() so the initial
// mountSubtractiveLaneKnobs('main') call (pre-sessionHost) stays no-op.
_sessionStateForKnobs = sessionHost.state;
// Now sessionHost is live — upgrade the lookupEngineId impl to use SessionState
// as the source of truth (replaces the pattern-based fallback used at boot).
_lookupEngineIdFn = (laneId: string) =>
  sessionHost.state.lanes.find((l) => l.id === laneId)?.engineId ?? 'subtractive';

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
/** After a preset / randomize mutates an engine's base state, push the new
 *  values back into the lane's knob handles so the UI reflects them.
 *  (onChange only fires on user drag, not on programmatic state changes.) */
function refreshLaneKnobs(laneId: string, engine: SynthEngine): void {
  for (const spec of engine.params) {
    const handle = automationRegistry.get(`${laneId}.${spec.id}`);
    handle?.setValue(engine.getBaseValue(spec.id));
  }
}

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
populateAutoParamSelectWrapper = () => {
  const prefix = activeEnginePrefix();
  populateAutoParamSelect(automationDeps, prefix);
};

function activeEnginePrefix(): string | null {
  // Only filter in Session mode.
  if (appMode !== 'session') return null;
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
};
wireEngineSelector(engineSelectorDeps, currentEngineId);

const polySynthPresetsDeps: PolySynthPresetsDeps = {
  getActivePolyTarget: () => synthEditorState.activePolyTarget ?? polysynth,
  getActiveEngineLaneId: () => _lehState.activeLaneId,
  getLaneEngineId,
  getLaneEngineInstance,
  rebuildEngineParamUI,
  refreshLaneKnobs: (laneId) => {
    const engineId = getLaneEngineId(laneId);
    if (engineId === 'subtractive' && laneId === 'subtractive-1') {
      if (mainSubtractive) refreshLaneKnobs('main', mainSubtractive);
    } else {
      const inst = getLaneEngineInstance(laneId);
      if (inst) refreshLaneKnobs(laneId, inst);
    }
  },
};

const polyModeDeps: PolyModeDeps = {
  getSeqPattern: () => seq.pattern,
  stepsToNotes,
  getMelodySteps: () => seq.pattern.melody,
  setPolyPatternMode: (mode) => { seq.pattern.polyMode = mode; },
  rebuildPolyTrack: () => { /* Classic-only re-render — Session re-renders via sessionHost.renderWithMixer() */ },
  setBassMode,
  updateBassModeButtons,
};

// Now that polySynthPresetsDeps exist, wire synthEditorDeps
// (referenced lazily by showPolyEditorWrapper above).
synthEditorDeps = {
  refreshPolyKnobsFromState: () => { if (mainSubtractive) refreshLaneKnobs(_lehState.activeLaneId, mainSubtractive); },
  refreshPolyPresetSelect: () => refreshPolyPresetSelect(),
  setActiveEngineLane: (laneId: string) => setActiveEngineLane(laneId),
};

// Build the Subtractive engine's knobs into the per-section divs declared in
// index.html. Each spec.id prefix routes to its matching container so the
// OSC / FILTER / AMP / MASTER section grouping stays intact.
//
// Reusable as a function so rebuildEngineParamUI can re-mount the knobs
// after `unregisterKnobsByPrefix` evicts them from the registry (otherwise
// the modulator-panel destination dropdown comes up empty for Subtractive
// lanes — the per-section knobs live permanently in the DOM but their
// handles need to stay registered for destinationIds to enumerate them).
function mountSubtractiveLaneKnobs(laneId: string): void {
  const sectionMap: Array<[string, string]> = [
    ['osc1.',   'poly-osc1-knobs'],
    ['osc2.',   'poly-osc2-knobs'],
    ['sub.',    'poly-sub-knobs'],
    ['noise.',  'poly-noise-knobs'],
    ['filter.', 'poly-filter-knobs'],
    ['amp.',    'poly-amp-knobs'],
    ['master.', 'poly-master-knobs'],
  ];
  const engine = laneResources.get(laneId)?.engine;
  if (!engine) return;
  const ctx: import('./engines/engine-types').EngineUIContext = {
    laneId,
    registerKnob: (k) => registerKnob(k as KnobHandle),
    registry: automationRegistry as unknown as Map<string, unknown>,
    lookupLaneDisplayName: (id) => sessionHost?.state.lanes.find((l) => l.id === id)?.name,
    sessionState: _sessionStateForKnobs,
  };
  for (const [prefix, divId] of sectionMap) {
    const parent = document.getElementById(divId);
    if (!parent) continue;
    parent.innerHTML = '';
    wireEngineParams(engine, ctx, parent, {
      filter: (id) => id.startsWith(prefix),
    });
  }
}
mountSubtractiveLaneKnobs(LANE_ID_POLY);
buildArpUI({ getExtraPolyTracks: () => seq.pattern.extraPolyTracks });
const fxUIDeps: FxUIDeps = { fx, filterChain, getBpm: () => seq.bpm, registerKnob };
wireFxUI(fxUIDeps);
wireDrumMasterUI({ drumBusStrip, registerKnob, fmtPct, fmtDb });
fxApplyDelaySync(fxUIDeps);
const transportDeps: TransportDeps = {
  seq, bank, ctx, playBtn, barsSel,
  resetAutomationPosition,
  renderLanes,
  updateBassModeButtons,
};
wireTransport(transportDeps);
rebuildMixer();
wireAutomationTab(automationDeps);
wirePresetLibrary({ seq });
wirePolyControls(polySynthPresetsDeps);
wirePolyMode(polyModeDeps);
wireSlotCopyPanel({
  bank, seq, barsSel,
  renderLanes,
  flashButton,
});
wireCopyNotesPanel({ seq });

// ── Demo wiring (deps built here, functions live in demo-minimal-techno.ts) ─
const demoDeps: import('./demo/demo-minimal-techno').DemoDeps = {
  seq, bank, bpmInput, barsSel,
  chainEnabled: () => isChainEnabled(),
  chainBtn: $<HTMLButtonElement>('chain-toggle'),
  setSlotConfigurators,
  getLaneEngineInstance,
  updateSlotButtons,
  renderLanes,
  updateBassModeButtons,
  rebuildMixer,
};
wireDemoMinimalTechno(demoDeps);

// ── MIDI import wiring (see src/midi-import.ts) ───────────────────────────
wireMidiImport({
  seq,
  muteState: muteState as Record<string, boolean>,
  applyMuteSolo,
  refreshLoopBtn,
  refresh: () => sessionHost.renderWithMixer(),
  flashButton,
  ensureExtraPoly: ensureExtraPoly as (id: Parameters<typeof ensureExtraPoly>[0]) => PolySynth,
  applyPresetByName,
});

// ── App mode toggle (Classic vs Session) ──────────────────────────────────
function applyModeVisibility() {
  const tabBar      = document.querySelector<HTMLElement>('.tab-bar');
  const pages       = document.querySelectorAll<HTMLElement>('.page');
  const sessionView = document.getElementById('session-view');
  const mixerPanel  = document.querySelector<HTMLElement>('.mixer-panel');
  const arpPanel    = document.querySelector<HTMLElement>('.arp-panel');
  const copyPanels  = document.querySelectorAll<HTMLElement>('.copy-row, .copy-track-panel, .presets-panel');
  const inClassic   = appMode === 'classic';

  if (tabBar)      tabBar.hidden      = false;
  const synthRow = document.querySelector<HTMLElement>('.synth-row');
  if (synthRow) synthRow.hidden = inClassic;  // only show in Session mode
  // In Classic mode, the active synth tab's page shows. In Session mode the
  // synth pages stay hidden until the user clicks a lane tab (onEditLane in
  // session-host then unhides the matching page).
  for (const p of pages) p.hidden = !inClassic || p.dataset.page !== getActiveClassicTab();
  if (sessionView) sessionView.hidden = inClassic;
  // Hide Classic-only panels in Session: mixer (per-column strips replace it),
  // copy-pattern row, preset library. Keep ARP visible (it works in both modes).
  if (mixerPanel) mixerPanel.hidden = !inClassic;
  for (const p of copyPanels) p.hidden = !inClassic;
  if (arpPanel) arpPanel.hidden = false;

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
  getBassRollEntry: () => null,
  refreshKnobsFromSynth,
  rebuildPolyTrack: () => { /* Classic-only — Session re-renders via sessionHost */ },
  getActiveEngineLaneId: () => _lehState.activeLaneId,
});
const automationTickDeps: AutomationTickDeps = {
  seq,
  automationRegistry,
  getAppMode,
  getLaneStates: () => sessionHost.laneStates,
  ctx,
  redrawAllLanes,
  trackActiveUntil,
  getEngineForLane: (laneId) => laneResources.get(laneId)?.engine ?? undefined,
  getActiveModVoice: (laneId, modId) => getActiveModVoice(laneId, modId),
};
startAutomationTick(automationTickDeps);
// Phase E: switch boot to the new SessionState-direct demo. The
// PatternBank-based applyMinimalTechnoDemo path stays exported for
// transitional reasons but is no longer auto-applied.
{
  const demoSession = buildMinimalTechnoDemoSession();
  sessionHost.applyLoadedSessionState(demoSession);
  setAppMode('session');
}
startVisualizer({ ctx, analyser, vizCanvas });

// ── Save Manager v2 (see src/save-wiring.ts) ──────────────────────────────
const saveWiringDeps: import('./save/save-wiring').SaveWiringDeps = {
  seq, synth, polysynth, drums, master,
  volInput, bpmInput, swingInput, kitSel, waveSel, scaleSel, rootSel,
  bank, barsSel,
  activeTracks: () => activeTracks() as string[],
  stripFor: (t) => stripFor(t as TrackId),
  muteState: muteState as Record<string, boolean>,
  soloState: soloState as Record<string, boolean>,
  applyMuteSolo,
  sessionHost,
  setAppMode,
  getAppMode,
  rebuildMixer,
  refreshKnobsFromSynth,
  renderLanes,
  fx,
  filterChain,
  flashButton,
};
wireSaveManager(saveWiringDeps);
bootRecoveryLoad(saveWiringDeps);

// Phase E: Boot always lands in Session mode (see buildMinimalTechnoDemoSession
// call above). The data-pure-session guard is no longer needed.
