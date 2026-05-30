import { PolySynth, POLY_DEFAULTS, type PolySynthParams } from './polysynth';
import { randomizePolySynth } from '../core/random';
import type { SynthEngine } from '../engines/engine-types';
import { getCachedPresets } from '../presets/preset-loader';
import { withUndo, type HistoryDeps } from '../save/history-wiring';

/** Convert a flat dot-path subtractive preset (e.g. `"osc1.wave": 0`,
 *  `"filter.cutoff": 0.55`) back into the nested PolySynthParams tree the
 *  polysynth UI still operates on. Wave indices are mapped back to their
 *  OscillatorType string. Fields not present in the flat preset keep their
 *  POLY_DEFAULTS value (so e.g. `osc1.octave`, `lfo1.*` survive). */
function flatToPolyParams(flat: Record<string, number>): PolySynthParams {
  const out = JSON.parse(JSON.stringify(POLY_DEFAULTS)) as PolySynthParams;
  const WAVE_VALUES: OscillatorType[] = ['sawtooth', 'square', 'triangle', 'sine'];
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let cur: Record<string, unknown> = out as unknown as Record<string, unknown>;
    let bail = false;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cur[parts[i]];
      if (!next || typeof next !== 'object') { bail = true; break; }
      cur = next as Record<string, unknown>;
    }
    if (bail) continue;
    const leaf = parts[parts.length - 1];
    if (leaf === 'wave' && typeof v === 'number') {
      const idx = Math.max(0, Math.min(WAVE_VALUES.length - 1, Math.round(v)));
      cur[leaf] = WAVE_VALUES[idx];
    } else {
      cur[leaf] = v;
    }
  }
  return out;
}

/** Typed view over the JSON-loaded subtractive preset cache, materialised as
 *  the nested `PolySynthParams` shape the polysynth UI consumes. Subtractive
 *  presets are stored flat (dot-path id → value); we expand them on the fly. */
function getFactoryPolyPresets(): { name: string; params: PolySynthParams }[] {
  const flat = getCachedPresets('subtractive');
  return flat.map((p) => ({
    name: p.name,
    params: flatToPolyParams(p.params as unknown as Record<string, number>),
  }));
}

// ── PolySynth preset state ─────────────────────────────────────────────────
const POLY_PRESETS_KEY = 'tb303-poly-presets-v1';

// Remembers which preset is currently applied to each PolySynth so the
// preset dropdown reflects the active synth's choice when you switch.
export const polyPresetName = new Map<PolySynth, string>();

export function loadUserPolyPresets(): Record<string, PolySynthParams> {
  const raw = localStorage.getItem(POLY_PRESETS_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, PolySynthParams>; } catch { return {}; }
}

export function saveUserPolyPresets(presets: Record<string, PolySynthParams>): void {
  localStorage.setItem(POLY_PRESETS_KEY, JSON.stringify(presets));
}

export interface PolySynthPresetsDeps {
  // Phase G: may return null before boot lane is allocated.
  getActivePolyTarget: () => PolySynth | null;
  getActiveEngineLaneId: () => string;
  getLaneEngineId: (laneId: string) => string;
  getLaneEngineInstance: (laneId: string) => SynthEngine | null;
  rebuildEngineParamUI: () => void;
  /** Push current engine base values back into the lane's knob UI handles
   *  after a preset or randomize mutates the underlying state. */
  refreshLaneKnobs: (laneId: string) => void;
  /** When provided, user-initiated preset changes (dropdown select / Load
   *  button click) are wrapped with withUndo so each becomes one undoable
   *  entry. Omit for programmatic/session-load callers. */
  historyDeps?: HistoryDeps;
}

let _deps: PolySynthPresetsDeps | null = null;

export function applyPolyParams(params: PolySynthParams): void {
  const target = _deps!.getActivePolyTarget();
  if (!target) return;
  const d = JSON.parse(JSON.stringify(target.params)) as PolySynthParams;
  target.params = {
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
  _deps!.refreshLaneKnobs(_deps!.getActiveEngineLaneId());
}

export function applyPresetByName(poly: PolySynth, name: string): void {
  const presets = getFactoryPolyPresets();
  const p = presets.find((x) => x.name === name);
  if (p) {
    poly.params = JSON.parse(JSON.stringify(p.params)) as PolySynthParams;
    polyPresetName.set(poly, `factory:${name}`);
  }
}

export function refreshPolyPresetSelect(): void {
  const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
  if (!sel) return;
  const target = _deps?.getActivePolyTarget();
  const current = target ? polyPresetName.get(target) : undefined;
  if (current) sel.value = current;
  else sel.value = '__custom__';
}

export function populatePolyPresetSelect(): void {
  const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
  if (!sel) return;
  sel.innerHTML = '';

  const custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = '(custom — no preset)';
  sel.appendChild(custom);

  // Filter by the active lane's engine. Subtractive uses the PolySynth
  // factory presets (nested params); other engines use their own SynthEngine
  // .presets array (flat id → value map).
  const engineId = _deps?.getLaneEngineId(_deps.getActiveEngineLaneId()) ?? 'subtractive';

  if (engineId === 'subtractive') {
    const factoryGroup = document.createElement('optgroup');
    factoryGroup.label = 'Factory';
    for (const p of getFactoryPolyPresets()) {
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
    return;
  }

  // Non-subtractive engine: pull presets directly from the active lane's
  // SynthEngine instance. Each preset's `params` is a flat id → value map.
  const instance = _deps?.getLaneEngineInstance(_deps.getActiveEngineLaneId());
  if (!instance) return;
  const presets = instance.presets ?? [];
  if (presets.length === 0) return;
  const factoryGroup = document.createElement('optgroup');
  factoryGroup.label = 'Factory';
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = `engine:${p.name}`;
    opt.textContent = p.name;
    factoryGroup.appendChild(opt);
  }
  sel.appendChild(factoryGroup);
}

/** Apply a non-subtractive engine preset by writing each flat param to the
 *  active lane's engine instance, then refreshing the knob UI. */
function applyEnginePreset(presetName: string): void {
  const deps = _deps!;
  const laneId = deps.getActiveEngineLaneId();
  const instance = deps.getLaneEngineInstance(laneId);
  if (!instance) return;
  const preset = instance.presets.find((p) => p.name === presetName);
  if (!preset) return;
  for (const [id, value] of Object.entries(preset.params)) {
    instance.setBaseValue(id, value);
  }
  deps.refreshLaneKnobs(laneId);
}

export function wirePolyControls(deps: PolySynthPresetsDeps): void {
  _deps = deps;

  const btn = document.getElementById('poly-randomize') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    const engineId = deps.getLaneEngineId(deps.getActiveEngineLaneId());
    if (engineId === 'subtractive') {
      const target = deps.getActivePolyTarget();
      if (!target) return;
      randomizePolySynth(target);
      polyPresetName.delete(target);
      deps.refreshLaneKnobs(deps.getActiveEngineLaneId());
      refreshPolyPresetSelect();
      return;
    }
    const instance = deps.getLaneEngineInstance(deps.getActiveEngineLaneId());
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
    deps.rebuildEngineParamUI();
  });

  populatePolyPresetSelect();

  const loadCurrentPreset = () => {
    const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
    const val = sel.value;
    if (!val || val === '__custom__') return;
    const target = deps.getActivePolyTarget();
    if (!target) return;
    if (val.startsWith('factory:')) {
      const name = val.slice('factory:'.length);
      const p = getFactoryPolyPresets().find((x) => x.name === name);
      if (p) { applyPolyParams(p.params); polyPresetName.set(target, val); }
    } else if (val.startsWith('user:')) {
      const name = val.slice('user:'.length);
      const presets = loadUserPolyPresets();
      if (presets[name]) { applyPolyParams(presets[name]); polyPresetName.set(target, val); }
    } else if (val.startsWith('engine:')) {
      const name = val.slice('engine:'.length);
      applyEnginePreset(name);
    }
  };

  // Auto-load on change — selecting a preset applies it immediately, no Load
  // button needed. The Load button stays as a no-op fallback for now (in case
  // the user wants to re-apply the current selection).
  const presetSel = document.getElementById('poly-preset-select') as HTMLSelectElement;
  presetSel.addEventListener('change', () => {
    if (deps.historyDeps) withUndo(deps.historyDeps, loadCurrentPreset);
    else loadCurrentPreset();
  });
  (document.getElementById('poly-preset-load') as HTMLButtonElement)
    .addEventListener('click', () => {
      if (deps.historyDeps) withUndo(deps.historyDeps, loadCurrentPreset);
      else loadCurrentPreset();
    });

  (document.getElementById('poly-preset-save') as HTMLButtonElement).addEventListener('click', () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const target = deps.getActivePolyTarget();
    if (!target) return;
    const presets = loadUserPolyPresets();
    presets[trimmed] = JSON.parse(JSON.stringify(target.params)) as PolySynthParams;
    saveUserPolyPresets(presets);
    populatePolyPresetSelect();
    polyPresetName.set(target, `user:${trimmed}`);
    refreshPolyPresetSelect();
  });

  (document.getElementById('poly-preset-delete') as HTMLButtonElement).addEventListener('click', () => {
    const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
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

export interface PolyModeDeps {
  getSeqPattern: () => { polyMode: 'step' | 'piano'; polyNotes: import('../core/notes').NoteEvent[]; melody: import('../core/sequencer').PolyStep[] };
  stepsToNotes: (steps: import('../core/sequencer').PolyStep[]) => import('../core/notes').NoteEvent[];
  getMelodySteps: () => import('../core/sequencer').PolyStep[];
  setPolyPatternMode: (mode: 'step' | 'piano') => void;
  rebuildPolyTrack: () => void;
  setBassMode: (mode: 'step' | 'piano') => void;
  updateBassModeButtons: () => void;
}

function updatePolyModeButtons(deps: PolyModeDeps): void {
  const stepBtn  = document.getElementById('poly-mode-step') as HTMLButtonElement;
  const pianoBtn = document.getElementById('poly-mode-piano') as HTMLButtonElement;
  const mode = deps.getSeqPattern().polyMode;
  stepBtn.classList.toggle('primary',  mode === 'step');
  pianoBtn.classList.toggle('primary', mode === 'piano');
}

export function wirePolyMode(deps: PolyModeDeps): void {
  const setPolyMode = (mode: 'step' | 'piano') => {
    const pattern = deps.getSeqPattern();
    if (pattern.polyMode === mode) return;
    if (mode === 'piano' && pattern.polyNotes.length === 0) {
      pattern.polyNotes = deps.stepsToNotes(deps.getMelodySteps());
    }
    deps.setPolyPatternMode(mode);
    deps.rebuildPolyTrack();
    updatePolyModeButtons(deps);
  };

  (document.getElementById('poly-mode-step') as HTMLButtonElement)
    .addEventListener('click', () => setPolyMode('step'));
  (document.getElementById('poly-mode-piano') as HTMLButtonElement)
    .addEventListener('click', () => setPolyMode('piano'));
  updatePolyModeButtons(deps);

  (document.getElementById('bass-mode-step') as HTMLButtonElement)
    .addEventListener('click', () => deps.setBassMode('step'));
  (document.getElementById('bass-mode-piano') as HTMLButtonElement)
    .addEventListener('click', () => deps.setBassMode('piano'));
  deps.updateBassModeButtons();
}
