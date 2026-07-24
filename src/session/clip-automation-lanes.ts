// Per-clip automation lane renderer for the Session inspector.
// Mirrors src/automation/automation-ui.ts but targets clip.envelopes
// instead of seq.pattern.automation, and uses clip.lengthBars instead of
// seq.length / 16.
//
// The panel is a lit-html template mounted via mountPanel into the caller's
// host. Each lane's canvas (plus its painter listeners and draw closure) is
// built once per mount in the panel's ControlCache, keyed by the envelope's
// paramId — a header toggle or an add/remove repaints AROUND the canvases, so
// an in-flight paint drag is never dropped. External calls (session-inspector's
// refreshClipAutomation) pass a fresh deps object, which resets the cache —
// the old full-rebuild semantics for structural refreshes.

import { html, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import type { SessionClip, ClipEnvelope } from './session';
import { groupTargetsByLane, automationTargetLabel, type AutomationTarget } from '../automation/automation-targets';
import type { DestinationRegistry } from '../automation/destination-registry';
import type { Sequencer } from '../core/sequencer';
import { addClipEnvelope } from './clip-envelope-ops';
import { mountPanel, type PanelHandle } from '../core/lit-panel';
import { renderElement } from '../core/lit-fragment';
import {
  ensureLaneSize, drawLane, attachLanePainter, formatNum,
  type AutoBrush, type PainterDeps,
} from '../automation/automation-painter';

let currentBrush: AutoBrush = 'line';
const getBrush = () => currentBrush;

export interface ClipAutoDeps {
  seq: Sequencer;
  getAutoAbsSubIdx: () => number;
  /** The one destination catalogue (Task 4/9) — replaces sessionState +
   *  automationRegistry as the list source. The caller (session-inspector)
   *  subscribes to it and re-renders this picker when the session's set of
   *  automatable params changes (insert add/remove, engine swap, lane
   *  add/remove) — see renderEditor()'s destinations.subscribe call. */
  destinations: DestinationRegistry;
}

// Lane shape that satisfies both drawLane (needs enabled+stepped) and
// attachLanePainter (needs values+stepped) — also the optional lengthBars
// consumed by snapLaneToSteps via attachLanePainter.
interface PainterLane {
  values: number[];
  enabled: boolean;
  stepped: boolean;
  lengthBars: number;
}

function asPainterLane(env: ClipEnvelope, lengthBars: number): PainterLane {
  return {
    values: env.values,
    enabled: env.enabled !== false,
    stepped: !!env.stepped,
    lengthBars,
  };
}

export function renderClipAutomationLanes(
  host: HTMLElement,
  clip: SessionClip,
  deps: ClipAutoDeps,
): void {
  mountPanel({
    container: host,
    className: 'clip-auto-lanes',
    deps,
    template: (h) => panelTemplate(h, clip),
  });
}

type Panel = PanelHandle<ClipAutoDeps>;

function panelTemplate(h: Panel, clip: SessionClip): TemplateResult {
  const targets = h.deps.destinations.list();
  const byId = new Map(targets.map((t) => [t.id, t]));

  const add = () => {
    const sel = h.host.querySelector<HTMLSelectElement>('.clip-auto-param-select');
    const paramId = sel?.value;
    if (!paramId) return;
    if (!addClipEnvelope(clip, paramId)) return;   // already exists
    h.rerender();
  };

  return html`
    <div class="clip-auto-header">
      ${paramSelectTemplate(targets)}
      <button class="rnd primary" @click=${add}>+ Automation</button>
      ${brushBarTemplate(h)}
    </div>
    ${!clip.envelopes || clip.envelopes.length === 0
      ? html`<p class="clip-auto-hint">Pick a parameter above and click "+ Automation" to add a lane.</p>`
      : repeat(
          clip.envelopes,
          (env) => env.paramId,
          (env, idx) => laneTemplate(h, clip, env, idx, byId.get(env.paramId)),
        )}
  `;
}

function laneTemplate(
  h: Panel,
  clip: SessionClip,
  env: ClipEnvelope,
  idx: number,
  target: AutomationTarget | undefined,
): TemplateResult {
  // An envelope whose param the session no longer declares (engine swapped,
  // insert removed) is still SHOWN — flagged, not silently swallowed, so the
  // user can see it and delete it rather than wonder where it went.

  // Default fields if missing on legacy clips.
  if (env.stepped === undefined) env.stepped = false;
  if (env.enabled === undefined) env.enabled = true;

  // Bring values to the size expected for clip.lengthBars * 16 steps.
  // ensureLaneSize expects seqLength in 16th-note steps. It only mutates
  // .values via push / length = N, which keeps the same array reference, so
  // env.values stays in sync.
  ensureLaneSize(
    { values: env.values, lengthBars: clip.lengthBars, stepped: env.stepped },
    clip.lengthBars * 16,
  );

  const w = h.cache.get(`lane:${env.paramId}`, () => buildLaneCanvas(h.deps, clip, env));

  return html`
    <div class="${target ? 'auto-lane clip-auto-lane' : 'auto-lane clip-auto-lane missing'}">
      <div class="auto-lane-header">
        <div class="label">${automationTargetLabel(target, env.paramId)}</div>
        <button class=${env.enabled ? 'enable active' : 'enable'} @click=${() => {
          env.enabled = !env.enabled;
          w.draw();
          h.rerender();
        }}>${env.enabled ? 'On' : 'Off'}</button>
        <button class=${env.stepped ? 'stepped active' : 'stepped'} @click=${() => {
          env.stepped = !env.stepped;
          w.draw();
          h.rerender();
        }}>${env.stepped ? 'Stepped' : 'Smooth'}</button>
        <span class="clip-auto-range">${target ? `[${formatNum(target.min)} .. ${formatNum(target.max)}]` : ''}</span>
        <button class="rnd" title="Remove this lane" @click=${() => {
          clip.envelopes!.splice(idx, 1);
          h.rerender();
        }}>×</button>
      </div>
      ${w.canvas}
    </div>
  `;
}

/** Create-once canvas + painter for one envelope lane. The drawing itself stays
 *  imperative; only the scaffolding around it is templated. */
function buildLaneCanvas(deps: ClipAutoDeps, clip: SessionClip, env: ClipEnvelope): { canvas: HTMLCanvasElement; draw: () => void } {
  const painterDeps: PainterDeps = {
    seq: deps.seq,
    getAutoAbsSubIdx: deps.getAutoAbsSubIdx,
  };

  const canvas = renderElement<HTMLCanvasElement>(html`<canvas class="auto-lane-canvas"></canvas>`);
  canvas.width = Math.max(800, clip.lengthBars * 240);
  canvas.height = 80;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = '80px';

  // Stable painter-lane object — mutations to its .values + .stepped
  // are reflected via the same array reference held by env.values.
  const painterLane = asPainterLane(env, clip.lengthBars);

  const draw = () => {
    painterLane.enabled = env.enabled !== false;
    painterLane.stepped = !!env.stepped;
    drawLane(canvas, painterLane, painterDeps);
  };
  draw();

  attachLanePainter(canvas, painterLane, draw, getBrush);
  return { canvas, draw };
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
