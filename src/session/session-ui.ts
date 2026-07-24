// Session view grid rendering — a lit-html panel patched in place on every
// state change (mountPanel owns the host/adoption lifecycle). No audio here;
// interactivity is wired by the host (main.ts) via callbacks bound in the
// templates (session-grid-templates.ts).

import { html, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import type { SessionState, ClipSlot } from './session';
import type { LanePlayState } from './session-runtime';
import { mountPanel } from '../core/lit-panel';
import {
  laneHeaderTemplate, clipCellTemplate, sceneLaunchCellTemplate, scenesHeaderTemplate,
} from './session-grid-templates';
import type { SessionUICallbacks } from './session-ui-types';
export type { SessionUICallbacks } from './session-ui-types';
export { _resetSceneClickStateForTesting } from './session-grid-templates';

/** Options for the active-lane marking + collapse state the host passes in. */
export interface RenderGridOpts { activeEditLane?: string | null; synthCollapsed?: boolean }

const HOST_CLASS = 'session-grid-host';

export function renderSessionGrid(
  host: HTMLElement,
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
  openClip?: ClipSlot,
  opts: RenderGridOpts = {},
): void {
  host.classList.add('session-grid-root');
  // One-time adoption: clear pre-lit content (the index.html placeholder text)
  // before the first mount. A no-op on every later call — the panel host is in
  // place and mountPanel re-adopts it.
  if (!host.querySelector(`:scope > .${HOST_CLASS}`)) host.replaceChildren();
  const handle = mountPanel({
    container: host,
    className: HOST_CLASS,
    deps: cb,
    template: () => gridTemplate(state, laneStates, cb, openClip, opts),
  });
  // The mixer row is filled imperatively by SessionHost.renderWithMixer (VU
  // meters + strips keep their own lifecycle); the row carries no bindings, so
  // lit never touches its children across repaints.
  cb._mixerRow = handle.host.querySelector<HTMLElement>('.session-row-mixer') ?? undefined;
}

function gridTemplate(
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
  openClip: ClipSlot | undefined,
  opts: RenderGridOpts,
): TemplateResult {
  let rowCount = state.scenes.length;
  for (const lane of state.lanes) rowCount = Math.max(rowCount, lane.clips.length);
  rowCount = Math.max(1, rowCount);
  const rows = Array.from({ length: rowCount }, (_, r) => r);

  // The full row-grid column template. Stored as a complete value (not a bare
  // repeat() count) because CSS `repeat(0, 120px)` is INVALID and collapses the
  // whole template to one auto column — a deformed grid when the session has no
  // lanes. With zero lanes we emit just the label + scenes/master columns.
  const n = state.lanes.length;
  const cols = n > 0 ? `24px repeat(${n}, 120px) 140px` : '24px 140px';

  // Rows are keyed by scene identity (falling back to the row index for clip
  // rows beyond the last scene) and cells by lane id, so deleting a scene —
  // which COMPACTS lane.clips — keeps each surviving cell element paired with
  // the clip that moved with it.
  return html`
    <div class="session-table" style=${`--session-cols: ${cols}`}>
      <div class="session-row session-row-header">
        <div class="session-spacer"></div>
        ${repeat(state.lanes, (l) => l.id, (lane) =>
          laneHeaderTemplate(lane, cb, lane.id === opts.activeEditLane, !!opts.synthCollapsed))}
        ${scenesHeaderTemplate(cb)}
      </div>
      ${repeat(rows, (r) => state.scenes[r]?.id ?? `row-${r}`, (r) => html`
        <div class=${openClip && openClip.clipIdx === r ? 'session-row session-row-editing' : 'session-row'}>
          <div class="session-row-label">${r + 1}</div>
          ${repeat(state.lanes, (l) => l.id, (lane) =>
            clipCellTemplate(lane, r, laneStates, cb, state, openClip, lane.id === opts.activeEditLane))}
          ${sceneLaunchCellTemplate(state.scenes[r], r, cb)}
        </div>`)}
      <div class="session-row">
        <div class="session-spacer">+</div>
        ${state.lanes.map(() => html`<div class="session-spacer"></div>`)}
        <button class="session-add-scene" title="Add scene" @click=${cb.onAddScene}>+</button>
      </div>
      <div class="session-row session-row-stop">
        <div class="session-spacer"></div>
        ${repeat(state.lanes, (l) => l.id, (lane) => html`
          <button class="session-lane-stop" title=${`Stop ${lane.id}`} @click=${() => cb.onStopLane(lane.id)}>⏹</button>`)}
        <button class="session-stop-all" @click=${cb.onStopAll}>⏹ all</button>
      </div>
      <div class="session-row session-row-mixer"></div>
    </div>
  `;
}
