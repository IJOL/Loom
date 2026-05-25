import { type KnobHandle } from './knob';
import { AUTOMATION_SUB_RES } from './pattern';
import type { Sequencer } from './sequencer';
import {
  type AutoBrush,
  type PainterDeps,
  ensureLaneSize,
  snapLaneToSteps,
  drawLane,
  attachLanePainter,
  formatNum,
} from './automation-painter';

export { ensureLaneSize, snapLaneToSteps } from './automation-painter';

export interface AutomationUIDeps extends PainterDeps {
  seq: Sequencer;
  automationRegistry: Map<string, KnobHandle>;
  getAutoAbsSubIdx: () => number;
  extraIds: readonly string[];
  laneLabels: Record<string, string>;
}

// Brush state — mutable singleton read by attachLanePainter via getBrush().
let autoBrush: AutoBrush = 'line';
const getBrush = () => autoBrush;

// Lane canvas refs — populated by renderLanes, read by redrawAllLanes.
export const laneCanvases: Array<{ paramId: string; draw: () => void }> = [];

// ── Param select ──────────────────────────────────────────────────────────

export function populateAutoParamSelect(deps: AutomationUIDeps): void {
  const sel = document.getElementById('auto-param-select') as HTMLSelectElement;
  sel.innerHTML = '';
  const groups: Record<string, Array<{ id: string; label: string }>> = {};
  for (const [id, k] of deps.automationRegistry) {
    const prefix = id.split('.')[0];
    (groups[prefix] = groups[prefix] || []).push({ id, label: k.meta.label ?? id });
  }
  const groupOrder = ['tb303', 'poly', 'fx', 'mix', 'main', ...deps.extraIds];
  const groupNames: Record<string, string> = {
    tb303: 'TB-303', poly: 'PolySynth (subtractive)', fx: 'Master FX', mix: 'Mixer',
    main: 'MAIN (engine)',
  };
  for (const id of deps.extraIds) groupNames[id] = `${deps.laneLabels[id] ?? id} (engine)`;
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

// ── Lane list ──────────────────────────────────────────────────────────────

export function addLane(paramId: string, deps: AutomationUIDeps): void {
  const entry = deps.automationRegistry.get(paramId);
  if (!entry) return;
  const lengthBars = Math.max(1, deps.seq.length / 16);
  const total = lengthBars * 16 * AUTOMATION_SUB_RES;
  deps.seq.pattern.automation.push({
    paramId, enabled: true, stepped: false, lengthBars,
    values: Array.from({ length: total }, () => 0.5),
  });
  renderLanes(deps);
}

function removeLane(idx: number, deps: AutomationUIDeps): void {
  deps.seq.pattern.automation.splice(idx, 1);
  renderLanes(deps);
}

export function renderLanes(deps: AutomationUIDeps): void {
  const container = document.getElementById('auto-lanes') as HTMLDivElement;
  container.innerHTML = '';
  laneCanvases.length = 0;

  deps.seq.pattern.automation.forEach((lane, idx) => {
    const entry = deps.automationRegistry.get(lane.paramId);
    if (!entry) return;
    ensureLaneSize(lane, deps.seq.length);
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
    removeBtn.addEventListener('click', () => removeLane(idx, deps));

    header.append(labelEl, enableBtn, steppedBtn, barsSel, rangeEl, removeBtn);
    wrap.appendChild(header);

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 90;
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    const draw = () => drawLane(canvas, lane, deps);
    attachLanePainter(canvas, lane, draw, getBrush);
    draw();
    laneCanvases.push({ paramId: lane.paramId, draw });
  });
}

export function redrawAllLanes(): void {
  for (const { draw } of laneCanvases) draw();
}

// ── Tab wiring ─────────────────────────────────────────────────────────────

export function wireAutomationTab(deps: AutomationUIDeps): void {
  populateAutoParamSelect(deps);
  (document.getElementById('auto-add') as HTMLButtonElement).addEventListener('click', () => {
    const sel = document.getElementById('auto-param-select') as HTMLSelectElement;
    if (sel.value) addLane(sel.value, deps);
  });
  const setBrush = (b: AutoBrush) => {
    autoBrush = b;
    document.querySelectorAll<HTMLButtonElement>('button.rnd').forEach((btn) => {
      if (btn.id === 'auto-brush-line') btn.classList.toggle('primary', b === 'line');
      if (btn.id === 'auto-brush-flat') btn.classList.toggle('primary', b === 'flat');
    });
  };
  (document.getElementById('auto-brush-line') as HTMLButtonElement).addEventListener('click', () => setBrush('line'));
  (document.getElementById('auto-brush-flat') as HTMLButtonElement).addEventListener('click', () => setBrush('flat'));
  (document.getElementById('auto-fill-random') as HTMLButtonElement).addEventListener('click', () => {
    for (const lane of deps.seq.pattern.automation) lane.values = lane.values.map(() => Math.random());
    redrawAllLanes();
  });
  (document.getElementById('auto-fill-ramp') as HTMLButtonElement).addEventListener('click', () => {
    for (const lane of deps.seq.pattern.automation) {
      const n = lane.values.length;
      lane.values = lane.values.map((_, i) => i / Math.max(1, n - 1));
    }
    redrawAllLanes();
  });
  (document.getElementById('auto-fill-half') as HTMLButtonElement).addEventListener('click', () => {
    for (const lane of deps.seq.pattern.automation) lane.values = lane.values.map(() => 0.5);
    redrawAllLanes();
  });
  setBrush('line');
}
