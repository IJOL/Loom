// Per-voice Euclidean fields for the drum grid: hits / steps / rotate on every
// voice row. Lives between the label column and the grid, in the same scrolling
// flex row and on the same RULER_H + ROW_H rhythm, so a row's numbers sit beside
// the voice they paint. Pure logic in core/euclid-row.ts.
//
// The fields are FOLDED behind a vertical rail (sideways "EUCLID", the panel's
// full height) and only unfold when you click it — a generator you reach for now
// and then shouldn't cost the grid a permanent third column. The open flag is
// session-global (core/clip-drum-euclid.ts), so the next clip you open reads the
// way you left this one, and unfolding changes the viewport width, so the grid
// is told to re-lay out (deps.onToggleOpen).
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
import { isDrumEuclidOpen, setDrumEuclidOpen } from '../../core/clip-drum-euclid';
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
  /** Folding changes the panel's width, so the grid must re-measure its viewport. */
  onToggleOpen?: () => void;
  historyDeps?: HistoryDeps;
}

export interface EuclidPanelHandle {
  /** Swap the row model in place (the grid's "Full kit" toggle). */
  setModel: (rows: DrumRows, labels: string[]) => void;
}

const FIELD_W = 34;
const GAP = 3;
const PAD = 4;
const FIELDS_W = PAD * 2 + FIELD_W * 3 + GAP * 2;
const RAIL_W = 14;

const FIELDS = [
  { cap: 'H', title: 'hits — how many onsets, spread as evenly as possible (0 = leave this voice alone)' },
  { cap: 'S', title: 'steps — the cycle length; shorter than the clip and it repeats, off-divisor and it phases' },
  { cap: 'R', title: 'rotate — shift the cycle (negative rotates the other way)' },
] as const;

const FIELD_STYLE = `width:${FIELD_W}px;height:16px;box-sizing:border-box;padding:0 2px;`
  + 'background:#111;border:1px solid #333;border-radius:2px;color:#ddd;font:9px ui-monospace,monospace';

// Sideways label: the rail is RAIL_W wide and as tall as the voice rows, so the
// word runs down it. `writing-mode` keeps it a real text node (searchable by an
// e2e, readable by a screen reader) instead of a rotated image.
const RAIL_STYLE = `flex:0 0 ${RAIL_W}px;align-self:stretch;display:flex;align-items:center;`
  + 'justify-content:center;gap:6px;padding:4px 0;box-sizing:border-box;cursor:pointer;'
  + 'writing-mode:vertical-rl;background:#181818;border:0;border-right:1px solid #2a2a2a;'
  + 'color:#7a7a7a;font:9px ui-monospace,monospace;letter-spacing:1px';

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

  function toggleOpen(): void {
    setDrumEuclidOpen(!isDrumEuclidOpen());
    handle.rerender();
    sizeHost();
    deps.onToggleOpen?.();
  }

  const fieldsTemplate = (): TemplateResult => html`
    <div class="drum-euclid-fields" style="display:flex;flex-direction:column;flex:1 1 auto">
      <div style="display:flex;gap:${GAP}px;height:${RULER_H}px;padding:0 ${PAD}px;align-items:center;box-sizing:border-box;color:#666">
        ${FIELDS.map((f) => html`<span title=${f.title} style="width:${FIELD_W}px;text-align:center">${f.cap}</span>`)}
      </div>
      ${Array.from({ length: rows.count }, (_, r) => rowTemplate(r))}
    </div>`;

  const handle = mountPanel({
    container: host,
    className: 'drum-euclid',
    deps,
    template: () => {
      const open = isDrumEuclidOpen();
      return html`
        <button class="drum-euclid-rail" type="button"
          aria-expanded=${open ? 'true' : 'false'}
          title=${open ? 'Fold the Euclidean fields away' : 'Euclidean fields — hits / steps / rotate per voice'}
          style=${RAIL_STYLE}
          @click=${toggleOpen}>${open ? '◂' : '▸'} EUCLID</button>
        ${open ? fieldsTemplate() : nothing}`;
    },
  });

  // The panel host IS the flex item in the drum grid's label/fields/grid row, so
  // it carries the sizing the old root element had — a rail's width when folded,
  // rail + fields when open.
  function sizeHost(): void {
    const w = RAIL_W + (isDrumEuclidOpen() ? FIELDS_W : 0);
    // Folded there is no fields column to give the flex host its height, so the
    // rail would collapse to nothing: pin the host to the frame's row block.
    const h = RULER_H + ROW_H * Math.max(1, rows.count);
    handle.host.style.cssText = `flex:0 0 ${w}px;min-height:${h}px;display:flex;align-items:stretch;`
      + 'background:#0a0a0a;font:9px ui-monospace,monospace';
  }
  sizeHost();

  return {
    setModel: (r, l) => { rows = r; labels = l; handle.rerender(); sizeHost(); },
  };
}
