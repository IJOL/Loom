// The Kaoss-style XY pad panel — the toggle button, the floating shell it lives
// in, and nothing else.
//
// The cohesion is a single widget's whole lifetime: the pad, the panel that
// frames it and the button that shows it are useless apart, and every one of
// them is built LAZILY on the first open. That laziness is why this block is the
// safest thing in main.ts to move: the only statement that runs at boot is one
// `addEventListener` on `#xy-open` (already null-guarded, so an index.html
// without the button is silently fine). Everything else — createXyPad, the
// destination dropdowns, the panel element and its append to <body> — happens
// the first time a user clicks, long after boot has settled.
//
// `applyUnmounted` is a thunk-shaped dep for a reason that travels with the code:
// in main.ts the pad is wired ~180 lines BEFORE `createAutomationWrites` runs, so
// the caller hands in a closure `(p, n, r) => autoWrites.applyLiveControlUnmountedWrite(p, n, r)`
// rather than the bare function. Reading it at use time is what makes the early
// wiring legal, and it works precisely because the pad only ever calls it from
// inside a drag.

import { html } from 'lit-html';
import { renderElement } from '../core/lit-fragment';
import { createXyPad } from '../performance/xy-pad-ui';
import type { KnobHandle } from '../core/knob';
import type { DestinationRegistry } from '../automation/destination-registry';

export interface XyPanelDeps {
  /** The one destination catalogue — the same automatable params an LFO/ADSR can
   *  target. Re-read on every open, because lanes/engines/params change. */
  destinations: DestinationRegistry;
  /** `${laneId}.${paramId}` → KnobHandle. The write path for a target whose knob
   *  happens to be mounted; the list comes from `destinations`. */
  automationRegistry: Map<string, KnobHandle>;
  /** Land a drag on a target with NO mounted knob. Hand in a CLOSURE, never a
   *  bare reference: the writer is built later in boot than this wiring runs. */
  applyUnmounted(
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ): void;
}

// XY pad — a Kaoss-style controller. Two dropdowns pick automatable params (the
// same destinations an LFO/ADSR targets); dragging the surface drives both live
// through the automation registry. Built lazily on first open; a floating,
// non-modal panel so the params it moves stay visible.
export function wireXyPanel(deps: XyPanelDeps): void {
  const { destinations, automationRegistry } = deps;
  const xyBtn = document.getElementById('xy-open');
  let xyPanel: HTMLElement | null = null;
  let xyPad: ReturnType<typeof createXyPad> | null = null;
  xyBtn?.addEventListener('click', () => {
    if (!xyPanel) {
      const pad = createXyPad({
        destinations,
        registry: automationRegistry,
        // Same target resolution playback automation uses, plus the mirror a
        // mounted knob's onChange performs (applyLiveControlUnmountedWrite, in
        // app/automation-writes.ts): the catalogue offers every destination
        // the session declares, including ones with no mounted knob, so
        // dragging the pad on one of those must land the value AND persist it.
        // Read through a closure, never as a bare reference: `autoWrites` is
        // built ~180 lines below this wiring's call site in main.ts, and this
        // handler only runs on a click.
        applyUnmounted: (p, n, r) => deps.applyUnmounted(p, n, r),
      });
      xyPad = pad;
      // Build-once shell; the pad surface itself is an imperative widget
      // interpolated as-is.
      xyPanel = renderElement<HTMLElement>(html`
        <div class="xy-panel">
          <div class="xy-panel-head">
            <span class="xy-title">XY Pad</span>
            <button class="xy-close" title="Close"
              @click=${() => { xyPanel!.classList.remove('open'); xyBtn.classList.remove('on'); }}>✕</button>
          </div>
          ${pad.el}
        </div>`);
      document.body.appendChild(xyPanel);
    }
    const open = xyPanel.classList.toggle('open');
    xyBtn.classList.toggle('on', open);
    if (open) xyPad!.refreshOptions();   // lanes/params may have changed since last open
  });
}
