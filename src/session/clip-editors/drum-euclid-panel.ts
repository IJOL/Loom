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
import { euclidFitBars, MAX_FIT_BARS } from '../../core/euclid-fit';
import {
  isDrumEuclidOpen, setDrumEuclidOpen, isDrumEuclidFit, setDrumEuclidFit,
} from '../../core/clip-drum-euclid';
import { RULER_H, ROW_H, VEL_LANE_H } from './drum-grid-types';

export interface EuclidPanelDeps {
  rows: DrumRows;
  labels: string[];
  /** 16th-note steps in one bar of the session meter. Also what the steps field
   *  starts on, so 4 hits reads as four on the floor whatever the clip's length
   *  (a longer clip tiles the same cycle). */
  stepsPerBar: number;
  /** The clip's length, read fresh: "Fit clip" moves it under our feet. */
  getLengthBars: () => number;
  /** Resize the clip (whole bars) so the cycles finish on the loop point.
   *  Omitted → no "Fit clip" check, and the clip's length is never touched. */
  setLengthBars?: (bars: number) => void;
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

  // The length the clip had when this editor opened — the floor "Fit clip"
  // shrinks back to when you clear the fields. It never crushes a clip you sized
  // by hand; re-opening the editor simply adopts the grown length as the new
  // floor, which is also what makes the growth stick.
  const baseBars = Math.max(1, deps.getLengthBars());

  /** Every row's fields, read straight off the DOM ('' → 0 → not generating). */
  function readSpecs(): { hits: number; steps: number; rotation: number }[] {
    return [...handle.host.querySelectorAll('.drum-euclid-row')].map((el) => {
      const [hits, steps, rotation] = [...el.querySelectorAll('input')].map((i) => Number(i.value));
      return { hits, steps, rotation };
    });
  }

  const cycleOf = (s: { hits: number; steps: number; rotation: number }) =>
    ({ ...s, velocity: DEFAULT_VELOCITY });

  /**
   * Repaint, and — with "Fit clip" on — resize the clip first so every cycle
   * finishes on the loop point. A resize changes how far a cycle tiles, so the
   * OTHER generating rows have to be repainted over the new length too, or the
   * clip grows and only the row you touched fills it.
   */
  function commit(editedRow: number | null): void {
    const specs = readSpecs();
    const generating = specs.map((s, r) => ({ ...s, row: r })).filter((s) => s.hits >= 1 && s.steps >= 1);
    const before = Math.max(1, deps.getLengthBars());
    let bars = before;
    if (isDrumEuclidFit() && deps.setLengthBars) {
      bars = euclidFitBars(generating.map((s) => s.steps), deps.stepsPerBar, baseBars);
      if (bars !== before) deps.setLengthBars(bars);
    }
    const resized = bars !== before;
    const total = Math.max(1, Math.round(bars * deps.stepsPerBar));
    const targets = resized ? generating.map((s) => s.row) : (editedRow == null ? [] : [editedRow]);

    let out = deps.getNotes();
    for (const r of targets) {
      const spec = specs[r];
      if (spec) out = applyEuclidToRow(out, r, cycleOf(spec), total, rows);
    }
    if (targets.length) deps.setNotes(out);
    if (targets.length || resized) deps.onChange();
  }

  // Synchronous on the `change` event: AutoHistory checkpoints in a microtask
  // off that same event, so a debounced paint would miss its undo step.
  function apply(row: number, e: Event): void {
    void e;
    const run = () => commit(row);
    deps.historyDeps ? withUndo(deps.historyDeps, run) : run();
  }

  function toggleFit(e: Event): void {
    setDrumEuclidFit((e.target as HTMLInputElement).checked);
    // Ticking it is itself the instruction: fit the clip to what's already in
    // the fields instead of waiting for the next edit.
    const run = () => commit(null);
    deps.historyDeps ? withUndo(deps.historyDeps, run) : run();
  }

  const rowTemplate = (r: number): TemplateResult => html`
    <div class="drum-euclid-row"
      style="display:flex;gap:${GAP}px;height:${ROW_H}px;padding:0 ${PAD}px;align-items:center;box-sizing:border-box;background:#202020">
      ${FIELDS.map((f, i) => html`<input type="number" class="drum-euclid-f"
        title="${labels[r] ?? ''} · ${f.title}"
        min=${i < 2 ? '0' : nothing}
        .value=${live(i === 1 ? String(deps.stepsPerBar) : '')}
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
      ${deps.setLengthBars ? fitTemplate() : nothing}
    </div>`;

  // Sits below the last voice, in the band the velocity lane occupies on the
  // canvas — the one place a control fits without pushing the rows off the
  // voices they belong to.
  const fitTemplate = (): TemplateResult => html`
    <label class="drum-euclid-fit"
      title=${'Fit clip — grow the clip in whole bars until every cycle finishes on the loop point, '
        + `so it joins end to start (up to ${MAX_FIT_BARS} bars; cycles that would need more are left alone)`}
      style="display:flex;align-items:center;gap:4px;height:${VEL_LANE_H}px;padding:0 ${PAD}px;box-sizing:border-box;color:#8a8a8a;cursor:pointer">
      <input type="checkbox" .checked=${live(isDrumEuclidFit())} @change=${toggleFit}
        style="width:12px;height:12px;margin:0;accent-color:#6a8fbf" />
      FIT CLIP
    </label>`;

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
    // rail would collapse to nothing: pin the host to the canvas frame — ruler,
    // voice rows and the velocity band the FIT check sits in.
    const h = RULER_H + ROW_H * Math.max(1, rows.count) + VEL_LANE_H;
    handle.host.style.cssText = `flex:0 0 ${w}px;min-height:${h}px;display:flex;align-items:stretch;`
      + 'background:#0a0a0a;font:9px ui-monospace,monospace';
  }
  sizeHost();

  return {
    setModel: (r, l) => { rows = r; labels = l; handle.rerender(); sizeHost(); },
  };
}
