// Per-voice Euclidean fields for the drum grid: hits / steps / rotate on every
// voice row. Lives between the label column and the grid, in the same scrolling
// flex row and on the same RULER_H + ROW_H rhythm, so a row's numbers sit beside
// the voice they paint. Pure logic in core/euclid-row.ts.

import type { NoteEvent } from '../../core/notes';
import type { DrumRows } from '../../core/drum-grid-editing';
import { applyEuclidToRow } from '../../core/euclid-row';
import { DEFAULT_VELOCITY } from '../../core/velocity-gain';
import { withUndo, type HistoryDeps } from '../../save/history-wiring';
import { RULER_H, ROW_H } from './drum-grid-types';

export interface EuclidPanelDeps {
  rows: DrumRows;
  labels: string[];
  /** Steps in the whole clip — what a paint fills, tiling its cycle to get there. */
  totalSteps: number;
  /** What the steps field starts on: one bar, so 4 hits reads as four on the
   *  floor whatever the clip's length (a longer clip tiles the same cycle). */
  defaultSteps: number;
  getNotes: () => NoteEvent[];
  setNotes: (n: NoteEvent[]) => void;
  onChange: () => void;
  historyDeps?: HistoryDeps;
}

export interface EuclidPanelHandle {
  /** Swap the row model in place (the grid's "Full kit" toggle). */
  setModel: (rows: DrumRows, labels: string[]) => void;
}

const FIELD_W = 34;
const GAP = 3;
const PAD = 4;
const PANEL_W = PAD * 2 + FIELD_W * 3 + GAP * 2;

const FIELDS = [
  { cap: 'H', title: 'hits — how many onsets, spread as evenly as possible (0 = leave this voice alone)' },
  { cap: 'S', title: 'steps — the cycle length; shorter than the clip and it repeats, off-divisor and it phases' },
  { cap: 'R', title: 'rotate — shift the cycle (negative rotates the other way)' },
] as const;

export function mountDrumEuclidPanel(host: HTMLElement, deps: EuclidPanelDeps): EuclidPanelHandle {
  let rows = deps.rows;
  let labels = deps.labels;

  const el = document.createElement('div');
  el.className = 'drum-euclid';
  el.style.cssText = `flex:0 0 ${PANEL_W}px;background:#0a0a0a;font:9px ui-monospace,monospace`;
  host.appendChild(el);

  function apply(row: number, inputs: HTMLInputElement[]): void {
    const [hits, steps, rot] = inputs.map((i) => Number(i.value));   // '' → 0 → not generating
    const spec = { hits, steps, rotation: rot, velocity: DEFAULT_VELOCITY };
    // Synchronous on the `change` event: AutoHistory checkpoints in a microtask
    // off that same event, so a debounced paint would miss its undo step.
    const run = () => {
      deps.setNotes(applyEuclidToRow(deps.getNotes(), row, spec, deps.totalSteps, rows));
      deps.onChange();
    };
    deps.historyDeps ? withUndo(deps.historyDeps, run) : run();
  }

  function buildRow(row: number): HTMLElement {
    const rowEl = document.createElement('div');
    rowEl.className = 'drum-euclid-row';
    rowEl.style.cssText = `display:flex;gap:${GAP}px;height:${ROW_H}px;padding:0 ${PAD}px;`
      + 'align-items:center;box-sizing:border-box;background:#202020';
    const inputs = FIELDS.map((f, i) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'drum-euclid-f';
      input.title = `${labels[row] ?? ''} · ${f.title}`;
      if (i < 2) input.min = '0';                       // rotate wraps both ways
      input.value = i === 1 ? String(deps.defaultSteps) : '';
      input.style.cssText = `width:${FIELD_W}px;height:16px;box-sizing:border-box;padding:0 2px;`
        + 'background:#111;border:1px solid #333;border-radius:2px;color:#ddd;font:9px ui-monospace,monospace';
      rowEl.appendChild(input);
      return input;
    });
    for (const input of inputs) input.addEventListener('change', () => apply(row, inputs));
    return rowEl;
  }

  function build(): void {
    el.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.style.cssText = `display:flex;gap:${GAP}px;height:${RULER_H}px;padding:0 ${PAD}px;`
      + 'align-items:center;box-sizing:border-box;color:#666';
    for (const f of FIELDS) {
      const cap = document.createElement('span');
      cap.textContent = f.cap;
      cap.title = f.title;
      cap.style.cssText = `width:${FIELD_W}px;text-align:center`;
      hdr.appendChild(cap);
    }
    el.appendChild(hdr);
    for (let r = 0; r < rows.count; r++) el.appendChild(buildRow(r));
  }

  build();
  return {
    setModel: (r, l) => { rows = r; labels = l; build(); },
  };
}
