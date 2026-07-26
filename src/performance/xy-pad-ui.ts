// src/performance/xy-pad-ui.ts
// The DOM for the Kaoss-style XY pad: a square surface you drag, plus two
// dropdowns (X and Y) that pick an automatable param — exactly the destinations
// an LFO/ADSR can target. Dragging writes both bound params live through the
// automation registry (one setValue moves UI ring + sound), reusing the pure
// core in xy-pad.ts. Non-modal on purpose so the rest of the UI stays usable.
//
// The root `.xy-pad` element is created once (renderElement) and stays the
// caller-owned handle; refreshOptions() re-renders the pad template INTO it, so
// lit patches the dropdowns' option lists while the surface (and any drag in
// progress on it) is left alone.
import { html, render, type TemplateResult } from 'lit-html';
import { renderElement } from '../core/lit-fragment';
import type { KnobHandle } from '../core/knob';
import { XyPadModel, applyXyWrites, type XyAxis, type XyTarget } from './xy-pad';
import type { DestinationRegistry } from '../automation/destination-registry';
import { groupTargetsByLane, type AutomationTarget } from '../automation/automation-targets';

export interface XyPadUIDeps {
  /** The one destination catalogue (Task 4) — every automatable param the
   *  session currently declares, whether or not its knob is mounted. Replaces
   *  `registry` as the *list* source (see below for the write path). */
  destinations: DestinationRegistry;
  /** `${laneId}.${paramId}` → KnobHandle. No longer the list source — consulted
   *  only on the write path, for a target whose knob happens to be mounted
   *  (mirrors automation-tick.ts's mounted/unmounted split). */
  registry: Map<string, KnobHandle>;
  /** Land a write on a target with NO mounted knob, straight onto the audio
   *  object. Without this, a destination the catalogue offers but whose lane
   *  editor was never opened would silently do nothing when dragged, which is
   *  exactly the class of dead-option bug this task exists to remove.
   *
   *  A drag is a live GESTURE, so main.ts passes the live-control writer
   *  (`applyLiveControlWrite`), not the bare replay fallback automation-tick.ts
   *  uses: an engine param moved here has to persist, the same as one moved on a
   *  mounted knob. See live-control-apply.ts for why those are two functions.
   *
   *  `ranges` is the catalogue's declared min/max, built lazily so a drag with
   *  only mounted targets costs nothing extra. Optional — when absent, an
   *  unmounted target is silently skipped (matches the old registry-only
   *  behaviour). */
  applyUnmounted?: (
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ) => void;
}

export interface XyPadUI {
  el: HTMLElement;
  /** Rebuild the dropdowns from the current catalogue (call when the panel opens —
   *  lanes/engines/params change over a session). */
  refreshOptions: () => void;
  getState: () => { x: string | null; y: string | null };
  setState: (s: { x: string | null; y: string | null }) => void;
  /** Unsubscribe from the destination registry. The pad is normally built once
   *  and lives for the app's lifetime (main.ts never calls this), but tests
   *  and any future caller that DOES tear a pad down need a way to stop it
   *  rebuilding after the fact — mirrors the AbortController pattern at
   *  modulation-ui.ts / session-inspector.ts:258. */
  destroy: () => void;
}

export function createXyPad(deps: XyPadUIDeps): XyPadUI {
  const model = new XyPadModel();
  const registryAsTargets = deps.registry as unknown as Map<string, XyTarget>;
  // No production caller invokes destroy() today: main.ts builds the pad
  // lazily, once, behind `if (!xyPanel)`, and the panel lives for the app's
  // whole session — so in production there is exactly one subscription for
  // one pad, forever. This AbortController exists so a FUTURE caller that
  // rebuilds/discards the pad (the moment `if (!xyPanel)` stops being true)
  // has a way to release the subscription instead of leaking it silently.
  const ac = new AbortController();

  const el = renderElement(html`<div class="xy-pad"></div>`);

  // Pointer drag → write both bound params from the surface position (y up).
  let dragging = false;
  const applyAt = (surface: HTMLElement, clientX: number, clientY: number) => {
    const r = surface.getBoundingClientRect();
    const nx = (clientX - r.left) / r.width;
    const ny = 1 - (clientY - r.top) / r.height;
    const writes = model.writesFor(nx, ny);
    applyXyWrites(writes, registryAsTargets);
    // A target the catalogue offers but whose knob is NOT mounted (its lane's
    // editor was never opened) is invisible to applyXyWrites above — it just
    // skips it. Land those straight on the audio object via applyUnmounted,
    // which for this widget also commits the value (see the dep's doc).
    // `ranges` is built at most once per drag frame, only if an unmounted
    // write is actually pending.
    if (deps.applyUnmounted) {
      let ranges: ReadonlyMap<string, { min: number; max: number }> | undefined;
      for (const w of writes) {
        if (deps.registry.has(w.paramId)) continue; // already landed via applyXyWrites
        ranges ??= new Map(deps.destinations.list().map((t) => [t.id, { min: t.min, max: t.max }]));
        deps.applyUnmounted(w.paramId, w.norm, ranges);
      }
    }
    const dot = surface.querySelector('.xy-dot') as HTMLElement;
    dot.style.left = `${Math.max(0, Math.min(1, nx)) * 100}%`;
    dot.style.top = `${Math.max(0, Math.min(1, 1 - ny)) * 100}%`;
  };
  const onDown = (e: PointerEvent) => {
    const surface = e.currentTarget as HTMLElement;
    dragging = true;
    surface.setPointerCapture(e.pointerId);
    surface.classList.add('active');
    applyAt(surface, e.clientX, e.clientY);
  };
  const onMove = (e: PointerEvent) => {
    if (dragging) applyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
  };
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    const surface = e.currentTarget as HTMLElement;
    try { surface.releasePointerCapture(e.pointerId); } catch { /* ok */ }
    surface.classList.remove('active');
  };

  const onSelChange = (e: Event) => {
    const sel = e.currentTarget as HTMLSelectElement;
    model.setTarget(sel.dataset.axis as XyAxis, sel.value === '' ? null : sel.value);
  };

  // Assignment rows: X and Y each a labelled <select>. Options come from the
  // catalogue, grouped by its own laneName (never a first-dot split of the
  // id — that misgroups the global racks, e.g. `fx.master.fx:slot.gain` would
  // split to lane "fx").
  const padTemplate = (byLane: Map<string, AutomationTarget[]>): TemplateResult => html`<div
      class="xy-surface"
      @pointerdown=${onDown}
      @pointermove=${onMove}
      @pointerup=${end}
      @pointercancel=${end}
    ><div class="xy-dot"></div></div><div class="xy-assign">${(['x', 'y'] as XyAxis[]).map((axis) => html`<label
      class="xy-row xy-row-${axis}"
    ><span class="xy-axis-tag">${axis.toUpperCase()}</span><select
      class="xy-sel"
      data-axis=${axis}
      @change=${onSelChange}
    ><option value="">— none —</option>${[...byLane].map(([laneName, list]) => html`<optgroup label=${laneName}>${
      list.map((t) => html`<option value=${t.id}>${t.label}</option>`)
    }</optgroup>`)}</select></label>`)}</div>`;

  function refreshOptions(): void {
    const targets = deps.destinations.list();
    const ids = targets.map((t) => t.id);
    render(padTemplate(groupTargetsByLane(targets)), el);
    // Selection is restored AFTER the options render (a `.value` binding on the
    // select would commit before its option children exist). Keep the selection
    // if its param still exists; else fall back to none and clear the stale
    // binding so the pad doesn't drive a gone param.
    for (const axis of ['x', 'y'] as XyAxis[]) {
      const sel = el.querySelector(`select[data-axis="${axis}"]`) as HTMLSelectElement;
      const current = model.target(axis);
      if (current !== null && ids.includes(current)) sel.value = current;
      else { sel.value = ''; if (current !== null) model.setTarget(axis, null); }
    }
  }

  refreshOptions();

  // Keep the safety net (main.ts refreshes on open) AND subscribe, so an
  // insert added while the pad is open shows up without closing it. Bound to
  // `ac` so destroy() leaves no dangling listener (see the AbortController
  // pattern in modulation-ui.ts / session-inspector.ts:258).
  const off = deps.destinations.subscribe(refreshOptions);
  ac.signal.addEventListener('abort', off, { once: true });

  return {
    el,
    refreshOptions,
    getState: () => model.getState(),
    setState: (s) => { model.setState(s); refreshOptions(); },
    destroy: () => ac.abort(),
  };
}
