// src/engines/sampler-editor-templates.ts
// lit-html templates for the Sampler lane editor scaffold (extracted from
// sampler-worklet-engine.buildParamUI so the engine file stays lean). The
// editor is a one-shot build — every state change goes through the engine's
// rebuild() (wipe + buildParamUI), so these templates render once into a
// throwaway fragment; no panel lifecycle needed. Imperative widgets (the drum
// rack, knob rows, canvases, the hidden file pickers) are built by the engine
// and interpolated here as elements.

import { html, nothing, type TemplateResult } from 'lit-html';
import type { KeymapEntry } from '../samples/types';

/** Everything the scaffold interpolates: view flags + prebuilt elements +
 *  keymap-row callbacks. Elements are null when their section is absent. */
export interface SamplerEditorView {
  isLoop: boolean;
  isDrumkitView: boolean;
  isMelodicView: boolean;
  isChannelView: boolean;
  keymap: KeymapEntry[];
  loopOverview: HTMLElement | null;   // .sampler-loop-overview (canvas pre-rendered)
  keyboardViz: HTMLElement | null;    // .sampler-keymap-viz
  connHost: HTMLElement | null;       // .sampler-keyboard-conn (connector canvas)
  rackHost: HTMLElement | null;       // plain div the drum-voice rack renders into
  viewerHost: HTMLElement | null;     // .sampler-sample-viewer (filled by renderViewer)
  knobRow: HTMLElement;               // .knob-row with the engine globals (gain/voices)
  filterRow: HTMLElement;             // .knob-row inside the CHANNEL FILTER section
  loopInput: HTMLInputElement;        // hidden picker the "Import loop…" button clicks
  fileInput: HTMLInputElement;        // hidden picker the "Import samples…" button clicks
  importStatus: HTMLSpanElement;      // async import feedback (textContent set later)
  onRootChange: (index: number, value: number) => void;
  onDeleteEntry: (index: number) => void;
  /** Builds the per-zone knob row (the flat param grid) for a keymap-list row. */
  zoneParamsFor: (entry: KeymapEntry) => HTMLElement;
}

export function samplerEditorTemplate(v: SamplerEditorView): TemplateResult {
  return html`
    ${v.loopOverview ?? nothing}
    ${v.keyboardViz ?? nothing}
    ${v.connHost ?? nothing}
    ${v.rackHost ?? nothing}
    ${v.viewerHost
      ? html`<div class="label sampler-viewer-label">Selected sample</div>${v.viewerHost}`
      : nothing}
    ${v.knobRow}
    ${importSectionTemplate(v)}
    <div class="row instrument-section sampler-channel-filter">
      <div class="section-label">CHANNEL FILTER</div>
      ${v.filterRow}
    </div>
  `;
}

function importSectionTemplate(v: SamplerEditorView): TemplateResult {
  return html`
    <div class="sampler-keymap">
      <div class="label">${v.isDrumkitView ? 'Load kit' : (v.isMelodicView ? 'Load instrument' : 'Keymap')}</div>
      ${v.isLoop
        ? html`<div class="sampler-loop-hint label">Loop: each note is a slice. The notes are edited in the clip's piano-roll.</div>`
        : nothing}
      ${v.loopInput}
      ${v.fileInput}
      <div class="sampler-import-row">
        <button class="sampler-import-loop-btn"
          title="Import a loop: slices it and creates a note clip with its piano-roll"
          @click=${() => v.loopInput.click()}>Import loop…</button>
        <button class="sampler-import-btn"
          title="Import one or more audio files as keymap zones"
          @click=${() => v.fileInput.click()}>Import samples…</button>
      </div>
      <div class="sampler-import-hint label" style=${v.isChannelView ? 'display:none' : nothing}>Each audio file is added as a zone. Adjust each zone's range below.</div>
      ${v.importStatus}
      <div class="sampler-keymap-list">
        ${v.isChannelView ? nothing : v.keymap.map((entry, i) => keymapRowTemplate(entry, i, v))}
        ${v.keymap.length === 0
          ? html`<div class="sampler-keymap-empty">No samples loaded yet.</div>`
          : nothing}
      </div>
    </div>
  `;
}

function keymapRowTemplate(entry: KeymapEntry, i: number, v: SamplerEditorView): TemplateResult {
  return html`
    <div class="sampler-keymap-row">
      <span class="sampler-keymap-name">${entry.sampleId}</span>
      <label>root <input type="number" min="0" max="127" class="sampler-keymap-root"
        .value=${String(entry.rootNote)}
        @change=${(e: Event) => v.onRootChange(i, Number((e.target as HTMLInputElement).value))}></label>
      <button class="sampler-keymap-del" title="Remove" @click=${() => v.onDeleteEntry(i)}>✕</button>
      ${v.zoneParamsFor(entry)}
    </div>
  `;
}

/** The melodic zone-range row (root/lo/hi) the viewer appends below the
 *  selected sample's waveform. Values clamp to 0..127 on commit, mirroring the
 *  old numeric inputs. */
export function zoneRangeRowTemplate(
  entry: KeymapEntry,
  on: { root: (v: number) => void; lo: (v: number) => void; hi: (v: number) => void },
): TemplateResult {
  const clamp = (e: Event): number =>
    Math.max(0, Math.min(127, Math.round(Number((e.target as HTMLInputElement).value))));
  const num = (label: string, val: number, onCh: (v: number) => void): TemplateResult =>
    html`<label class="ssv-znum">${label}<input type="number" min="0" max="127"
      .value=${String(val)} @change=${(e: Event) => onCh(clamp(e))}></label>`;
  return html`<div class="ssv-zone">${num('root ', entry.rootNote, on.root)}${num('lo ', entry.loNote, on.lo)}${num('hi ', entry.hiNote, on.hi)}</div>`;
}
