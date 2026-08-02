// Lane-editor routing for SessionHost: showing a lane's engine page and
// injecting its engine param UI + modulator/note-FX/insert panels + preset
// dropdowns. Extracted from session-host.ts.

import { html } from 'lit-html';
import { renderElement } from '../core/lit-fragment';
import type { SessionHost } from './session-host';
import { getEngine } from '../engines/registry';
import { renderNoteFxPanel } from '../notefx/notefx-ui';
import { getNoteFxChain } from '../notefx/notefx-registry';
import { syncNoteFx } from './session-engine-state';
import { laneEditorPanels } from './lane-editor-panels';
import { mountRandomizeButton } from '../core/randomize-ui';
import {
  mountDrumsPresetSelect,
  populatePolyPresetSelectForLane,
  refreshPolyPresetSelect,
} from '../polysynth/polysynth-presets';

/** Show a lane's editor: route to its engine's page (poly / 303 / drums),
 *  rebuild the engine param UI + modulator panel + labels. Does NOT toggle.
 *  Used by onEditLane (non-toggle path) and by the post-engine-swap re-route. */
export function showLaneEditor(self: SessionHost, laneId: string): void {
  const lane = self.state.lanes.find((l) => l.id === laneId);
  // The clip editor follows the lane selection: a clip left open on ANOTHER lane
  // would keep taking the edits, generators and ▶ meant for the lane just picked.
  // Same-lane callers (engine swap, collapse chevron, undo repaint) are no-ops.
  self.inspector?.closeIfOtherLane(laneId);
  // Selecting a lane always OPENS its editor — clear any collapse the chevron set.
  self.synthCollapsed = false;

  // TWO pages, not three. The TB-303 used to route to a page of its own — a
  // leftover from when Loom WAS a 303 + a drum machine. By the time it died that
  // page was a strict subset of the poly one (same ENGINE/PRESET row with other
  // ids, same FX row), because its only bespoke content — the static Wave /
  // Cutoff / Resonance / Env / Decay / Accent row — had already moved into
  // buildParamUI like every other engine. All it still bought us was a second
  // copy of every header control, and the copies drifted: the dice on one page
  // repainted the knobs while the dice on the other unregistered them.
  const targetTab =
    (lane?.engineId === 'drums-machine' || laneId.startsWith('drum:')) ? 'drums' : 'poly';
  // No lane-tabs row any more — the grid column header carries the active mark
  // (session-lane-header-active, applied by renderSessionGrid). Only the page
  // tab-strip buttons need toggling here.
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === targetTab && !t.classList.contains('synth-tab'));
  });
  const displayName = lane?.name ?? laneId.toUpperCase();
  document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
    p.hidden = p.dataset.page !== targetTab;
  });
  // Every poly lane retargets the preset dropdown, the engine selector and the
  // engine-mod-host to itself: setActiveEngineLane updates the active lane id
  // polysynth-presets reads when the user picks a preset.
  //
  // There used to be a `showPolyEditor(laneId, polyTarget, …)` branch ahead of
  // this for subtractive lanes, reached only when the lane's engine answered
  // `getPolySynth()`. No engine implements that method, so the branch never ran
  // and every lane already took this path — the condition was decorative.
  if (targetTab === 'poly') {
    self.deps.setActiveEngineLane?.(laneId);
  }
  // Keep #engine-lane-label in sync for non-poly lanes too (no-op if the
  // active page doesn't include it).
  const laneLabelEl = document.getElementById('engine-lane-label');
  if (laneLabelEl) laneLabelEl.textContent = displayName;
  const polyActiveLabel = document.getElementById('poly-active-label');
  if (polyActiveLabel) polyActiveLabel.textContent = displayName;
  self.activeEditLane = laneId;
  injectEngineModulatorPanel(self, laneId, targetTab);
  self.deps.onActiveLaneChanged?.();
  // Re-render the grid so the newly-active lane's column header + cells + mixer
  // strip get marked (renderSessionGrid reads self.activeEditLane).
  self.renderWithMixer();
}

// ── Engine modulator panel injection ─────────────────────────────────────
// Single source of truth for the modulators UI: every editable lane (bass,
// drums, and every poly lane regardless of engine) gets its panel injected
// into the bottom of the currently-shown page.

/** Ids the lane editor's host registered on its last build, per host element.
 *  Weak-keyed so a discarded page takes its bookkeeping with it.
 *
 *  Ownership, not prefix: unregistering everything under `<laneId>.` would
 *  also delete `<laneId>.bus.*`, which is the mixer column — mounted
 *  elsewhere, still on screen, and automatable. Deleting a live knob handle
 *  silently breaks the control it belongs to; that too-wide hammer is what
 *  produced the frozen-modulation-rings bug. */
const idsOwnedByHost = new WeakMap<HTMLElement, Set<string>>();

export function injectEngineModulatorPanel(self: SessionHost, laneId: string, targetTab: string): void {
  // Phase B: engine comes from laneResources (single source of truth). No
  // more singleton/extra split — every lane has its own instance.
  const lane = self.state.lanes.find((l) => l.id === laneId);
  let engine = self.deps.laneResources?.get(laneId)?.engine;
  if (!engine) {
    // Fallback (e.g. drum sub-voice laneIds starting with `drum:` aren't in
    // laneResources). Use the engine for the lane's declared engineId.
    const engineId = lane?.engineId
      ?? (laneId.startsWith('drum:') ? 'drums-machine' : 'subtractive');
    engine = getEngine(engineId);
    if (!engine) return;
  }

  // Mount or reuse a container. Place the modulators panel BELOW the main
  // synth controls — for poly we anchor on #poly-seq-mode-row so the panel
  // sits between the engine controls and the SEQ MODE / tracks block. For
  // other pages (drums, bass) we fall back to appending at the end.
  const page = document.querySelector<HTMLElement>(`[data-page="${targetTab}"]`);
  if (!page) return;
  let host = page.querySelector<HTMLElement>('.engine-mod-host');
  if (!host) {
    // Build-once container the engines render into imperatively (buildParamUI
    // wipes and refills it) — a detached one-shot render, not a lit panel.
    host = renderElement(html`<div class="engine-mod-host"></div>`);
    // Place engine body BEFORE the FX row so the engine knobs render above
    // the compressor on every page: poly anchors on #poly-fx-row, while the
    // 303 / drums pages fall back to the FX row that hosts .lane-fx-knobs.
    const anchor = page.querySelector<HTMLElement>('#poly-fx-row')
      ?? page.querySelector<HTMLElement>('#poly-seq-mode-row')
      ?? page.querySelector<HTMLElement>('.lane-fx-knobs')?.closest<HTMLElement>('.row');
    if (anchor) page.insertBefore(host, anchor);
    else page.appendChild(host);
  }

  // Everything this host registered last time is about to be detached with the
  // wipe below, so its registry entries go with it. Automation for a lane whose
  // editor is closed reaches the audio object through the unmounted path.
  const previouslyOwned = idsOwnedByHost.get(host);
  if (previouslyOwned) {
    for (const id of previouslyOwned) self.deps.automationRegistry.delete(id);
  }
  const owned = new Set<string>();
  idsOwnedByHost.set(host, owned);
  const registerOwned = (k: import('../core/knob').KnobHandle) => {
    if (k.meta?.id) owned.add(k.meta.id);
    self.registerKnobHandle(k);
  };
  host.innerHTML = '';

  const panels = laneEditorPanels(lane?.engineId ?? engine.id);

  if (panels.engineParams) {
    engine.buildParamUI(host, {
      laneId,
      registerKnob: (k: unknown) => {
        registerOwned(k as import('../core/knob').KnobHandle);
      },
      registry: self.deps.automationRegistry as Map<string, unknown>,
      lookupLaneDisplayName: (id: string) =>
        self.state.lanes.find((l) => l.id === id)?.name,
      sessionState: self.state,
      historyDeps: self.deps.historyDeps,
      destinations: self.deps.destinations,
      audioContext: self.deps.ctx,
    });
  }

  // Per-lane NOTE FX panel — mounted next to MODULATORS (which buildParamUI
  // rendered into `host`). Drum lanes are not note-transformed, so skip them.
  if (panels.noteFx) {
    const nfHost = renderElement(html`<div class="lane-notefx-panel-host"></div>`);
    host.appendChild(nfHost);
    renderNoteFxPanel(nfHost, {
      laneId,
      chain: getNoteFxChain(laneId),
      onChange: (noteFx) => syncNoteFx(self.state, laneId, noteFx),
      historyDeps: self.deps.historyDeps,
    });
  }

  // Phase H: mount the insert-chain panel below the engine controls.
  // Every active lane has an InsertChain (allocated in ensureLaneResource)
  // so there is no boot-lane special case.
  self.inspector.mountLaneInserts(laneId, host, registerOwned);

  // Populate the correct preset dropdown for each page type.
  // The poly page's #poly-preset-select is populated here for EVERY poly-engine
  // lane (subtractive, fm, wavetable, …) so none of them show a stale previous
  // engine's presets.
  // Hide the poly page's ENGINE/PRESET/🎲 header row for audio lanes (an audio
  // channel is not an instrument).
  if (targetTab === 'poly') {
    const headerRow = page.querySelector<HTMLElement>('#poly-engine-row');
    if (headerRow) headerRow.style.display = panels.engineHeaderRow ? '' : 'none';
  }
  // The "🎲 Sound" button is mounted, not written in the markup: whether a lane
  // has one is a capability of its engine, and a static button cannot know that.
  const diceSlot = page.querySelector<HTMLElement>('[data-dice-slot]');
  if (diceSlot) mountRandomizeButton(diceSlot, laneId, panels.dice);
  if (panels.preset) {
    if (targetTab === 'poly') { populatePolyPresetSelectForLane(laneId); refreshPolyPresetSelect(); }
    if (targetTab === 'drums') mountDrumsPresetSelect(laneId);
  }
}
