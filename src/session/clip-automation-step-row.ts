// The step half of the painter's foldable row.
//
// It lives next door rather than inside clip-automation-lanes.ts, which already
// carries the panel, the lane template, the region, the LFO row and the brush
// bar. The sixth job gets written beside the fifth — the same lesson the
// inserts round left behind.

import { html, type TemplateResult } from 'lit-html';
import type { PanelHandle } from '../core/lit-panel';
import { createStepsControl } from '../core/controls/steps-control';
import { fillSteps, stepPreset, type StepMode } from '../automation/automation-steps';
import { paintRegion } from './clip-auto-region';
import type { AutoStrip } from './clip-auto-strip';
import type { ClipAutoDeps } from './clip-automation-lanes';
import type { SessionClip, ClipEnvelope } from './session';

type Panel = PanelHandle<ClipAutoDeps>;

const DEFAULT_STEPS = 16;
const MAX_STEPS = 64;

// Shared across lanes, exactly like lfoState: you set a shape up once and paint
// it lane by lane. Not persisted — same call as the LFO's.
const stepState = {
  count: DEFAULT_STEPS,
  mode: 'hold' as StepMode,
  loopOnly: true,
  values: Array.from({ length: DEFAULT_STEPS }, () => 0.5),
};

function applyToEnvelope(
  h: Panel, clip: SessionClip, env: ClipEnvelope, strip: AutoStrip,
): void {
  const { from, to } = paintRegion(clip, h.deps.meter, env, stepState.loopOnly);
  const curve = fillSteps(stepState.values, stepState.mode, to - from);
  for (let i = 0; i < curve.length; i++) env.values[from + i] = curve[i];
  strip.draw();
}

/** Resize the row, keeping what was already drawn. New steps start at the
 *  midpoint rather than at zero: a row that silently grows a tail of silence
 *  reads as the curve having been damaged. */
function resize(count: number): void {
  const n = Math.max(1, Math.min(MAX_STEPS, Math.round(count)));
  stepState.count = n;
  stepState.values = Array.from({ length: n }, (_, i) => stepState.values[i] ?? 0.5);
}

export function stepRowTemplate(
  h: Panel, clip: SessionClip, env: ClipEnvelope, strip: AutoStrip,
): TemplateResult {
  // Built fresh on each render, like the rest of this panel: the control owns
  // its own DOM and pointer capture, so lit-html receives it as a node.
  const grid = createStepsControl({
    values: stepState.values,
    label: 'Automation steps',
    onChange: (i, v) => { stepState.values[i] = v; },
  });

  const preset = (kind: 'up' | 'down' | 'invert' | 'random') => () => {
    stepState.values = stepPreset(kind, stepState.count, stepState.values, Math.random);
    h.rerender();
  };

  return html`
    <div class="clip-auto-steps">
      <span class="clip-auto-steps-label">Steps</span>
      <input class="clip-auto-steps-count" type="number" min="1" max=${MAX_STEPS}
             .value=${String(stepState.count)} aria-label="Number of steps"
             @change=${(e: Event) => {
               resize(Number((e.currentTarget as HTMLInputElement).value));
               h.rerender();
             }}>
      <select class="clip-auto-steps-mode" aria-label="Step mode"
              @change=${(e: Event) => {
                stepState.mode = (e.currentTarget as HTMLSelectElement).value as StepMode;
              }}>
        <option value="hold" ?selected=${stepState.mode === 'hold'}>Hold</option>
        <option value="ramp" ?selected=${stepState.mode === 'ramp'}>Ramp</option>
      </select>
      <button class="rnd" @click=${preset('up')}>Ramp ↗</button>
      <button class="rnd" @click=${preset('down')}>Ramp ↘</button>
      <button class="rnd" @click=${preset('invert')}>Invert</button>
      <button class="rnd" @click=${preset('random')}>Random</button>
      <button
        class=${stepState.loopOnly ? 'rnd clip-auto-steps-loop active' : 'rnd clip-auto-steps-loop'}
        title="Paint into the loop region only"
        @click=${() => { stepState.loopOnly = !stepState.loopOnly; h.rerender(); }}
      >LOOP</button>
      <button class="rnd clip-auto-steps-apply" title="Write these steps into the lane"
              @click=${() => { applyToEnvelope(h, clip, env, strip); h.rerender(); }}>Apply</button>
      ${grid.el}
    </div>
  `;
}
