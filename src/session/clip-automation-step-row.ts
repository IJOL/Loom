// The step half of the painter's foldable row.
//
// It lives next door rather than inside clip-automation-lanes.ts, which already
// carries the panel, the lane template, the region, the LFO row and the brush
// bar. The sixth job gets written beside the fifth — the same lesson the
// inserts round left behind.
//
// The row PAINTS AS YOU GO, like the LFO row's sliders: every bar you drag,
// every shortcut, every count change lands in the lane at once. It used to
// wait for Apply, which left the previous curve (usually the LFO's wave) in
// the lane — drawn and sounding — under a grid of bars that meant nothing yet.
// Apply survives as an explicit re-write, for a lane someone painted over by
// hand.

import { html, type TemplateResult } from 'lit-html';
import type { PanelHandle } from '../core/lit-panel';
import { createStepsControl } from '../core/controls/steps-control';
import { fillSteps, stepPreset, type StepMode } from '../automation/automation-steps';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { stepsPerBeat } from '../core/meter';
import { withUndo } from '../save/history-wiring';
import { paintRegion } from './clip-auto-region';
import type { AutoStrip } from './clip-auto-strip';
import type { ClipAutoDeps } from './clip-automation-lanes';
import type { SessionClip, ClipEnvelope } from './session';

type Panel = PanelHandle<ClipAutoDeps>;

const MAX_STEPS = 64;

// Shared across lanes, exactly like lfoState: you set a shape up once and paint
// it lane by lane. Not persisted — same call as the LFO's.
const stepState = {
  count: 16,
  mode: 'hold' as StepMode,
  loopOnly: true,
  values: Array.from({ length: 16 }, () => 0.5),
  /** The region length (in sub-samples) a hand-typed count was typed FOR, or
   *  null when the count follows the lane's grid. A count belongs to the
   *  region it was typed against: open a clip of another length and the grid
   *  goes back to one bar per 16th rather than carrying a stale number over. */
  countFor: null as number | null,
};

/** One step per 16th of the region — the lane's own grid, so a bar of the row
 *  is a cell of the lane. A region too long for that falls back to one per
 *  beat, then to the cap: sixty-four columns is already the most the strip
 *  can show as grabbable bars. */
function gridCount(regionSubs: number, meter: ClipAutoDeps['meter']): number {
  const sixteenths = Math.round(regionSubs / AUTOMATION_SUB_RES);
  if (sixteenths <= MAX_STEPS) return Math.max(1, sixteenths);
  const beats = Math.round(sixteenths / stepsPerBeat(meter));
  return Math.max(1, Math.min(MAX_STEPS, beats));
}

/** Resize the row, keeping what was already drawn. New steps start at the
 *  midpoint rather than at zero: a row that silently grows a tail of silence
 *  reads as the curve having been damaged. */
function resize(count: number): void {
  const n = Math.max(1, Math.min(MAX_STEPS, Math.round(count)));
  stepState.count = n;
  stepState.values = Array.from({ length: n }, (_, i) => stepState.values[i] ?? 0.5);
}

/** The stretch this row writes into, with the step count brought in line with
 *  it first (unless a count was typed for exactly this region). */
function region(h: Panel, clip: SessionClip, env: ClipEnvelope): { from: number; to: number } {
  const r = paintRegion(clip, h.deps.meter, env, stepState.loopOnly);
  const subs = r.to - r.from;
  if (stepState.countFor !== subs) {
    stepState.countFor = null;
    const auto = gridCount(subs, h.deps.meter);
    if (auto !== stepState.count) resize(auto);
  }
  return r;
}

/** Write the row's steps into the lane. Exported for the mode picker: choosing
 *  Steps paints them at once, so the lane never shows one mode's curve under
 *  the other mode's controls. */
export function paintStepsInto(h: Panel, clip: SessionClip, env: ClipEnvelope, strip: AutoStrip): void {
  const { from, to } = region(h, clip, env);
  const curve = fillSteps(stepState.values, stepState.mode, to - from);
  for (let i = 0; i < curve.length; i++) env.values[from + i] = curve[i];
  strip.draw();
}

export function stepRowTemplate(
  h: Panel, clip: SessionClip, env: ClipEnvelope, strip: AutoStrip,
): TemplateResult {
  // Bring the count in line with THIS lane before the grid is built off it.
  region(h, clip, env);

  const paint = () => paintStepsInto(h, clip, env, strip);
  const repaint = () => {
    if (h.deps.historyDeps) withUndo(h.deps.historyDeps, paint); else paint();
    h.rerender();
  };

  // Built fresh on each render, like the rest of this panel: the control owns
  // its own DOM and pointer capture, so lit-html receives it as a node.
  const grid = createStepsControl({
    values: stepState.values,
    label: 'Automation steps',
    // Live: the bar you are dragging is already in the lane. No re-render —
    // the control owns the drag, and remounting it mid-gesture would drop it.
    onChange: (i, v) => { stepState.values[i] = v; paint(); },
  });
  // Same bracket the knobs and the LFO sliders use: a whole drag across the
  // grid coalesces into one undo step.
  grid.el.addEventListener('pointerdown', () => h.deps.historyDeps?.beginGesture?.());
  grid.el.addEventListener('pointerup', () => h.deps.historyDeps?.endGesture?.());
  grid.el.addEventListener('pointercancel', () => h.deps.historyDeps?.endGesture?.());

  const preset = (kind: 'up' | 'down' | 'invert' | 'random') => () => {
    stepState.values = stepPreset(kind, stepState.count, stepState.values, Math.random);
    repaint();
  };

  return html`
    <div class="clip-auto-steps">
      <span class="clip-auto-steps-label">Steps</span>
      <input class="clip-auto-steps-count" type="number" min="1" max=${MAX_STEPS}
             .value=${String(stepState.count)} aria-label="Number of steps"
             title="Steps across the region. Follows the lane's grid (one per 16th) until you type one"
             @change=${(e: Event) => {
               const { from, to } = paintRegion(clip, h.deps.meter, env, stepState.loopOnly);
               resize(Number((e.currentTarget as HTMLInputElement).value));
               stepState.countFor = to - from;
               repaint();
             }}>
      <select class="clip-auto-steps-mode" aria-label="Step mode"
              @change=${(e: Event) => {
                stepState.mode = (e.currentTarget as HTMLSelectElement).value as StepMode;
                repaint();
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
        @click=${() => { stepState.loopOnly = !stepState.loopOnly; repaint(); }}
      >LOOP</button>
      <button class="rnd clip-auto-steps-apply" title="Write these steps into the lane again"
              @click=${repaint}>Apply</button>
      ${grid.el}
    </div>
  `;
}
