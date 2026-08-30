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
import type { TimeSignature } from '../core/meter';
import { effectiveDurationSec } from './arrangement-ops';
import { buildAutomationHeader, buildAutomationLane, type PerfAutoDeps } from './performance-automation-ui';
import {
  toolbarTemplate, emptyTemplate, rulerTemplate, clipBandTemplate, labelTemplate,
} from './performance-ui-templates';
import { songBarSec } from '../core/song-position';
import { peaksFor, paintWaveband, paintNoteband } from './band-render';

export interface PerfCaptureCallbacks {
  state: 'idle' | 'waiting' | 'recording' | 'finalizing';
  source: 'master' | 'system' | 'mic';
  monitor: boolean;
  /** 1-based, for "recording at bar N…" and the ghost's landing spot. */
  startBar: number;
  onToggle(): void;
  onSource(k: 'master' | 'system' | 'mic'): void;
  onMonitor(): void;
}

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
  /** The SONG meter, read from its owner (the Sequencer) at render time. The
   *  arrangement does not carry one — see ArrangementState. */
  meter: TimeSignature;
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
  /** Ruler click: move the playhead to the clicked seconds. */
  onSeek?: (sec: number) => void;
  /** What a band SHOWS (waveform / note preview / loop ticks / bars-chip).
   *  Null for a clip the session no longer holds — the band paints as a ghost. */
  resolveClipInfo?: (clipId: string) => import('./band-render').BandClipInfo | null;
  /** The selected band ids — painted with the selection outline. */
  selection?: ReadonlySet<string>;
  // Band MOVEMENT belongs to the gesture layer (perf-gestures.ts) since the
  // Arrange round — only resize (the edge handles) and delete stay per-element.
  onResizeBand: (laneId: string, index: number, edge: 'start' | 'end', newSec: number) => void;
  onDeleteBand: (laneId: string, index: number) => void;
  /** Optional: build the compact master strip (VU + fader) for the toolbar.
   *  Returns null when no audio graph is wired (test fixtures). */
  buildMaster?: () => HTMLElement | null;
  /** Optional: build per-lane header controls (mute/solo + VU) for a lane row.
   *  Returns null when the lane isn't allocated (no strip). */
  buildLaneHeader?: (laneId: string) => HTMLElement | null;
  /** Loop capture (● in the toolbar). Absent when no audio graph is wired —
   *  the button doesn't render and the empty-state one stays disabled. */
  capture?: PerfCaptureCallbacks;
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
  const dur = effectiveDurationSec(state, cb.meter);
  if (dur === 0) return html`${toolbarTemplate(state, cb)}${emptyTemplate(cb)}`;

  // One bar length for the whole view: ruler, bands and lane widths all use it.
  const barSec = songBarSec(state.bpm, cb.meter);
  const totalBars = Math.ceil(dur / barSec);
  const autoDeps: PerfAutoDeps = {
    registry: cb.registry,
    destinations: cb.destinations,
    laneWidthPx: totalBars * cb.pxPerBar,
    getBrush: cb.getBrush,
    setBrush: cb.setBrush,
    // The brush paints a lane canvas, so it only earns screen space once at
    // least one curve exists — per-lane or on the master section.
    showBrush: state.globalAutomation.length > 0 || state.lanes.some((l) => l.automation.length > 0),
    onAdd: cb.onAddCurve,
    onRemove: cb.onRemoveCurve,
    onEdited: cb.onEdited,
    meter: cb.meter,
  };

  // The automation header/lanes are freshly built elements on every render
  // (canvas + painter), so lit swaps them wholesale — the same lifecycle the
  // old full rebuild had. Lanes are keyed by laneId so adding/removing a lane
  // patches rows instead of shifting every band's identity.
  // Single "+ Automation" control; the chosen param's prefix routes it into a
  // lane section or the master section (arrangement-ops.routeParamId).
  // ONE scroll surface: the ruler and every row scroll together inside
  // .perf-scroller (sticky ruler on top, sticky labels on the left). The rows
  // used to each own an overflow-x, which desynced on a long song. The toolbar
  // stays outside — it is chrome, not timeline.
  return html`${toolbarTemplate(state, cb)}<div class="perf-scroller">${rulerTemplate(dur, barSec, cb.pxPerBar, cb)}${buildAutomationHeader(autoDeps)}${repeat(
    state.lanes,
    (lane) => lane.laneId,
    (lane) => html`${clipBandTemplate(lane, dur, barSec, cb.pxPerBar, cb)}${lane.automation.map((curve) => buildAutomationLane(curve, autoDeps))}`,
  )}${state.globalAutomation.length > 0
    ? html`<div class="perf-row perf-master-header">${labelTemplate('MASTER')}</div>${state.globalAutomation.map((curve) => buildAutomationLane(curve, autoDeps))}`
    : nothing}<div class="perf-row perf-droplane">${labelTemplate('＋ new lane')}<div
      class="perf-track"
      style="width:${totalBars * cb.pxPerBar}px"
    ><div class="perf-dropzone">⇣ drop audio loops — each becomes an Audio lane, fitted to bars</div>${cb.capture && cb.capture.state !== 'idle' ? html`<div
      class=${'perf-capture-ghost ' + cb.capture.state}
      style="left:${(cb.capture.startBar - 1) * cb.pxPerBar}px"
    ></div>` : nothing}</div></div><div class="perf-playhead" id="perf-playhead"></div></div>`;
}

export function renderPerformanceView(host: HTMLElement, state: ArrangementState, cb: PerfUICallbacks): void {
  host.classList.add('performance-view');
  if (effectiveDurationSec(state, cb.meter) > 0) attachWheelZoom(host, cb);
  render(viewTemplate(state, cb), host);
  paintBandCanvases(host, cb);
}

/** One imperative pass after each lit commit: paint every band canvas from the
 *  cached peaks / the clip's notes. Painting inside the template would tie the
 *  canvas lifecycle to lit's diffing; painting here keeps it a plain "the DOM
 *  is settled, fill the pixels" step, and it only runs on render commits. */
function paintBandCanvases(host: HTMLElement, cb: PerfUICallbacks): void {
  if (!cb.resolveClipInfo) return;
  host.querySelectorAll<HTMLCanvasElement>('canvas.perf-clip-canvas').forEach((canvas) => {
    const clipId = canvas.dataset.clipId ?? '';
    const info = cb.resolveClipInfo!(clipId);
    if (!info) return;
    // Backing store sized from the CSS box (the band's inline width).
    const boxW = Math.max(1, Math.round(parseFloat(canvas.dataset.w ?? '0')));
    canvas.width = boxW;
    canvas.height = 30;
    if (info.kind === 'audio' && info.sampleId) {
      const peaks = peaksFor(info.sampleId, 256);
      if (peaks) {
        const offsetFrac = info.loopSec > 0 ? (parseFloat(canvas.dataset.offsetSec ?? '0') / info.loopSec) : 0;
        const spanFrac = info.loopSec > 0 ? (parseFloat(canvas.dataset.durSec ?? '0') / info.loopSec) : 1;
        paintWaveband(canvas, peaks, offsetFrac, spanFrac);
      }
    } else if (info.kind === 'notes' && info.notes && info.lengthTicks) {
      paintNoteband(canvas, info.notes, info.lengthTicks);
    }
  });
}
