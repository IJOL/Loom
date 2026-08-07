// Per-clip automation lanes for the Session inspector.
//
// Each lane is a ClipAxis FOLLOWER (clip-auto-strip.ts): it starts where the
// editor's grid starts, is exactly as wide, and shares the clip's zoom, scroll,
// loop region and playhead. Before that the lanes drew on a private canvas of
// `max(800, bars * 240)` px with no zoom and no loop, which is why they never
// lined up with the clip they belong to.
//
// The panel is a lit-html template mounted via mountPanel into the caller's
// host. Each lane's STRIP (canvas + painter listeners + follower subscription)
// is built once and interpolated by node, so a header toggle or an add/remove
// repaints AROUND it and an in-flight paint drag is never dropped. Strips are
// held in a Map rather than the panel's ControlCache because they need explicit
// disposal (they hold an axis subscription): a lane removed from the clip is
// reaped at the end of the render that dropped it.

import { html, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import type { SessionClip, ClipEnvelope } from './session';
import { groupTargetsByLane, automationTargetLabel, type AutomationTarget } from '../automation/automation-targets';
import type { DestinationRegistry } from '../automation/destination-registry';
import type { ClipAxis } from '../core/clip-axis';
import { stepsPerBar, type TimeSignature } from '../core/meter';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { effectiveClipLoop } from '../core/clip-loop';
import { TICKS_PER_STEP } from '../core/notes';
import { addClipEnvelope } from './clip-envelope-ops';
import { mountPanel, type PanelHandle } from '../core/lit-panel';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { createAutoStrip, type AutoStrip } from './clip-auto-strip';
import { paintRegion } from './clip-auto-region';
import { stepRowTemplate } from './clip-automation-step-row';
import { formatNum, snapLaneToSteps, type AutoBrush } from '../automation/automation-painter';
import {
  fillLfo, LFO_SHAPES, DEFAULT_LFO_FILL, LFO_MIN_CYCLES,
  cyclesToCyclesPerBar, maxCyclesInRegion, clampCyclesInRegion, type LfoShape,
} from '../automation/automation-lfo';

let currentBrush: AutoBrush = 'line';
const getBrush = () => currentBrush;

// LFO generator settings. Module-level like the brush: ONE wave shared by every
// lane, so you dial it in once and paint lane after lane. They persist while you
// work across lanes and clips instead of resetting on every repaint, and they are
// deliberately not saved with the session.
const lfoState = {
  shape: 'sine' as LfoShape,
  /** Cycles across the region being painted — not per bar. */
  cycles: 4,
  /** Peak-to-peak share of the lane. */
  depth: 1,
  /** Where the wave sits vertically, in lane units. */
  center: 0.5,
  /** Rotation, in cycles. */
  phase: 0,
  loopOnly: true,
};

/** paramIds whose LFO row is unfolded. Unlike the wave itself this is view state
 *  of ONE panel — a fresh inspector opens with every row folded — so it is held
 *  in the render closure, not up here. */
type LfoOpen = Set<string>;

export interface ClipAutoDeps {
  /** The one destination catalogue — the picker's list source. The caller
   *  subscribes to it and re-renders this panel when the session's set of
   *  automatable params changes (insert add/remove, engine swap, lane
   *  add/remove). */
  destinations: DestinationRegistry;
  /** The clip's shared horizontal time axis: what makes these lanes line up
   *  with the editor above and zoom together with it. */
  axis: ClipAxis;
  /** Session meter — bar/beat grid lines, and the loop region in ticks. */
  meter: TimeSignature;
  /** Playhead as a 0..1 fraction of the clip; negative when idle. Same source
   *  as the note editor's cursor (core/clip-playhead.ts). */
  getPlayheadFrac: () => number;
  /** Undo bracket for generated curves (the LFO button). */
  historyDeps?: HistoryDeps;
}

export interface ClipAutoHandle {
  /** Per-frame tick: keeps every lane aligned with the editor and animates the
   *  playhead. Cheap when nothing moved. */
  tick: () => void;
  /** Release every lane's axis subscription. Call before dropping the panel. */
  dispose: () => void;
}

export function renderClipAutomationLanes(
  host: HTMLElement,
  clip: SessionClip,
  deps: ClipAutoDeps,
): ClipAutoHandle {
  // paramId -> strip. Create-once, explicitly disposed.
  const strips = new Map<string, AutoStrip>();
  const lfoOpen: LfoOpen = new Set();
  const disposeAll = () => {
    for (const s of strips.values()) s.dispose();
    strips.clear();
  };

  const panel = mountPanel({
    container: host,
    className: 'clip-auto-lanes',
    deps,
    template: (h) => panelTemplate(h, clip, strips, lfoOpen),
  });
  // Belt and braces: a later mount with fresh deps runs this first, so even a
  // caller that forgets to dispose cannot leave subscriptions behind.
  panel.setCleanup(disposeAll);

  return {
    tick: () => { for (const s of strips.values()) s.tick(); },
    dispose: disposeAll,
  };
}

type Panel = PanelHandle<ClipAutoDeps>;

function panelTemplate(
  h: Panel, clip: SessionClip, strips: Map<string, AutoStrip>, lfoOpen: LfoOpen,
): TemplateResult {
  const targets = h.deps.destinations.list();
  const byId = new Map(targets.map((t) => [t.id, t]));

  const add = () => {
    const sel = h.host.querySelector<HTMLSelectElement>('.clip-auto-param-select');
    const paramId = sel?.value;
    if (!paramId) return;
    if (!addClipEnvelope(clip, paramId, h.deps.meter)) return;   // already exists
    h.rerender();
  };

  const envelopes = clip.envelopes ?? [];
  const tmpl = html`
    <div class="clip-auto-header">
      ${paramSelectTemplate(targets)}
      <button class="rnd primary" @click=${add}>+ Automation</button>
      ${brushBarTemplate(h)}
    </div>
    ${envelopes.length === 0
      ? html`<p class="clip-auto-hint">Pick a parameter above and click "+ Automation" to add a lane.</p>`
      : repeat(
          envelopes,
          (env) => env.paramId,
          (env, idx) => laneTemplate(h, clip, env, idx, byId.get(env.paramId), strips, lfoOpen),
        )}
  `;

  // Reap strips whose lane is gone (× on a lane, or a whole clip swap): their
  // canvas is about to leave the DOM and their axis subscription must go with it.
  const alive = new Set(envelopes.map((e) => e.paramId));
  for (const [paramId, strip] of [...strips]) {
    if (!alive.has(paramId)) { strip.dispose(); strips.delete(paramId); }
  }
  return tmpl;
}

function laneTemplate(
  h: Panel,
  clip: SessionClip,
  env: ClipEnvelope,
  idx: number,
  target: AutomationTarget | undefined,
  strips: Map<string, AutoStrip>,
  lfoOpen: LfoOpen,
): TemplateResult {
  // An envelope whose param the session no longer declares (engine swapped,
  // insert removed) is still SHOWN — flagged, not silently swallowed, so the
  // user can see it and delete it rather than wonder where it went.

  // Default fields if missing on legacy clips.
  if (env.stepped === undefined) env.stepped = false;
  if (env.enabled === undefined) env.enabled = true;

  let strip = strips.get(env.paramId);
  if (!strip) {
    strip = createAutoStrip({
      axis: h.deps.axis,
      clip,
      meter: h.deps.meter,
      env,
      getBrush,
      getPlayheadFrac: h.deps.getPlayheadFrac,
    });
    strips.set(env.paramId, strip);
  }
  const s = strip;

  return html`
    <div class="${target ? 'auto-lane clip-auto-lane' : 'auto-lane clip-auto-lane missing'}">
      <div class="auto-lane-header">
        <div class="label">${automationTargetLabel(target, env.paramId)}</div>
        <button class=${env.enabled ? 'enable active' : 'enable'} @click=${() => {
          env.enabled = !env.enabled;
          s.draw();
          h.rerender();
        }}>${env.enabled ? 'On' : 'Off'}</button>
        <button class=${env.stepped ? 'stepped active' : 'stepped'} @click=${() => {
          env.stepped = !env.stepped;
          if (env.stepped) snapLaneToSteps({ values: env.values });
          s.draw();
          h.rerender();
        }}>${env.stepped ? 'Stepped' : 'Smooth'}</button>
        <span class="clip-auto-range">${target ? `[${formatNum(target.min)} .. ${formatNum(target.max)}]` : ''}</span>
        <button
          class=${lfoOpen.has(env.paramId) ? 'rnd clip-auto-lfo-toggle active' : 'rnd clip-auto-lfo-toggle'}
          title="Draw an LFO-shaped curve into this lane"
          @click=${() => {
            if (!lfoOpen.delete(env.paramId)) lfoOpen.add(env.paramId);
            h.rerender();
          }}
        >${lfoOpen.has(env.paramId) ? '▴' : '▾'} Draw</button>
        <button class="rnd" title="Remove this lane" @click=${() => {
          clip.envelopes!.splice(idx, 1);
          lfoOpen.delete(env.paramId);
          h.rerender();
        }}>×</button>
      </div>
      ${lfoOpen.has(env.paramId) ? modeRowTemplate(h, clip, env, s) : ''}
      ${s.root}
    </div>
  `;
}

// Which of the two painters the foldable row shows. Shared across lanes, like
// the wave settings themselves: you pick a way of drawing and then apply it
// lane by lane.
let rowMode: 'lfo' | 'steps' = 'lfo';

/** The foldable row: a mode picker, then whichever painter it names.
 *
 *  Describing a shape (LFO) and drawing one by hand (steps) are opposite
 *  directions of authorship onto the same lane, so they share a row rather
 *  than each growing a button of their own in a header that is already full. */
function modeRowTemplate(
  h: Panel, clip: SessionClip, env: ClipEnvelope, strip: AutoStrip,
): TemplateResult {
  return html`
    <div class="clip-auto-mode-row">
      <select class="clip-auto-mode" title="How this row draws"
              @change=${(e: Event) => {
                rowMode = (e.currentTarget as HTMLSelectElement).value as 'lfo' | 'steps';
                h.rerender();
              }}>
        <option value="lfo" ?selected=${rowMode === 'lfo'}>LFO</option>
        <option value="steps" ?selected=${rowMode === 'steps'}>Steps</option>
      </select>
      ${rowMode === 'lfo'
        ? lfoRowTemplate(h, clip, env, strip)
        : stepRowTemplate(h, clip, env, strip)}
    </div>
  `;
}

/** The stretch the LFO paints into. The shared rule lives in clip-auto-region;
 *  this only supplies the LFO's own "Loop only" toggle. */
function lfoRegion(clip: SessionClip, meter: TimeSignature, env: ClipEnvelope): { from: number; to: number } {
  return paintRegion(clip, meter, env, lfoState.loopOnly);
}

/** "An LFO, but drawn as automation": shape, how many cycles fit in the region,
 *  and three continuous controls — size, height and phase — written into the lane
 *  as a curve.
 *
 *  The count is cycles over the REGION, not per bar, because that is the only
 *  count that makes a wave close cleanly inside a loop; `originSub: from` is what
 *  makes it true (the first cycle starts where the region does). The conversion
 *  and the ceiling both live in automation-lfo.ts — nothing here re-derives them.
 *
 *  Every control repaints immediately: `fillLfo` overwrites the whole region, so
 *  repainting is idempotent and a drag cannot accumulate drift. The gesture
 *  bracket collapses a whole drag into one undo step, exactly like a knob. */
function lfoRowTemplate(h: Panel, clip: SessionClip, env: ClipEnvelope, strip: AutoStrip): TemplateResult {
  const subResPerBar = stepsPerBar(h.deps.meter) * AUTOMATION_SUB_RES;
  const { from, to } = lfoRegion(clip, h.deps.meter, env);
  const regionSubs = to - from;
  // A stepped lane keeps one value per step, so the fill has to paint the
  // staircase itself — otherwise snapLaneToSteps below throws the shape away and
  // the fast end collapses to a flat line.
  const stepSubRes = env.stepped ? AUTOMATION_SUB_RES : undefined;
  const maxCycles = maxCyclesInRegion(regionSubs, subResPerBar, stepSubRes);
  // Read live, never captured: a handler runs BEFORE the re-render, so a value
  // frozen at template time would paint the count the user just replaced.
  const cycles = () => clampCyclesInRegion(lfoState.cycles, regionSubs, subResPerBar, stepSubRes);

  const paint = () => {
    // The wave's bar is the SESSION's bar: drawn against a fixed 16-step bar the
    // curve went out of phase with the lane's own grid lines, which already come
    // from the meter.
    fillLfo(env.values, from, to, subResPerBar, {
      ...DEFAULT_LFO_FILL,
      shape: lfoState.shape,
      cyclesPerBar: cyclesToCyclesPerBar(cycles(), regionSubs, subResPerBar),
      depth: lfoState.depth,
      center: lfoState.center,
      phase: lfoState.phase,
      originSub: from,
      stepSubRes,
    });
    if (env.stepped) snapLaneToSteps({ values: env.values });
    strip.draw();
  };
  const repaint = () => {
    if (h.deps.historyDeps) withUndo(h.deps.historyDeps, paint); else paint();
    h.rerender();
  };

  // Same bracket the knobs and faders use: everything painted between pointerdown
  // and pointerup coalesces into a single undo step.
  const grab = () => h.deps.historyDeps?.beginGesture?.();
  const drop = () => h.deps.historyDeps?.endGesture?.();

  const slider = (
    label: string, title: string, value: number, max: number, read: string,
    set: (v: number) => void,
  ) => html`
    <label class="clip-auto-lfo-slider" title=${title}>
      <span class="clip-auto-lfo-slider-name">${label}</span>
      <input
        type="range" min="0" max=${max} step="0.001" .value=${String(value)}
        @pointerdown=${grab} @pointerup=${drop} @pointercancel=${drop}
        @input=${(e: Event) => { set(Number((e.currentTarget as HTMLInputElement).value)); repaint(); }}
      >
      <span class="clip-auto-lfo-slider-read">${read}</span>
    </label>
  `;

  // "Loop only" carries `active`, not `primary`: the lane-header button rule in
  // _session-inspector.scss owns the background in here and only lights up on
  // .active, so a `primary` toggle looked identical on and off.
  return html`
    <div class="clip-auto-lfo">
        <select class="clip-auto-lfo-shape" title="LFO waveform to draw"
          @change=${(e: Event) => {
            lfoState.shape = (e.currentTarget as HTMLSelectElement).value as LfoShape;
            repaint();
          }}>
          ${LFO_SHAPES.map((s) => html`<option value=${s.id} ?selected=${s.id === lfoState.shape}>${s.label}</option>`)}
        </select>
        <label class="clip-auto-lfo-cycles" title=${`Whole cycles across the region being painted. This lane tops out at ${formatNum(maxCycles)}.`}>
          <span>Cycles</span>
          <input
            type="number" min=${LFO_MIN_CYCLES} max=${maxCycles} step="any" .value=${String(cycles())}
            @change=${(e: Event) => {
              lfoState.cycles = Number((e.currentTarget as HTMLInputElement).value);
              repaint();
            }}
          >
        </label>
      ${slider('Size', 'Peak-to-peak: how much of the lane the wave spans',
        lfoState.depth, 1, `${Math.round(lfoState.depth * 100)}%`,
        (v) => { lfoState.depth = v; })}
      ${slider('Height', 'Where the wave sits vertically. Size that overshoots is flattened against the edge',
        lfoState.center, 1, `${Math.round(lfoState.center * 100)}%`,
        (v) => { lfoState.center = v; })}
      ${slider('Phase', 'Rotation of the wave inside the region',
        lfoState.phase, 1, `${Math.round(lfoState.phase * 360)}°`,
        (v) => { lfoState.phase = v; })}
      <button
        class=${lfoState.loopOnly ? 'rnd clip-auto-lfo-loop active' : 'rnd clip-auto-lfo-loop'}
        title="Draw inside the loop region only (when the clip loops)"
        @click=${() => { lfoState.loopOnly = !lfoState.loopOnly; h.rerender(); }}
      >Loop</button>
      <button class="rnd clip-auto-lfo-apply" title="Draw the curve into this lane" @click=${repaint}>LFO</button>
    </div>
  `;
}

function paramSelectTemplate(targets: AutomationTarget[]): TemplateResult {
  return html`<select class="clip-auto-param-select">${[...groupTargetsByLane(targets)].map(([laneName, group]) =>
    html`<optgroup label=${laneName}>${group.map((t) => html`<option value=${t.id}>${t.label}</option>`)}</optgroup>`,
  )}</select>`;
}

function brushBarTemplate(h: Panel): TemplateResult {
  const brushBtn = (b: AutoBrush, label: string) =>
    html`<button class=${currentBrush === b ? 'rnd primary' : 'rnd'} @click=${() => {
      currentBrush = b;
      h.rerender();
    }}>${label}</button>`;
  return html`<div class="clip-auto-brush-bar">${brushBtn('line', 'Line')}${brushBtn('flat', 'Flat')}</div>`;
}
