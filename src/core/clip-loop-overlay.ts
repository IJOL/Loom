// src/core/clip-loop-overlay.ts
// Performance-style loop region: a translucent amber COLUMN with vertical A/B
// edge lines spanning the full height of the editor it overlays (same look as the
// arrangement's `.perf-loop-span`), plus a toolbar with a Loop toggle and a
// VARIABLE quantize selector (free / beat / bar). Used by the audio, piano-
// roll and drum editors so the loop reads the same everywhere.
//
// Coordinate space: the column maps the clip's [0, total) ticks across the
// overlay host's OWN width (zoom-independent, like the old strip brace) — it marks
// musical bars, and lines up with editor content that spans the full width.
//
// DOM is built ONCE via detached lit renders (toolbar + column); layout() stays
// imperative because it repositions at scroll/zoom/drag rate through the
// caller's tickToX (pxPerTick), not on state changes.
import { html } from 'lit-html';
import type { SessionClip } from '../session/session';
import { ticksPerBar, type TimeSignature } from './meter';
import { TICKS_PER_QUARTER } from './notes';
import { effectiveClipLoop } from './clip-loop';
import { snapTick, clampLoopRegion, moveLoopRegion } from './clip-loop-brace';
import { renderElement } from './lit-fragment';
import type { HistoryDeps } from '../save/history-wiring';

export type LoopQuantize = 'free' | 'beat' | 'bar';

export interface ClipLoopOverlayDeps {
  /** Where the Loop toggle + quantize select (+ optional Global) mount. */
  toolbarHost: HTMLElement;
  /** Scrollable element the amber column is appended to. Its `overflow` clips the
   *  column and its scroll moves it. Made `position:relative` if static. */
  scrollHost: HTMLElement;
  clip: SessionClip;
  meter: TimeSignature;
  historyDeps?: HistoryDeps;
  onChange?: () => void;
  /** Content-space x (px) of a tick — i.e. `tick·pxPerTick` (+ any fixed gutter). */
  tickToX: (tick: number) => number;
  /** Inverse for the A/B drag: viewport client x → clip-axis tick in [0,total]. */
  tickFromClientX: (clientX: number) => number;
  /** Column height (the content/grid height) in px. */
  contentHeight: () => number;
  /** Column top within scrollHost; default 0. */
  contentTop?: () => number;
  /** Returns true when the scene is currently link-linked. */
  isLinked?: () => boolean;
  /** Called when the user clicks the Link toggle button. */
  onToggleLink?: (linked: boolean) => void;
  /** Called on drag-commit (pointerup) AND when the Loop toggle fires.
   *  Triggers propagation on the host when the scene is linked. */
  onClipLoopEdited?: () => void;
}

const QUANT_LABELS: ReadonlyArray<readonly [LoopQuantize, string]> = [
  ['bar', 'Bar'], ['beat', 'Beat'], ['free', 'Free'],
];

export function mountClipLoopOverlay(deps: ClipLoopOverlayDeps): { redraw: () => void } {
  const { clip, meter, historyDeps } = deps;
  const total = clip.lengthBars * ticksPerBar(meter);
  let quantize: LoopQuantize = 'bar';
  const snapFor = (): number =>
    quantize === 'free' ? 1 : quantize === 'beat' ? TICKS_PER_QUARTER : ticksPerBar(meter);

  const onToggle = () => {
    historyDeps?.beginGesture?.();
    clip.loopEnabled = !clip.loopEnabled;
    if (clip.loopEnabled && clip.loopEndTick == null) { clip.loopStartTick = 0; clip.loopEndTick = total; }
    historyDeps?.endGesture?.();
    layout();
    deps.onChange?.();
    // Notify host for propagation (always safe; host only propagates when linked).
    deps.onClipLoopEdited?.();
  };
  const onQuant = () => { quantize = (qsel.value as LoopQuantize) || 'bar'; };
  // Global button: lit amber when this scene's loop is shared across all its clips.
  const onLink = () => {
    const linked = deps.isLinked?.() ?? false;
    deps.onToggleLink!(!linked);
    linkBtn!.classList.toggle('on', !linked);
  };

  // ── toolbar ──
  const bar = renderElement(html`
    <div class="clip-loop-bar">
      <button class=${'clip-loop-toggle' + (clip.loopEnabled ? ' on' : '')} @click=${onToggle}>Loop</button>
      <select class="clip-loop-quant" title="Loop quantization" @change=${onQuant}>
        ${QUANT_LABELS.map(([v, label]) => html`<option value=${v} ?selected=${v === quantize}>${label}</option>`)}
      </select>
      ${deps.onToggleLink
        ? html`<button
            class=${'clip-loop-global' + (deps.isLinked?.() ? ' on' : '')}
            title="Share this loop across every clip in the scene"
            @click=${onLink}
          >Global</button>`
        : null}
    </div>
  `);
  const toggle = bar.querySelector('.clip-loop-toggle') as HTMLButtonElement;
  const qsel = bar.querySelector('.clip-loop-quant') as HTMLSelectElement;
  const linkBtn = bar.querySelector('.clip-loop-global') as HTMLButtonElement | null;
  deps.toolbarHost.appendChild(bar);

  const startDrag = (which: 'l' | 'r') => (down: PointerEvent) => {
    down.preventDefault(); down.stopPropagation();
    if (!clip.loopEnabled) return;
    historyDeps?.beginGesture?.();
    const move = (e: PointerEvent) => {
      const step = snapFor();
      const tick = snapTick(deps.tickFromClientX(e.clientX), step);
      const cur = effectiveClipLoop(clip, meter);
      const next = which === 'l'
        ? clampLoopRegion(tick, cur.endTick, total, step)
        : clampLoopRegion(cur.startTick, tick, total, step);
      // Always write the LOCAL clip loop (no global-loop branch).
      clip.loopStartTick = next.start; clip.loopEndTick = next.end;
      layout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      historyDeps?.endGesture?.();
      deps.onChange?.();
      // Notify host for propagation (always safe; host only propagates when linked).
      deps.onClipLoopEdited?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Drag the interior to SLIDE the whole region (length preserved). Derive the
  // current px-per-tick from tickToX so it tracks zoom; a pure screen-x delta
  // maps 1:1 to content px (scroll changes offset, not scale).
  const onMidDown = (down: PointerEvent) => {
    down.preventDefault(); down.stopPropagation();
    if (!clip.loopEnabled) return;
    const cur = effectiveClipLoop(clip, meter);
    const origStart = cur.startTick, origEnd = cur.endTick;
    const downX = down.clientX;
    const pxPerTick = deps.tickToX(1) - deps.tickToX(0);
    historyDeps?.beginGesture?.();
    const move = (e: PointerEvent) => {
      const deltaTicks = pxPerTick > 0 ? (e.clientX - downX) / pxPerTick : 0;
      const next = moveLoopRegion(origStart, origEnd, deltaTicks, total, snapFor());
      // Always write the LOCAL clip loop.
      clip.loopStartTick = next.start; clip.loopEndTick = next.end;
      layout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      historyDeps?.endGesture?.();
      deps.onChange?.();
      // Notify host for propagation (always safe; host only propagates when linked).
      deps.onClipLoopEdited?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── column overlay (mounted INSIDE the editor's scrollable content) ──
  const host = deps.scrollHost;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  // Interior move zone (between the edge handles): drag it to slide the whole
  // loop region along the timeline, length preserved. Sits below the edges so
  // resizing still wins at the very borders.
  const col = renderElement(html`
    <div class="clip-loop-col">
      <span class="clip-loop-move" @pointerdown=${onMidDown}></span>
      <span class="clip-loop-edge l" @pointerdown=${startDrag('l')}></span>
      <span class="clip-loop-edge r" @pointerdown=${startDrag('r')}></span>
    </div>
  `);
  host.appendChild(col);

  const layout = () => {
    // Always draw the LOCAL loop region (no global-loop branch).
    const { startTick, endTick } = effectiveClipLoop(clip, meter);
    const show = !!clip.loopEnabled;
    const x0 = deps.tickToX(startTick);
    const x1 = deps.tickToX(endTick);
    col.style.left = `${x0}px`;
    col.style.width = `${Math.max(0, x1 - x0)}px`;
    col.style.top = `${deps.contentTop?.() ?? 0}px`;
    col.style.height = `${deps.contentHeight()}px`;
    col.style.display = show ? '' : 'none';
    toggle.classList.toggle('on', !!clip.loopEnabled);
    // Keep the Link button in sync with external state changes (e.g. undo).
    linkBtn?.classList.toggle('on', deps.isLinked?.() ?? false);
  };

  requestAnimationFrame(layout);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => layout()).observe(host);
  }
  return { redraw: layout };
}
