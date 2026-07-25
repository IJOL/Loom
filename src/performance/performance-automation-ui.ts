// Editable automation lanes for Performance view. Reuses automation-painter
// (drawLane/attachLanePainter). Pure-render: callers pass the curve + callbacks;
// we never touch the audio graph here. The curve is already painter-shaped
// ({ values, enabled, stepped }) after Task 1.
//
// Both builders are ONE-SHOT lit instantiations (renderElement), not
// re-rendering panels: the Performance view rebuilds them wholesale on every
// commit, and in between the header buttons patch their own class/text
// imperatively (an On/Off toggle must not trigger a full view repaint).
import { html, nothing } from 'lit-html';
import { renderElement } from '../core/lit-fragment';
import type { KnobHandle } from '../core/knob';
import type { AutomationCurve } from './performance';
import type { DestinationRegistry } from '../automation/destination-registry';
import { groupTargetsByLane } from '../automation/automation-targets';
import { stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../core/meter';
import {
  drawLane, attachLanePainter, formatNum,
  type AutoBrush,
} from '../automation/automation-painter';

export interface PerfAutoDeps {
  registry: Map<string, KnobHandle>;
  /** The one destination catalogue (Task 4/9) — replaces the optional
   *  sessionState as the list source. Required: an absent registry used to
   *  render this picker silently empty (sessionState was optional); a
   *  DestinationRegistry always exists once a session is running, so there is
   *  no legitimate caller that can't supply one. */
  destinations: DestinationRegistry;
  /** Width in px for a full-arrangement canvas at the current zoom. */
  laneWidthPx: number;
  getBrush: () => AutoBrush;
  setBrush: (b: AutoBrush) => void;
  /** Whether the paint brush belongs on screen: it only affects drawing a
   *  lane, so with zero curves there is nothing for it to paint. */
  showBrush: boolean;
  onAdd: (paramId: string) => void;
  onRemove: (paramId: string) => void;
  onEdited: () => void;
  /** The arrangement's meter, for the lane's bar/beat grid. Absent ⇒ 4/4. */
  meter?: TimeSignature;
}

/** Build the "+ Automation" header: a grouped param select + add button, and —
 *  only once a curve exists — the Line/Flat paint brush. The brush lives here,
 *  next to what it paints, instead of in the main toolbar beside
 *  Length/Zoom/Loop, where it read as a top-level transport control and stayed
 *  visible over an arrangement with no automation at all. */
export function buildAutomationHeader(deps: PerfAutoDeps): HTMLElement {
  // Destinations come from the shared catalogue, not from whatever knobs are
  // mounted: the picker must offer an insert on a channel whose editor is
  // closed, and must not offer a lane that a previous save left behind in
  // the registry.
  const targets = deps.destinations.list();
  // Brush switching repaints only the two buttons — this header is a one-shot
  // build, and a full view re-render for a purely local highlight change would
  // rebuild every lane canvas and its painter.
  const brushBtn = (b: AutoBrush, label: string) => html`<button
    class=${'rnd' + (deps.getBrush() === b ? ' primary' : '')}
    @click=${(e: Event) => {
      deps.setBrush(b);
      const btn = e.currentTarget as HTMLElement;
      btn.closest('.perf-brush-bar')!.querySelectorAll('button').forEach((x) => x.classList.remove('primary'));
      btn.classList.add('primary');
    }}
  >${label}</button>`;

  return renderElement(html`<div class="perf-auto-header"><select class="perf-auto-param-select">${
    [...groupTargetsByLane(targets)].map(([laneName, group]) => html`<optgroup label=${laneName}>${
      group.map((t) => html`<option value=${t.id}>${t.label}</option>`)
    }</optgroup>`)
  }</select><button
      class="rnd primary"
      @click=${(e: Event) => {
        const sel = (e.currentTarget as HTMLElement).closest('.perf-auto-header')!.querySelector('select')!;
        if (sel.value) deps.onAdd(sel.value);
      }}
    >+ Automation</button>${deps.showBrush
      ? html`<span class="perf-brush-label">Brush</span><span
          class="perf-brush-bar"
        >${brushBtn('line', 'Line')}${brushBtn('flat', 'Flat')}</span>`
      : nothing}</div>`);
}

/** Build one editable lane for a curve. The painter mutates curve.values in
 *  place; flags (enabled/stepped) toggle from the header buttons. */
export function buildAutomationLane(curve: AutomationCurve, deps: PerfAutoDeps): HTMLElement {
  const entry = deps.registry.get(curve.paramId);
  // curve already has the painter's {values, enabled, stepped} shape.
  const laneView = curve as { values: number[]; enabled: boolean; stepped?: boolean };

  let canvas: HTMLCanvasElement;
  // playheadFrac -1: the Arrangement draws ONE global cursor element
  // (#perf-playhead) across every lane, so a per-canvas line is not wanted here.
  // It never worked anyway — the caller passed a `() => 0` stub for the sub-step
  // index, so the line, when drawn, sat at x=0 for the whole take.
  // Bar/beat lines come from the arrangement's own meter: the curve is stored at
  // stepsPerBar(meter) steps per bar (arrangement-ops.subStepsForBars), so a
  // fixed 16 would draw its bars somewhere else than the ruler above it.
  const m = deps.meter ?? DEFAULT_METER;
  const draw = () =>
    drawLane(canvas, { values: laneView.values, enabled: curve.enabled !== false, stepped: curve.stepped },
      { stepsPerBar: stepsPerBar(m), stepsPerBeat: stepsPerBeat(m), playheadFrac: -1 });

  const toggleEnable = (e: Event) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const isOn = curve.enabled !== false;
    curve.enabled = !isOn;
    btn.classList.toggle('active', curve.enabled);
    btn.textContent = curve.enabled ? 'On' : 'Off';
    draw(); deps.onEdited();
  };
  const toggleStepped = (e: Event) => {
    const btn = e.currentTarget as HTMLButtonElement;
    curve.stepped = !curve.stepped;
    btn.classList.toggle('active', !!curve.stepped);
    btn.textContent = curve.stepped ? 'Stepped' : 'Smooth';
    draw(); deps.onEdited();
  };

  const w = Math.max(120, Math.round(deps.laneWidthPx));
  // data-param-id: scroll-to-reveal target for the knob context menu's "Edit
  // automation on the timeline" (knob-automation-menu.ts's revealTimelineCurve).
  const wrap = renderElement(html`<div
    class=${entry ? 'perf-auto-lane' : 'perf-auto-lane missing'}
    data-param-id=${curve.paramId}
  ><div class="perf-auto-lane-header"><div class="label">${curve.paramId}${entry ? '' : ' (unavailable)'}</div><button
      class=${'enable' + (curve.enabled !== false ? ' active' : '')}
      @click=${toggleEnable}
    >${curve.enabled !== false ? 'On' : 'Off'}</button><button
      class=${'stepped' + (curve.stepped ? ' active' : '')}
      @click=${toggleStepped}
    >${curve.stepped ? 'Stepped' : 'Smooth'}</button><span
      class="perf-auto-range"
    >${entry ? `[${formatNum(entry.meta.min)} .. ${formatNum(entry.meta.max)}]` : ''}</span><button
      class="rnd"
      title="Remove lane"
      @click=${() => deps.onRemove(curve.paramId)}
    >×</button></div><canvas
      class="perf-auto-canvas"
      width=${w}
      height="64"
      style="width:${w}px;height:64px"
    ></canvas></div>`);

  canvas = wrap.querySelector('canvas')!;
  draw();
  attachLanePainter(canvas, laneView, () => { draw(); }, deps.getBrush);
  // Attached AFTER the painter so the painter's own pointerup (drag release)
  // runs first and onEdited snapshots the committed values — same listener
  // order the pre-lit code had.
  canvas.addEventListener('pointerup', () => deps.onEdited());

  return wrap;
}
