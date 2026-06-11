// Shared toolbar building blocks for the two canvas clip editors (piano-roll +
// drum-grid). Both grew near-identical Draw/Select toggles, "?" help popovers,
// and a right-anchored `.editor-grid-control`; this is the single source so they
// cannot drift. Editor-specific controls (the piano-roll octave stepper, the
// drum-grid/piano-roll resolution select) plug into `createGridControl`.

import { RESOLUTIONS, clampResolution, type ResolutionKey } from './drum-grid-editing';

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
  const drawBtn = document.createElement('button'); drawBtn.textContent = '✏ Draw';
  const selBtn = document.createElement('button'); selBtn.textContent = '▭ Select';
  const refresh = () => {
    drawBtn.style.fontWeight = tool === 'draw' ? '700' : '400';
    selBtn.style.fontWeight = tool === 'select' ? '700' : '400';
  };
  const set = (t: EditorTool) => { tool = t; refresh(); };
  drawBtn.addEventListener('click', () => { set('draw'); onChange('draw'); });
  selBtn.addEventListener('click', () => { set('select'); onChange('select'); });
  refresh();
  return { drawBtn, selBtn, get: () => tool, set };
}

/** A "?" help button + the popover it toggles. The caller positions the popover
 *  (both editors place it just below the toolbar). */
export function createHelpButton(legend: string): { btn: HTMLButtonElement; popover: HTMLPreElement } {
  const btn = document.createElement('button');
  btn.className = 'editor-help-btn';
  btn.textContent = '?';
  btn.title = legend; // native multi-line tooltip fallback
  const popover = document.createElement('pre');
  popover.className = 'editor-help-popover';
  popover.textContent = legend;
  popover.hidden = true;
  btn.addEventListener('click', (e) => { e.stopPropagation(); popover.hidden = !popover.hidden; });
  btn.addEventListener('blur', () => { popover.hidden = true; });
  return { btn, popover };
}

/** The right-anchored `.editor-grid-control` wrapper (styled by Task 10 SCSS)
 *  holding an editor-specific control (octave stepper / resolution select). */
export function createGridControl(...children: HTMLElement[]): HTMLDivElement {
  const ctl = document.createElement('div');
  ctl.className = 'editor-grid-control';
  ctl.style.cssText = 'margin-left:auto;display:flex;gap:4px;align-items:center';
  ctl.append(...children);
  return ctl;
}

/** A "Grid" resolution `<select>` (reuses RESOLUTIONS), wrapped in a grid-control.
 *  Used by the drum-grid and now the piano-roll, so both quantize the same way. */
export function createResolutionSelect(
  initial: ResolutionKey,
  onChange: (r: ResolutionKey) => void,
): { control: HTMLDivElement; select: HTMLSelectElement } {
  const label = document.createElement('span');
  label.textContent = 'Grid';
  label.style.cssText = 'font:11px ui-monospace,monospace;color:#9a9a9a';
  const select = document.createElement('select');
  select.title = 'Grid resolution';
  for (const r of RESOLUTIONS) {
    const o = document.createElement('option'); o.value = r; o.textContent = r; select.appendChild(o);
  }
  select.value = initial;
  select.addEventListener('change', () => onChange(clampResolution(select.value)));
  const control = createGridControl(label, select);
  return { control, select };
}
