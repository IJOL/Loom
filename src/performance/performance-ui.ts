// src/performance/performance-ui.ts
// The Performance view mount: renders the arrangement timeline (toolbar, ruler,
// clip bands, automation lanes, playhead) into the persistent
// #performance-view-root host via lit-html. The host keeps its id/class and the
// children keep their exact structure — e2e selectors query
// `#performance-view-root .perf-*` directly. Templates live in
// performance-ui-templates.ts; the automation header/lanes are one-shot
// imperative builds (canvas painters) interpolated as elements.

import { render, html, nothing, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import type { ArrangementState } from './performance';
import type { KnobHandle } from '../core/knob';
import type { DestinationRegistry } from '../automation/destination-registry';
import type { AutoBrush } from '../automation/automation-painter';
import { effectiveDurationSec } from './arrangement-ops';
import { buildAutomationHeader, buildAutomationLane, type PerfAutoDeps } from './performance-automation-ui';
import {
  barSecOf, toolbarTemplate, emptyTemplate, rulerTemplate, clipBandTemplate, labelTemplate,
} from './performance-ui-templates';

export interface PerfUICallbacks {
  onPlay: () => void;
  onStop: () => void;
  onGoToSession: () => void;
  resolveClipColor: (clipId: string) => string;
  resolveClipName: (clipId: string) => string;
  registry: Map<string, KnobHandle>;
  /** The one destination catalogue (Task 4/9) — the automation picker's list
   *  source. Required: an absent one used to render the picker silently
   *  empty. */
  destinations: DestinationRegistry;
  laneIds: readonly string[];
  pxPerBar: number;
  getBrush: () => AutoBrush;
  setBrush: (b: AutoBrush) => void;
  onSetLengthBars: (bars: number) => void;
  onZoom: (pxPerBar: number) => void;
  onAddCurve: (paramId: string) => void;
  onRemoveCurve: (paramId: string) => void;
  onEdited: () => void;
  loopEnabled: boolean;
  loopStartBar: number;
  loopEndBar: number;
  onSetLoop: (enabled: boolean, startBar: number, endBar: number) => void;
  onMoveBand: (laneId: string, index: number, newAtSec: number) => void;
  onResizeBand: (laneId: string, index: number, edge: 'start' | 'end', newSec: number) => void;
  onDeleteBand: (laneId: string, index: number) => void;
  /** Optional: build the compact master strip (VU + fader) for the toolbar.
   *  Returns null when no audio graph is wired (test fixtures). */
  buildMaster?: () => HTMLElement | null;
  /** Optional: build per-lane header controls (mute/solo + VU) for a lane row.
   *  Returns null when the lane isn't allocated (no strip). */
  buildLaneHeader?: (laneId: string) => HTMLElement | null;
}

type HostWithWheel = HTMLElement & { __wheelZoom?: EventListener };

export function attachWheelZoom(host: HTMLElement, cb: PerfUICallbacks): void {
  // `host` (#performance-view-root) PERSISTS across re-renders: a repaint patches
  // its children but NOT the host's own listeners. renderPerformanceView calls
  // this every render, so wheel handlers stacked — each wheel fired ALL of
  // them → N onZoom → N re-renders → +N handlers: an exponential blow-up that
  // froze the tab. Remove the previous handler before adding the current one.
  const h = host as HostWithWheel;
  if (h.__wheelZoom) host.removeEventListener('wheel', h.__wheelZoom);
  const handler: EventListener = (e) => {
    const we = e as WheelEvent;
    if (!we.ctrlKey) return;
    we.preventDefault();
    const factor = we.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(16, Math.min(400, cb.pxPerBar * factor));
    cb.onZoom(Math.round(next));
  };
  host.addEventListener('wheel', handler, { passive: false });
  h.__wheelZoom = handler;
}

function viewTemplate(state: ArrangementState, cb: PerfUICallbacks): TemplateResult {
  const dur = effectiveDurationSec(state);
  if (dur === 0) return html`${toolbarTemplate(state, cb)}${emptyTemplate(cb)}`;

  const totalBars = Math.ceil(dur / barSecOf(state.bpm));
  const autoDeps: PerfAutoDeps = {
    registry: cb.registry,
    destinations: cb.destinations,
    laneWidthPx: totalBars * cb.pxPerBar,
    getBrush: cb.getBrush,
    onAdd: cb.onAddCurve,
    onRemove: cb.onRemoveCurve,
    onEdited: cb.onEdited,
  };

  // The automation header/lanes are freshly built elements on every render
  // (canvas + painter), so lit swaps them wholesale — the same lifecycle the
  // old full rebuild had. Lanes are keyed by laneId so adding/removing a lane
  // patches rows instead of shifting every band's identity.
  // Single "+ Automation" control; the chosen param's prefix routes it into a
  // lane section or the master section (arrangement-ops.routeParamId).
  return html`${toolbarTemplate(state, cb)}${rulerTemplate(dur, state.bpm, cb.pxPerBar, cb)}${buildAutomationHeader(autoDeps)}${repeat(
    state.lanes,
    (lane) => lane.laneId,
    (lane) => html`${clipBandTemplate(lane, dur, state.bpm, cb.pxPerBar, cb)}${lane.automation.map((curve) => buildAutomationLane(curve, autoDeps))}`,
  )}${state.globalAutomation.length > 0
    ? html`<div class="perf-row perf-master-header">${labelTemplate('MASTER')}</div>${state.globalAutomation.map((curve) => buildAutomationLane(curve, autoDeps))}`
    : nothing}<div class="perf-playhead" id="perf-playhead"></div>`;
}

export function renderPerformanceView(host: HTMLElement, state: ArrangementState, cb: PerfUICallbacks): void {
  host.classList.add('performance-view');
  if (effectiveDurationSec(state) > 0) attachWheelZoom(host, cb);
  render(viewTemplate(state, cb), host);
}
