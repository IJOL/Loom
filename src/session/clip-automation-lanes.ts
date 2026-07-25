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
import { formatNum, snapLaneToSteps, type AutoBrush } from '../automation/automation-painter';
import {
  fillLfo, LFO_RATES, LFO_SHAPES, DEFAULT_LFO_FILL, rateById, type LfoShape,
} from '../automation/automation-lfo';

let currentBrush: AutoBrush = 'line';
const getBrush = () => currentBrush;

// LFO generator settings. Module-level like the brush: they persist while you
// work across lanes and clips instead of resetting on every repaint.
const lfoState = { shape: 'sine' as LfoShape, rateId: '1bar', depth: 1, loopOnly: true };

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
  const disposeAll = () => {
    for (const s of strips.values()) s.dispose();
    strips.clear();
  };

  const panel = mountPanel({
    container: host,
    className: 'clip-auto-lanes',
    deps,
    template: (h) => panelTemplate(h, clip, strips),
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

function panelTemplate(h: Panel, clip: SessionClip, strips: Map<string, AutoStrip>): TemplateResult {
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
          (env, idx) => laneTemplate(h, clip, env, idx, byId.get(env.paramId), strips),
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
        ${lfoBarTemplate(h, clip, env, s)}
        <button class="rnd" title="Remove this lane" @click=${() => {
          clip.envelopes!.splice(idx, 1);
          h.rerender();
        }}>×</button>
      </div>
      ${s.root}
    </div>
  `;
}

/** "An LFO, but drawn as automation": shape + musical rate + depth, written into
 *  the lane as a curve. Rates are divisions of the BAR (4 bars … 1/16), not Hz,
 *  and the fill below is handed the meter's bar — so 1/16 is 16 cycles per bar,
 *  which is one cycle per step in 4/4 and more than one in a shorter bar. The
 *  rate table itself is still written against a 16-step bar (see the rate-limits
 *  note in automation-lfo.ts); until that is settled, nothing here may promise
 *  the user a per-STEP rate. */
function lfoBarTemplate(h: Panel, clip: SessionClip, env: ClipEnvelope, strip: AutoStrip): TemplateResult {
  const apply = () => {
    const cfg = {
      ...DEFAULT_LFO_FILL,
      shape: lfoState.shape,
      cyclesPerBar: rateById(lfoState.rateId)?.cyclesPerBar ?? 1,
      depth: lfoState.depth,
    };
    // Scope: the loop region when the clip loops and "Loop only" is on, else the
    // whole lane. Sub-step 0 is bar 0 phase 0, so a windowed fill lands exactly
    // where the full-lane fill would have — the curve stays in phase with the bars.
    let from = 0, to = env.values.length;
    if (lfoState.loopOnly && clip.loopEnabled) {
      const { startTick, endTick } = effectiveClipLoop(clip, h.deps.meter);
      from = Math.round((startTick / TICKS_PER_STEP) * AUTOMATION_SUB_RES);
      to = Math.round((endTick / TICKS_PER_STEP) * AUTOMATION_SUB_RES);
    }
    const run = () => {
      // The wave's bar is the SESSION's bar. Drawn against a 16-step bar it went
      // out of phase with the lane's own grid lines, which already come from the
      // meter — a "1 bar" LFO that visibly did not span one bar.
      fillLfo(env.values, from, to, stepsPerBar(h.deps.meter) * AUTOMATION_SUB_RES, cfg);
      if (env.stepped) snapLaneToSteps({ values: env.values });
      strip.draw();
    };
    if (h.deps.historyDeps) withUndo(h.deps.historyDeps, run); else run();
  };

  // "Loop only" carries `active`, not `primary`: the lane-header button rule in
  // _session-inspector.scss owns the background in here and only lights up on
  // .active, so a `primary` toggle looked identical on and off.
  const onShape = (e: Event) => { lfoState.shape = (e.currentTarget as HTMLSelectElement).value as LfoShape; };
  const onRate = (e: Event) => { lfoState.rateId = (e.currentTarget as HTMLSelectElement).value; };
  const onDepth = (e: Event) => { lfoState.depth = Number((e.currentTarget as HTMLSelectElement).value); };

  return html`
    <span class="clip-auto-lfo">
      <select class="clip-auto-lfo-shape" title="LFO waveform to draw" @change=${onShape}>
        ${LFO_SHAPES.map((s) => html`<option value=${s.id} ?selected=${s.id === lfoState.shape}>${s.label}</option>`)}
      </select>
      <select
        class="clip-auto-lfo-rate"
        title="Rate as a musical division of the bar. 1/16 is 16 cycles per bar — the fastest this menu offers."
        @change=${onRate}
      >
        ${LFO_RATES.map((r) => html`<option value=${r.id} ?selected=${r.id === lfoState.rateId}>${r.label}</option>`)}
      </select>
      <select class="clip-auto-lfo-depth" title="How much of the lane the wave spans" @change=${onDepth}>
        ${[1, 0.75, 0.5, 0.25].map((d) => html`<option value=${d} ?selected=${d === lfoState.depth}>${Math.round(d * 100)}%</option>`)}
      </select>
      <button
        class=${lfoState.loopOnly ? 'rnd clip-auto-lfo-loop active' : 'rnd clip-auto-lfo-loop'}
        title="Draw inside the loop region only (when the clip loops)"
        @click=${() => { lfoState.loopOnly = !lfoState.loopOnly; h.rerender(); }}
      >Loop only</button>
      <button class="rnd clip-auto-lfo-apply" title="Draw the curve into this lane" @click=${apply}>LFO</button>
    </span>
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
