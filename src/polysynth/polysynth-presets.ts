import { PolySynth, type PolySynthParams } from './polysynth';
import { FACTORY_POLY_PRESETS } from './poly-presets';
import { randomizePolySynth } from '../core/random';
import type { SynthEngine } from '../engines/engine-types';
import { refreshPolyKnobsFromState } from './polysynth-ui';

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
  getActivePolyTarget: () => PolySynth;
  getActiveEngineLaneId: () => string;
  getLaneEngineId: (laneId: string) => string;
  getLaneEngineInstance: (laneId: string) => SynthEngine | null;
  rebuildEngineParamUI: () => void;
}

let _deps: PolySynthPresetsDeps | null = null;

export function applyPolyParams(params: PolySynthParams): void {
  const target = _deps!.getActivePolyTarget();
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
  refreshPolyKnobsFromState();
}

export function applyPresetByName(poly: PolySynth, name: string): void {
  const p = FACTORY_POLY_PRESETS.find((x) => x.name === name);
  if (p) {
    poly.params = JSON.parse(JSON.stringify(p.params)) as PolySynthParams;
    polyPresetName.set(poly, `factory:${name}`);
  }
}

export function refreshPolyPresetSelect(): void {
  const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
  if (!sel) return;
  const current = polyPresetName.get(_deps!.getActivePolyTarget());
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

export function wirePolyControls(deps: PolySynthPresetsDeps): void {
  _deps = deps;

  const btn = document.getElementById('poly-randomize') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    const engineId = deps.getLaneEngineId(deps.getActiveEngineLaneId());
    if (engineId === 'subtractive') {
      const target = deps.getActivePolyTarget();
      randomizePolySynth(target);
      polyPresetName.delete(target);
      refreshPolyKnobsFromState();
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

  (document.getElementById('poly-preset-load') as HTMLButtonElement).addEventListener('click', () => {
    const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
    const val = sel.value;
    if (!val || val === '__custom__') return;
    const target = deps.getActivePolyTarget();
    if (val.startsWith('factory:')) {
      const name = val.slice('factory:'.length);
      const p = FACTORY_POLY_PRESETS.find((x) => x.name === name);
      if (p) { applyPolyParams(p.params); polyPresetName.set(target, val); }
    } else if (val.startsWith('user:')) {
      const name = val.slice('user:'.length);
      const presets = loadUserPolyPresets();
      if (presets[name]) { applyPolyParams(presets[name]); polyPresetName.set(target, val); }
    }
  });

  (document.getElementById('poly-preset-save') as HTMLButtonElement).addEventListener('click', () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const target = deps.getActivePolyTarget();
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
