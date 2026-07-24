// Shared toolbar building blocks for the two canvas clip editors (piano-roll +
// drum-grid). Both grew near-identical Draw/Select toggles, "?" help popovers,
// and a right-anchored `.editor-grid-control`; this is the single source so they
// cannot drift. Editor-specific controls (the piano-roll octave stepper, the
// drum-grid/piano-roll resolution select) plug into `createGridControl`.
//
// These are one-shot widgets: the caller keeps the element references and
// appends them itself, so each is instantiated once via renderElement (no
// re-rendering host). State flips (active tool, on/off pills) stay imperative
// refresh closures over the extracted elements.

import { html } from 'lit-html';
import { renderElement } from './lit-fragment';
import { RESOLUTIONS, clampResolution, type ResolutionKey } from './drum-grid-editing';
import { isFollowEnabled, toggleFollow } from './clip-follow';
import { isKbInputEnabled, toggleKbInput } from './clip-kb-input';
import { isDrumFullKit, setDrumFullKit } from './clip-drum-fullkit';

export type EditorTool = 'draw' | 'select';

export interface ToolToggle {
  drawBtn: HTMLButtonElement;
  selBtn: HTMLButtonElement;
  get(): EditorTool;
  /** Update the active tool + bold state WITHOUT firing onChange (for the
   *  keyboard 1/2 path, which already knows the new tool). */
  set(t: EditorTool): void;
}

/** ✏ Draw / ▭ Select toggle. `onChange` fires only on a user click. */
export function createToolToggle(initial: EditorTool, onChange: (t: EditorTool) => void): ToolToggle {
  let tool: EditorTool = initial;
  const drawBtn = renderElement<HTMLButtonElement>(
    html`<button @click=${() => { set('draw'); onChange('draw'); }}>✏ Draw</button>`);
  const selBtn = renderElement<HTMLButtonElement>(
    html`<button @click=${() => { set('select'); onChange('select'); }}>▭ Select</button>`);
  const refresh = () => {
    drawBtn.style.fontWeight = tool === 'draw' ? '700' : '400';
    selBtn.style.fontWeight = tool === 'select' ? '700' : '400';
  };
  const set = (t: EditorTool) => { tool = t; refresh(); };
  refresh();
  return { drawBtn, selBtn, get: () => tool, set };
}

/** A "?" help button + the popover it toggles. The caller positions the popover
 *  (both editors place it just below the toolbar). */
export function createHelpButton(legend: string): { btn: HTMLButtonElement; popover: HTMLPreElement } {
  const popover = renderElement<HTMLPreElement>(
    html`<pre class="editor-help-popover" ?hidden=${true}>${legend}</pre>`);
  const btn = renderElement<HTMLButtonElement>(html`<button
    class="editor-help-btn"
    title=${legend /* native multi-line tooltip fallback */}
    @click=${(e: Event) => { e.stopPropagation(); popover.hidden = !popover.hidden; }}
    @blur=${() => { popover.hidden = true; }}
  >?</button>`);
  return { btn, popover };
}

/** The right-anchored `.editor-grid-control` wrapper (styled by Task 10 SCSS)
 *  holding an editor-specific control (octave stepper / resolution select). */
export function createGridControl(...children: HTMLElement[]): HTMLDivElement {
  return renderElement<HTMLDivElement>(html`<div
    class="editor-grid-control"
    style="margin-left:auto;display:flex;gap:4px;align-items:center"
  >${children}</div>`);
}

/** A "Follow" on/off button bound to the session-global Follow flag. Reflects
 *  the shared state on construction and on click; since one clip editor is
 *  mounted at a time (rebuilt on open), the button always shows the live flag.
 *  `onChange` lets the editor react (e.g. immediately re-evaluate scroll). */
export function createFollowToggle(onChange?: (on: boolean) => void): HTMLButtonElement {
  // .clip-loop-toggle reuses the on/off pill styling
  const btn = renderElement<HTMLButtonElement>(html`<button
    class="clip-loop-toggle"
    @click=${() => { const on = toggleFollow(); refresh(); onChange?.(on); }}
  >Follow</button>`);
  const refresh = () => {
    btn.classList.toggle('on', isFollowEnabled());
    btn.title = isFollowEnabled() ? 'Follow playhead: ON (view scrolls to the playhead)' : 'Follow playhead: OFF';
  };
  refresh();
  return btn;
}

/** A "⌨ Keys" on/off pill. OPT-IN (OFF by default): when ON, the computer
 *  keyboard plays the ACTIVE lane live (ASDFG = notes, z/x = octave) via the
 *  facade — the same path as a hardware MIDI keyboard, so chord note-FX + ● Rec
 *  loop-record apply. It no longer types notes into the clip. `onChange` lets
 *  the editor react to the toggle. */
export function createKbInputToggle(onChange?: (on: boolean) => void): HTMLButtonElement {
  const btn = renderElement<HTMLButtonElement>(html`<button
    class="clip-loop-toggle"
    @click=${() => { toggleKbInput(); refresh(); onChange?.(isKbInputEnabled()); }}
  >⌨ Keys</button>`);
  const refresh = () => {
    btn.classList.toggle('on', isKbInputEnabled());
    btn.title = isKbInputEnabled()
      ? 'Computer keyboard: ON — ASDFG play the active lane live, z/x octave (● Rec captures it). Click to turn off.'
      : 'Play the active lane live from the computer keyboard (ASDFG, z/x octave)';
  };
  refresh();
  return btn;
}

/** A "Full kit" pill toggle for sampler drum grids: reflects the session-global
 *  fullKit flag; onChange fires after the flag flips so the editor can rebuild. */
export function createFullKitToggle(onChange?: (on: boolean) => void): HTMLButtonElement {
  const btn = renderElement<HTMLButtonElement>(html`<button
    class="clip-loop-toggle"
    @click=${() => { setDrumFullKit(!isDrumFullKit()); refresh(); onChange?.(isDrumFullKit()); }}
  >Full kit</button>`);
  const refresh = () => {
    btn.classList.toggle('on', isDrumFullKit());
    btn.title = isDrumFullKit()
      ? 'Show full kit: ON (all pads)'
      : 'Show full kit: OFF (only sounds the clip uses)';
  };
  refresh();
  return btn;
}

/** A "Grid" resolution `<select>` (reuses RESOLUTIONS), wrapped in a grid-control.
 *  Used by the drum-grid and now the piano-roll, so both quantize the same way. */
export function createResolutionSelect(
  initial: ResolutionKey,
  onChange: (r: ResolutionKey) => void,
): { control: HTMLDivElement; select: HTMLSelectElement } {
  const label = renderElement<HTMLSpanElement>(
    html`<span style="font:11px ui-monospace,monospace;color:#9a9a9a">Grid</span>`);
  const select = renderElement<HTMLSelectElement>(html`<select
    title="Grid resolution"
    @change=${(e: Event) => onChange(clampResolution((e.target as HTMLSelectElement).value))}
  >${RESOLUTIONS.map((r) => html`<option value=${r}>${r}</option>`)}</select>`);
  select.value = initial; // after the options exist — a .value binding would land before them
  const control = createGridControl(label, select);
  return { control, select };
}
