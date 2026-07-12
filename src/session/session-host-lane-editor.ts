// Lane-editor routing for SessionHost: showing a lane's engine page and
// injecting its engine param UI + modulator/note-FX/insert panels + preset
// dropdowns. Extracted from session-host.ts.

import type { SessionHost } from './session-host';
import type { PolySynth } from '../polysynth/polysynth';
import { getEngine } from '../engines/registry';
import { renderNoteFxPanel } from '../notefx/notefx-ui';
import { getNoteFxChain } from '../notefx/notefx-registry';
import { syncNoteFx } from './session-engine-state';
import { laneEditorPanels } from './lane-editor-panels';
import {
  mountBassPresetSelect,
  mountDrumsPresetSelect,
  populatePolyPresetSelectForLane,
  refreshPolyPresetSelect,
} from '../polysynth/polysynth-presets';

/** Show a lane's editor: route to its engine's page (poly / 303 / drums),
 *  rebuild the engine param UI + modulator panel + labels. Does NOT toggle.
 *  Used by onEditLane (non-toggle path) and by the post-engine-swap re-route. */
export function showLaneEditor(self: SessionHost, laneId: string): void {
  const lane = self.state.lanes.find((l) => l.id === laneId);
  // Selecting a lane always OPENS its editor — clear any collapse the chevron set.
  self.synthCollapsed = false;

  let polyTarget: PolySynth | null = null;
  if (lane?.engineId === 'subtractive') {
    // Each subtractive lane owns its PolySynth instance — reach it via
    // the engine stored in laneResources.
    const engine = self.deps.laneResources?.get(laneId)?.engine;
    const getPS = (engine as unknown as { getPolySynth?(): PolySynth | null })?.getPolySynth;
    polyTarget = getPS ? getPS.call(engine) ?? null : null;
  }

  const targetTab =
    lane?.engineId === 'tb303'          ? '303'   :
    (lane?.engineId === 'drums-machine' || laneId.startsWith('drum:')) ? 'drums' :
                                                                         'poly';
  // No lane-tabs row any more — the grid column header carries the active mark
  // (session-lane-header-active, applied by renderSessionGrid). Only the page
  // tab-strip buttons need toggling here.
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === targetTab && !t.classList.contains('synth-tab'));
  });
  const displayName = lane?.name ?? laneId.toUpperCase();
  if (polyTarget) {
    self.deps.showPolyEditor(laneId, polyTarget, displayName);
  } else {
    document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
      p.hidden = p.dataset.page !== targetTab;
    });
    // FM/Wavetable/Karplus poly lanes: no PolySynth target, so the
    // showPolyEditor path above is skipped — but the preset dropdown,
    // engine selector, and engine-mod-host all need to retarget to
    // this lane. Calling setActiveEngineLane updates _lehState.activeLaneId
    // so that getActiveEngineLaneId() inside polysynth-presets.ts
    // resolves to the right lane when the user picks a preset.
    if (targetTab === 'poly') {
      self.deps.setActiveEngineLane?.(laneId);
    }
  }
  // Hide Subtractive-only knob rows when the active poly lane's engine
  // is NOT subtractive (FM / Wavetable / Karplus render their own
  // controls inside engine-mod-host; the legacy `data-engine="subtractive"`
  // rows shouldn't leak in on top). The toggle runs unconditionally so
  // switching back to a subtractive lane re-shows them.
  const polyPage = document.querySelector('[data-page="poly"]');
  if (polyPage) {
    const subRows = polyPage.querySelectorAll<HTMLElement>('[data-engine="subtractive"]');
    const showSubRows = lane?.engineId === 'subtractive';
    for (const row of subRows) row.style.display = showSubRows ? '' : 'none';
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
    host = document.createElement('div');
    host.className = 'engine-mod-host';
    // Place engine body BEFORE the FX row so the engine knobs render above
    // the compressor on every page: poly anchors on #poly-fx-row, while the
    // 303 / drums pages fall back to the FX row that hosts .lane-fx-knobs.
    const anchor = page.querySelector<HTMLElement>('#poly-fx-row')
      ?? page.querySelector<HTMLElement>('#poly-seq-mode-row')
      ?? page.querySelector<HTMLElement>('.lane-fx-knobs')?.closest<HTMLElement>('.row');
    if (anchor) page.insertBefore(host, anchor);
    else page.appendChild(host);
  }
  host.innerHTML = '';

  const panels = laneEditorPanels(lane?.engineId ?? engine.id);

  if (panels.engineParams) {
    engine.buildParamUI(host, {
      laneId,
      registerKnob: (k: unknown) => {
        const handle = k as import('../core/knob').KnobHandle;
        if (handle.meta?.id) self.deps.automationRegistry.set(handle.meta.id, handle);
      },
      registry: self.deps.automationRegistry as Map<string, unknown>,
      lookupLaneDisplayName: (id: string) =>
        self.state.lanes.find((l) => l.id === id)?.name,
      sessionState: self.state,
      historyDeps: self.deps.historyDeps,
      laneInserts: self.deps.laneResources?.get(laneId)?.inserts,
      masterInserts: self.deps.masterInsertChain,
      fxBus: self.deps.fxBus,
      audioContext: self.deps.ctx,
    });
  }

  // Per-lane NOTE FX panel — mounted next to MODULATORS (which buildParamUI
  // rendered into `host`). Drum lanes are not note-transformed, so skip them.
  if (panels.noteFx) {
    const nfHost = document.createElement('div');
    nfHost.className = 'lane-notefx-panel-host';
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
  self.inspector.mountLaneInserts(laneId, host);

  // Populate the correct preset dropdown for each page type.
  // The poly page's #poly-preset-select is populated here for ALL poly-engine
  // lanes (subtractive, fm, wavetable, karplus). For subtractive, the existing
  // showPolyEditor → rebuildEngineParamUI path also populates it (harmless
  // double call). For FM/Wavetable/Karplus, showPolyEditor is NOT called so
  // without this call those engines would show stale Subtractive presets.
  // Hide the poly page's ENGINE/PRESET/🎲 header row for audio lanes (an audio
  // channel is not an instrument). The subtractive knob rows are already hidden
  // for non-subtractive engines elsewhere.
  if (targetTab === 'poly') {
    const headerRow = page.querySelector<HTMLElement>('#poly-engine-row');
    if (headerRow) headerRow.style.display = panels.engineHeaderRow ? '' : 'none';
  }
  if (panels.preset) {
    if (targetTab === 'poly') { populatePolyPresetSelectForLane(laneId); refreshPolyPresetSelect(); }
    if (targetTab === '303') mountBassPresetSelect(laneId);
    if (targetTab === 'drums') mountDrumsPresetSelect(laneId);
  }
}
