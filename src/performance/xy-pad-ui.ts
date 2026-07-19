// src/performance/xy-pad-ui.ts
// The DOM for the Kaoss-style XY pad: a square surface you drag, plus two
// dropdowns (X and Y) that pick an automatable param — exactly the destinations
// an LFO/ADSR can target. Dragging writes both bound params live through the
// automation registry (one setValue moves UI ring + sound), reusing the pure
// core in xy-pad.ts. Non-modal on purpose so the rest of the UI stays usable.
import type { KnobHandle } from '../core/knob';
import { XyPadModel, applyXyWrites, type XyAxis, type XyTarget } from './xy-pad';
import type { DestinationRegistry } from '../automation/destination-registry';
import { groupTargetsByLane } from '../automation/automation-targets';

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
   *  object — the SAME fallback automation-tick.ts uses for playback
   *  envelopes (`applyAutomationToSession` under the hood). Without this, a
   *  destination the catalogue offers but whose lane editor was never opened
   *  would silently do nothing when dragged, which is exactly the class of
   *  dead-option bug this task exists to remove. `ranges` is the catalogue's
   *  declared min/max, built lazily so a drag with only mounted targets costs
   *  nothing extra. Optional — when absent, an unmounted target is silently
   *  skipped (matches the old registry-only behaviour). */
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
    // The catalogue, not the mounted-knob registry: every destination the
    // session currently declares, grouped by its own laneName (never a
    // first-dot split of the id — that misgroups the global racks, e.g.
    // `fx.master.fx:slot.gain` would split to lane "fx").
    const targets = deps.destinations.list();
    const ids = targets.map((t) => t.id);
    const byLane = groupTargetsByLane(targets);
    for (const axis of ['x', 'y'] as XyAxis[]) {
      const sel = selects[axis];
      const current = model.target(axis);
      sel.textContent = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '— none —';
      sel.appendChild(none);
      for (const [laneName, list] of byLane) {
        const grp = document.createElement('optgroup');
        grp.label = laneName;
        for (const t of list) {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.label;
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
    const writes = model.writesFor(nx, ny);
    applyXyWrites(writes, registryAsTargets);
    // A target the catalogue offers but whose knob is NOT mounted (its lane's
    // editor was never opened) is invisible to applyXyWrites above — it just
    // skips it. Land those the same way playback automation does when its
    // target knob is unmounted (automation-tick.ts): resolve straight to the
    // audio object via applyUnmounted. `ranges` is built at most once per
    // drag frame, only if an unmounted write is actually pending.
    if (deps.applyUnmounted) {
      let ranges: ReadonlyMap<string, { min: number; max: number }> | undefined;
      for (const w of writes) {
        if (deps.registry.has(w.paramId)) continue; // already landed via applyXyWrites
        ranges ??= new Map(deps.destinations.list().map((t) => [t.id, { min: t.min, max: t.max }]));
        deps.applyUnmounted(w.paramId, w.norm, ranges);
      }
    }
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
