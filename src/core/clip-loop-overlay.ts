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
import type { SessionClip } from '../session/session';
import { ticksPerBar, type TimeSignature } from './meter';
import { TICKS_PER_QUARTER } from './notes';
import { effectiveClipLoop } from './clip-loop';
import { snapTick, clampLoopRegion, moveLoopRegion } from './clip-loop-brace';
import type { HistoryDeps } from '../save/history-wiring';

export type LoopQuantize = 'free' | 'beat' | 'bar';

export interface ClipLoopOverlayDeps {
  /** Where the Loop toggle + quantize select (+ optional "All channels") mount. */
  toolbarHost: HTMLElement;
  /** Scrollable element the amber column is appended to. Its `overflow` clips the
   *  column and its scroll moves it. Made `position:relative` if static. */
  scrollHost: HTMLElement;
  clip: SessionClip;
  meter: TimeSignature;
  historyDeps?: HistoryDeps;
  onChange?: () => void;
  applyToAll?: (loopEnabled: boolean, startTick: number, endTick: number) => void;
  /** Content-space x (px) of a tick — i.e. `tick·pxPerTick` (+ any fixed gutter). */
  tickToX: (tick: number) => number;
  /** Inverse for the A/B drag: viewport client x → clip-axis tick in [0,total]. */
  tickFromClientX: (clientX: number) => number;
  /** Column height (the content/grid height) in px. */
  contentHeight: () => number;
  /** Column top within scrollHost; default 0. */
  contentTop?: () => number;
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

  // ── toolbar ──
  const bar = document.createElement('div');
  bar.className = 'clip-loop-bar';
  const toggle = document.createElement('button');
  toggle.className = 'clip-loop-toggle' + (clip.loopEnabled ? ' on' : '');
  toggle.textContent = 'Loop';
  const qsel = document.createElement('select');
  qsel.className = 'clip-loop-quant';
  qsel.title = 'Loop quantization';
  for (const [v, label] of QUANT_LABELS) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    if (v === quantize) o.selected = true;
    qsel.appendChild(o);
  }
  bar.append(toggle, qsel);
  if (deps.applyToAll) {
    const all = document.createElement('button');
    all.className = 'clip-loop-all';
    all.textContent = 'All channels';
    all.title = 'Apply this loop region to every audio channel of the song';
    all.addEventListener('click', () => {
      const { startTick, endTick } = effectiveClipLoop(clip, meter);
      historyDeps?.beginGesture?.();
      deps.applyToAll!(!!clip.loopEnabled, startTick, endTick);
      historyDeps?.endGesture?.();
      deps.onChange?.();
    });
    bar.append(all);
  }
  deps.toolbarHost.appendChild(bar);

  // ── column overlay (mounted INSIDE the editor's scrollable content) ──
  const host = deps.scrollHost;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const col = document.createElement('div');
  col.className = 'clip-loop-col';
  // Interior move zone (between the edge handles): drag it to slide the whole
  // loop region along the timeline, length preserved. Sits below the edges so
  // resizing still wins at the very borders.
  const mid = document.createElement('span'); mid.className = 'clip-loop-move';
  const hL = document.createElement('span'); hL.className = 'clip-loop-edge l';
  const hR = document.createElement('span'); hR.className = 'clip-loop-edge r';
  col.append(mid, hL, hR);
  host.appendChild(col);

  const layout = () => {
    const { startTick, endTick } = effectiveClipLoop(clip, meter);
    const x0 = deps.tickToX(startTick);
    const x1 = deps.tickToX(endTick);
    col.style.left = `${x0}px`;
    col.style.width = `${Math.max(0, x1 - x0)}px`;
    col.style.top = `${deps.contentTop?.() ?? 0}px`;
    col.style.height = `${deps.contentHeight()}px`;
    col.style.display = clip.loopEnabled ? '' : 'none';
    toggle.classList.toggle('on', !!clip.loopEnabled);
  };

  toggle.addEventListener('click', () => {
    historyDeps?.beginGesture?.();
    clip.loopEnabled = !clip.loopEnabled;
    if (clip.loopEnabled && clip.loopEndTick == null) { clip.loopStartTick = 0; clip.loopEndTick = total; }
    historyDeps?.endGesture?.();
    layout(); deps.onChange?.();
  });
  qsel.addEventListener('change', () => { quantize = (qsel.value as LoopQuantize) || 'bar'; });

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
      clip.loopStartTick = next.start; clip.loopEndTick = next.end;
      layout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      historyDeps?.endGesture?.();
      deps.onChange?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  hL.addEventListener('pointerdown', startDrag('l'));
  hR.addEventListener('pointerdown', startDrag('r'));

  // Drag the interior to SLIDE the whole region (length preserved). Derive the
  // current px-per-tick from tickToX so it tracks zoom; a pure screen-x delta
  // maps 1:1 to content px (scroll changes offset, not scale).
  mid.addEventListener('pointerdown', (down: PointerEvent) => {
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
      clip.loopStartTick = next.start; clip.loopEndTick = next.end;
      layout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      historyDeps?.endGesture?.();
      deps.onChange?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  requestAnimationFrame(layout);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => layout()).observe(host);
  }
  return { redraw: layout };
}
