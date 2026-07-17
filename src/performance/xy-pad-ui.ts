// src/performance/xy-pad-ui.ts
// The DOM for the Kaoss-style XY pad: a square surface you drag, plus two
// dropdowns (X and Y) that pick an automatable param — exactly the destinations
// an LFO/ADSR can target. Dragging writes both bound params live through the
// automation registry (one setValue moves UI ring + sound), reusing the pure
// core in xy-pad.ts. Non-modal on purpose so the rest of the UI stays usable.
import type { KnobHandle } from '../core/knob';
import { XyPadModel, applyXyWrites, type XyAxis, type XyTarget } from './xy-pad';

export interface XyPadUIDeps {
  /** `${laneId}.${paramId}` → KnobHandle. The list of automatable params. */
  registry: Map<string, KnobHandle>;
  /** Human label for a param id (e.g. via formatParamIdForDisplay). */
  formatLabel: (paramId: string) => string;
}

export interface XyPadUI {
  el: HTMLElement;
  /** Rebuild the dropdowns from the current registry (call when the panel opens —
   *  lanes/engines/params change over a session). */
  refreshOptions: () => void;
  getState: () => { x: string | null; y: string | null };
  setState: (s: { x: string | null; y: string | null }) => void;
}

/** Split a registry key into its lane prefix (for grouping the dropdown). */
function laneOf(paramId: string): string {
  const dot = paramId.indexOf('.');
  return dot < 0 ? '' : paramId.slice(0, dot);
}

export function createXyPad(deps: XyPadUIDeps): XyPadUI {
  const model = new XyPadModel();
  const registryAsTargets = deps.registry as unknown as Map<string, XyTarget>;

  const el = document.createElement('div');
  el.className = 'xy-pad';

  // The draggable surface + the position dot.
  const surface = document.createElement('div');
  surface.className = 'xy-surface';
  const dot = document.createElement('div');
  dot.className = 'xy-dot';
  surface.appendChild(dot);
  el.appendChild(surface);

  // Assignment rows: X and Y each a labelled <select>.
  const assign = document.createElement('div');
  assign.className = 'xy-assign';
  const selects: Record<XyAxis, HTMLSelectElement> = {} as Record<XyAxis, HTMLSelectElement>;
  for (const axis of ['x', 'y'] as XyAxis[]) {
    const row = document.createElement('label');
    row.className = `xy-row xy-row-${axis}`;
    const tag = document.createElement('span');
    tag.className = 'xy-axis-tag';
    tag.textContent = axis.toUpperCase();
    const sel = document.createElement('select');
    sel.className = 'xy-sel';
    sel.dataset.axis = axis;
    sel.addEventListener('change', () => {
      model.setTarget(axis, sel.value === '' ? null : sel.value);
    });
    selects[axis] = sel;
    row.appendChild(tag);
    row.appendChild(sel);
    assign.appendChild(row);
  }
  el.appendChild(assign);

  function refreshOptions(): void {
    // Group the automatable params by lane, skipping modulator-config knobs.
    const ids = [...deps.registry.keys()].filter((id) => !id.includes('.mod.')).sort();
    const byLane = new Map<string, string[]>();
    for (const id of ids) {
      const lane = laneOf(id);
      const bucket = byLane.get(lane) ?? (byLane.set(lane, []), byLane.get(lane)!);
      bucket.push(id);
    }
    for (const axis of ['x', 'y'] as XyAxis[]) {
      const sel = selects[axis];
      const current = model.target(axis);
      sel.textContent = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '— none —';
      sel.appendChild(none);
      for (const [lane, list] of byLane) {
        const grp = document.createElement('optgroup');
        grp.label = lane || '(global)';
        for (const id of list) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = deps.formatLabel(id);
          grp.appendChild(opt);
        }
        sel.appendChild(grp);
      }
      // Keep the selection if its param still exists; else fall back to none and
      // clear the stale binding so the pad doesn't drive a gone param.
      if (current !== null && ids.includes(current)) sel.value = current;
      else { sel.value = ''; if (current !== null) model.setTarget(axis, null); }
    }
  }

  // Pointer drag → write both bound params from the surface position (y up).
  let dragging = false;
  const applyAt = (clientX: number, clientY: number) => {
    const r = surface.getBoundingClientRect();
    const nx = (clientX - r.left) / r.width;
    const ny = 1 - (clientY - r.top) / r.height;
    applyXyWrites(model.writesFor(nx, ny), registryAsTargets);
    dot.style.left = `${Math.max(0, Math.min(1, nx)) * 100}%`;
    dot.style.top = `${Math.max(0, Math.min(1, 1 - ny)) * 100}%`;
  };
  surface.addEventListener('pointerdown', (e) => {
    dragging = true;
    surface.setPointerCapture(e.pointerId);
    surface.classList.add('active');
    applyAt(e.clientX, e.clientY);
  });
  surface.addEventListener('pointermove', (e) => { if (dragging) applyAt(e.clientX, e.clientY); });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { surface.releasePointerCapture(e.pointerId); } catch { /* ok */ }
    surface.classList.remove('active');
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);

  refreshOptions();

  return {
    el,
    refreshOptions,
    getState: () => model.getState(),
    setState: (s) => { model.setState(s); refreshOptions(); },
  };
}
