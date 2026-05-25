import { listEngines } from './registry';
import type { SynthEngine } from './engine-types';
import { createKnob, type KnobHandle } from '../core/knob';

export interface EngineSelectorUIDeps {
  engineSel: HTMLSelectElement;
  getActiveLaneId: () => string;
  getLaneEngineId: (laneId: string) => string;
  getLaneEngineInstance: (laneId: string) => SynthEngine | null;
  ensureLaneEngine: (laneId: string, engineId: string) => SynthEngine | null;
  setLaneEngineIdInPattern: (laneId: string, engineId: string) => void;
  setCurrentEngineId: (id: string) => void;
  automationRegistry: Map<string, KnobHandle>;
  registerKnob: (k: KnobHandle) => void;
  populateAutoParamSelect: () => void;
}

let _deps: EngineSelectorUIDeps | null = null;
let _engineParamEl: HTMLDivElement | null = null;
let _polyPage: Element | null = null;

export function unregisterKnobsByPrefix(prefix: string, automationRegistry: Map<string, KnobHandle>): void {
  for (const id of Array.from(automationRegistry.keys())) {
    if (id.startsWith(prefix)) automationRegistry.delete(id);
  }
}

export function rebuildEngineParamUI(): void {
  const deps = _deps!;
  const engineParamEl = _engineParamEl!;
  const polyPage = _polyPage!;

  engineParamEl.innerHTML = '';
  // Drop any previously-registered knobs for this lane so we don't accumulate
  // stale handles in the automation registry.
  const activeLaneId = deps.getActiveLaneId();
  unregisterKnobsByPrefix(`${activeLaneId}.`, deps.automationRegistry);

  // Show/hide subtractive-specific rows based on the ACTIVE lane's engine
  const engineId = deps.getLaneEngineId(activeLaneId);
  const subtractiveRows = polyPage.querySelectorAll<HTMLElement>('[data-engine="subtractive"]');
  for (const row of subtractiveRows) {
    row.style.display = engineId === 'subtractive' ? '' : 'none';
  }
  if (engineId === 'subtractive') {
    engineParamEl.style.display = 'none';
    deps.populateAutoParamSelect();
    return;
  }
  const instance = deps.getLaneEngineInstance(activeLaneId);
  if (!instance) return;
  engineParamEl.style.display = '';
  const buildCtx = {
    laneId: activeLaneId,
    idPrefix: activeLaneId,
    registerKnob: (k: unknown) => deps.registerKnob(k as KnobHandle),
  };
  instance.buildParamUI(engineParamEl, buildCtx);
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
      deps.registerKnob(k);
      knobRow.appendChild(k.el);
    }
    row.appendChild(knobRow);
    engineParamEl.appendChild(row);
  }
  deps.populateAutoParamSelect();
}

export function populateEngineSelect(deps: EngineSelectorUIDeps, currentEngineId: string): void {
  deps.engineSel.innerHTML = '';
  for (const engine of listEngines('polyhost')) {
    const opt = document.createElement('option');
    opt.value = engine.id;
    opt.textContent = engine.name;
    if (engine.id === currentEngineId) opt.selected = true;
    deps.engineSel.appendChild(opt);
  }
}

export function wireEngineSelector(deps: EngineSelectorUIDeps, initialEngineId: string): void {
  _deps = deps;

  // Build the engine-params container and insert it into the poly page
  const polyPage = document.querySelector('[data-page="poly"]')!;
  _polyPage = polyPage;
  const engineParamEl = document.createElement('div');
  engineParamEl.id = 'engine-params';
  engineParamEl.style.display = 'none';
  _engineParamEl = engineParamEl;
  const firstPolyRow = polyPage.querySelector('.poly-section')!;
  firstPolyRow.parentNode!.insertBefore(engineParamEl, firstPolyRow.nextSibling);

  populateEngineSelect(deps, initialEngineId);

  deps.engineSel.addEventListener('change', () => {
    const newId = deps.engineSel.value;
    deps.setLaneEngineIdInPattern(deps.getActiveLaneId(), newId);
    deps.ensureLaneEngine(deps.getActiveLaneId(), newId);
    if (deps.getActiveLaneId() === 'main') deps.setCurrentEngineId(newId); // legacy mirror
    rebuildEngineParamUI();
  });
}
