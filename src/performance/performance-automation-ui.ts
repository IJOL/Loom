// Editable automation lanes for Performance view. Reuses automation-painter
// (drawLane/attachLanePainter). Pure-render: callers pass the curve + callbacks;
// we never touch the audio graph here. The curve is already painter-shaped
// ({ values, enabled, stepped }) after Task 1.
import type { KnobHandle } from '../core/knob';
import type { AutomationCurve } from './performance';
import {
  drawLane, attachLanePainter, formatNum,
  type AutoBrush, type PainterDeps,
} from '../automation/automation-painter';

/** Group dotted param ids by their first segment, preserving insertion order. */
export function groupParamsByPrefix(ids: Iterable<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const prefix = id.split('.')[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(id);
  }
  return groups;
}

export interface PerfAutoDeps {
  registry: Map<string, KnobHandle>;
  /** Width in px for a full-arrangement canvas at the current zoom. */
  laneWidthPx: number;
  getBrush: () => AutoBrush;
  /** A single global playhead is used, so painterDeps.seq is the master seq
   *  (not playing during arrangement play) → drawLane skips its intra-lane line. */
  painterDeps: PainterDeps;
  onAdd: (paramId: string) => void;
  onRemove: (paramId: string) => void;
  onEdited: () => void;
}

/** Build the "+ Automation" header: a grouped param select + add button. */
export function buildAutomationHeader(deps: PerfAutoDeps): HTMLElement {
  const header = document.createElement('div');
  header.className = 'perf-auto-header';
  const sel = document.createElement('select');
  sel.className = 'perf-auto-param-select';
  for (const [prefix, ids] of groupParamsByPrefix(deps.registry.keys())) {
    const og = document.createElement('optgroup');
    og.label = prefix;
    for (const id of ids) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${id} — ${deps.registry.get(id)?.meta.label ?? ''}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'rnd primary';
  addBtn.textContent = '+ Automation';
  addBtn.addEventListener('click', () => { if (sel.value) deps.onAdd(sel.value); });
  header.append(sel, addBtn);
  return header;
}

/** Build one editable lane for a curve. The painter mutates curve.values in
 *  place; flags (enabled/stepped) toggle from the header buttons. */
export function buildAutomationLane(curve: AutomationCurve, deps: PerfAutoDeps): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'perf-auto-lane';
  const entry = deps.registry.get(curve.paramId);
  if (!entry) wrap.classList.add('missing');

  const hdr = document.createElement('div');
  hdr.className = 'perf-auto-lane-header';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `${curve.paramId}${entry ? '' : ' (no disponible)'}`;

  const enableBtn = document.createElement('button');
  enableBtn.className = 'enable' + (curve.enabled !== false ? ' active' : '');
  enableBtn.textContent = curve.enabled !== false ? 'On' : 'Off';
  enableBtn.addEventListener('click', () => {
    const isOn = curve.enabled !== false;
    curve.enabled = !isOn;
    enableBtn.classList.toggle('active', curve.enabled);
    enableBtn.textContent = curve.enabled ? 'On' : 'Off';
    draw(); deps.onEdited();
  });

  const stepBtn = document.createElement('button');
  stepBtn.className = 'stepped' + (curve.stepped ? ' active' : '');
  stepBtn.textContent = curve.stepped ? 'Stepped' : 'Smooth';
  stepBtn.addEventListener('click', () => {
    curve.stepped = !curve.stepped;
    stepBtn.classList.toggle('active', !!curve.stepped);
    stepBtn.textContent = curve.stepped ? 'Stepped' : 'Smooth';
    draw(); deps.onEdited();
  });

  const range = document.createElement('span');
  range.className = 'perf-auto-range';
  if (entry) range.textContent = `[${formatNum(entry.meta.min)} .. ${formatNum(entry.meta.max)}]`;

  const rm = document.createElement('button');
  rm.className = 'rnd';
  rm.textContent = '×';
  rm.title = 'Quitar lane';
  rm.addEventListener('click', () => deps.onRemove(curve.paramId));

  hdr.append(label, enableBtn, stepBtn, range, rm);
  wrap.appendChild(hdr);

  const canvas = document.createElement('canvas');
  canvas.className = 'perf-auto-canvas';
  canvas.width = Math.max(120, Math.round(deps.laneWidthPx));
  canvas.height = 64;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = '64px';
  wrap.appendChild(canvas);

  // curve already has the painter's {values, enabled, stepped} shape.
  const laneView = curve as { values: number[]; enabled: boolean; stepped?: boolean };
  const draw = () =>
    drawLane(canvas, { values: laneView.values, enabled: curve.enabled !== false, stepped: curve.stepped }, deps.painterDeps);
  draw();
  attachLanePainter(canvas, laneView, () => { draw(); }, deps.getBrush);
  canvas.addEventListener('pointerup', () => deps.onEdited());

  return wrap;
}
