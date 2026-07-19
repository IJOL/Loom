// Per-clip automation lane renderer for the Session inspector.
// Mirrors src/automation/automation-ui.ts but targets clip.envelopes
// instead of seq.pattern.automation, and uses clip.lengthBars instead of
// seq.length / 16.

import type { SessionClip, ClipEnvelope } from './session';
import { groupTargetsByLane, type AutomationTarget } from '../automation/automation-targets';
import type { DestinationRegistry } from '../automation/destination-registry';
import type { Sequencer } from '../core/sequencer';
import { AUTOMATION_SUB_RES } from '../core/pattern';
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
  host.innerHTML = '';
  host.classList.add('clip-auto-lanes');

  const painterDeps: PainterDeps = {
    seq: deps.seq,
    getAutoAbsSubIdx: deps.getAutoAbsSubIdx,
  };

  // Header row: param picker + add button + brush selector.
  const header = document.createElement('div');
  header.className = 'clip-auto-header';
  const targets = deps.destinations.list();
  const byId = new Map(targets.map((t) => [t.id, t]));
  const sel = buildParamSelect(targets);
  const addBtn = document.createElement('button');
  addBtn.className = 'rnd primary';
  addBtn.textContent = '+ Automation';
  addBtn.addEventListener('click', () => {
    const paramId = sel.value;
    if (!paramId) return;
    if (!clip.envelopes) clip.envelopes = [];
    if (clip.envelopes.some((e) => e.paramId === paramId)) return; // already exists
    const stepCount = clip.lengthBars * 16 * AUTOMATION_SUB_RES;
    clip.envelopes.push({
      paramId,
      enabled: true,
      stepped: false,
      values: Array.from({ length: stepCount }, () => 0.5),
    });
    renderClipAutomationLanes(host, clip, deps);
  });
  header.appendChild(sel);
  header.appendChild(addBtn);
  header.appendChild(buildBrushBar());
  host.appendChild(header);

  // No envelopes yet → just show the header.
  if (!clip.envelopes || clip.envelopes.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'clip-auto-hint';
    hint.textContent = 'Pick a parameter above and click "+ Automation" to add a lane.';
    host.appendChild(hint);
    return;
  }

  clip.envelopes.forEach((env, idx) => {
    // An envelope whose param the session no longer declares (engine swapped,
    // insert removed) is still SHOWN — flagged, not silently swallowed, so the
    // user can see it and delete it rather than wonder where it went.
    const target = byId.get(env.paramId);

    // Default fields if missing on legacy clips.
    if (env.stepped === undefined) env.stepped = false;
    if (env.enabled === undefined) env.enabled = true;

    // Bring values to the size expected for clip.lengthBars * 16 steps.
    // ensureLaneSize expects seqLength in 16th-note steps.
    ensureLaneSize(
      { values: env.values, lengthBars: clip.lengthBars, stepped: env.stepped },
      clip.lengthBars * 16,
    );
    // Reflect any reassignment of values back onto the envelope (ensureLaneSize
    // may replace the array via the local object; but it actually mutates in
    // place AND may swap .values on the input object — copy back to be safe).
    // In practice ensureLaneSize only mutates .values via push / length = N,
    // which keeps the same array reference, so env.values stays in sync.

    const wrap = document.createElement('div');
    wrap.className = 'auto-lane clip-auto-lane' + (target ? '' : ' missing');

    const hdr = document.createElement('div');
    hdr.className = 'auto-lane-header';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = target
      ? `${target.laneName} · ${target.label}`
      : `${env.paramId} (unavailable)`;
    const enableBtn = document.createElement('button');
    enableBtn.className = 'enable' + (env.enabled ? ' active' : '');
    enableBtn.textContent = env.enabled ? 'On' : 'Off';
    enableBtn.addEventListener('click', () => {
      env.enabled = !env.enabled;
      enableBtn.classList.toggle('active', !!env.enabled);
      enableBtn.textContent = env.enabled ? 'On' : 'Off';
      draw();
    });
    const stepBtn = document.createElement('button');
    stepBtn.className = 'stepped' + (env.stepped ? ' active' : '');
    stepBtn.textContent = env.stepped ? 'Stepped' : 'Smooth';
    stepBtn.addEventListener('click', () => {
      env.stepped = !env.stepped;
      stepBtn.classList.toggle('active', !!env.stepped);
      stepBtn.textContent = env.stepped ? 'Stepped' : 'Smooth';
      draw();
    });
    const rangeEl = document.createElement('span');
    rangeEl.className = 'clip-auto-range';
    rangeEl.textContent = target ? `[${formatNum(target.min)} .. ${formatNum(target.max)}]` : '';
    const rmBtn = document.createElement('button');
    rmBtn.className = 'rnd';
    rmBtn.textContent = '×';
    rmBtn.title = 'Remove this lane';
    rmBtn.addEventListener('click', () => {
      clip.envelopes!.splice(idx, 1);
      renderClipAutomationLanes(host, clip, deps);
    });
    hdr.appendChild(label);
    hdr.appendChild(enableBtn);
    hdr.appendChild(stepBtn);
    hdr.appendChild(rangeEl);
    hdr.appendChild(rmBtn);
    wrap.appendChild(hdr);

    const canvas = document.createElement('canvas');
    canvas.className = 'auto-lane-canvas';
    canvas.width = Math.max(800, clip.lengthBars * 240);
    canvas.height = 80;
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = '80px';
    wrap.appendChild(canvas);

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

    host.appendChild(wrap);
  });
}

function buildParamSelect(targets: AutomationTarget[]): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'clip-auto-param-select';
  for (const [laneName, group] of groupTargetsByLane(targets)) {
    const og = document.createElement('optgroup');
    og.label = laneName;
    for (const t of group) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  return sel;
}

function buildBrushBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'clip-auto-brush-bar';
  const mk = (b: AutoBrush, label: string) => {
    const btn = document.createElement('button');
    btn.className = 'rnd' + (currentBrush === b ? ' primary' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      currentBrush = b;
      bar.querySelectorAll('button').forEach((x) => x.classList.remove('primary'));
      btn.classList.add('primary');
    });
    return btn;
  };
  bar.appendChild(mk('line', 'Line'));
  bar.appendChild(mk('flat', 'Flat'));
  return bar;
}
