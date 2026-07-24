// Per-voice Euclidean fields for the drum grid: hits / steps / rotate on every
// voice row. Lives between the label column and the grid, in the same scrolling
// flex row and on the same RULER_H + ROW_H rhythm, so a row's numbers sit beside
// the voice they paint. Pure logic in core/euclid-row.ts.
//
// Rendered through mountPanel: the panel host carries the old root's class
// ('drum-euclid') and flex styling, and setModel is a rerender instead of a
// rebuild. Field values use live() so a model swap resets them to their
// defaults — exactly what the old rebuild did.

import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { NoteEvent } from '../../core/notes';
import type { DrumRows } from '../../core/drum-grid-editing';
import { applyEuclidToRow } from '../../core/euclid-row';
import { DEFAULT_VELOCITY } from '../../core/velocity-gain';
import { withUndo, type HistoryDeps } from '../../save/history-wiring';
import { mountPanel } from '../../core/lit-panel';
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

const FIELD_STYLE = `width:${FIELD_W}px;height:16px;box-sizing:border-box;padding:0 2px;`
  + 'background:#111;border:1px solid #333;border-radius:2px;color:#ddd;font:9px ui-monospace,monospace';

export function mountDrumEuclidPanel(host: HTMLElement, deps: EuclidPanelDeps): EuclidPanelHandle {
  let rows = deps.rows;
  let labels = deps.labels;

  function apply(row: number, e: Event): void {
    const rowEl = (e.target as HTMLElement).closest('.drum-euclid-row')!;
    const [hits, steps, rot] =
      [...rowEl.querySelectorAll('input')].map((i) => Number(i.value));   // '' → 0 → not generating
    const spec = { hits, steps, rotation: rot, velocity: DEFAULT_VELOCITY };
    // Synchronous on the `change` event: AutoHistory checkpoints in a microtask
    // off that same event, so a debounced paint would miss its undo step.
    const run = () => {
      deps.setNotes(applyEuclidToRow(deps.getNotes(), row, spec, deps.totalSteps, rows));
      deps.onChange();
    };
    deps.historyDeps ? withUndo(deps.historyDeps, run) : run();
  }

  const rowTemplate = (r: number): TemplateResult => html`
    <div class="drum-euclid-row"
      style="display:flex;gap:${GAP}px;height:${ROW_H}px;padding:0 ${PAD}px;align-items:center;box-sizing:border-box;background:#202020">
      ${FIELDS.map((f, i) => html`<input type="number" class="drum-euclid-f"
        title="${labels[r] ?? ''} · ${f.title}"
        min=${i < 2 ? '0' : nothing}
        .value=${live(i === 1 ? String(deps.defaultSteps) : '')}
        style=${FIELD_STYLE}
        @change=${(e: Event) => apply(r, e)} />`)}
    </div>`;

  const handle = mountPanel({
    container: host,
    className: 'drum-euclid',
    deps,
    template: () => html`
      <div style="display:flex;gap:${GAP}px;height:${RULER_H}px;padding:0 ${PAD}px;align-items:center;box-sizing:border-box;color:#666">
        ${FIELDS.map((f) => html`<span title=${f.title} style="width:${FIELD_W}px;text-align:center">${f.cap}</span>`)}
      </div>
      ${Array.from({ length: rows.count }, (_, r) => rowTemplate(r))}
    `,
  });
  // The panel host IS the flex item in the drum grid's label/fields/grid row,
  // so it carries the sizing the old root element had.
  handle.host.style.cssText = `flex:0 0 ${PANEL_W}px;background:#0a0a0a;font:9px ui-monospace,monospace`;

  return {
    setModel: (r, l) => { rows = r; labels = l; handle.rerender(); },
  };
}
