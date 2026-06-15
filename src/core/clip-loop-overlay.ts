// src/core/clip-loop-overlay.ts
// Performance-style loop region: a translucent amber COLUMN with vertical A/B
// edge lines spanning the full height of the editor it overlays (same look as the
// arrangement's `.perf-loop-span`), plus a toolbar with a Loop toggle and a
// VARIABLE quantize selector (libre / beat / compás). Used by the audio, piano-
// roll and drum editors so the loop reads the same everywhere.
//
// Coordinate space: the column maps the clip's [0, total) ticks across the
// overlay host's OWN width (zoom-independent, like the old strip brace) — it marks
// musical bars, and lines up with editor content that spans the full width.
import type { SessionClip } from '../session/session';
import { ticksPerBar, type TimeSignature } from './meter';
import { TICKS_PER_QUARTER } from './notes';
import { effectiveClipLoop } from './clip-loop';
import { pxToTick, tickToPx, snapTick, clampLoopRegion } from './clip-loop-brace';
import type { HistoryDeps } from '../save/history-wiring';

export type LoopQuantize = 'free' | 'beat' | 'bar';

export interface ClipLoopOverlayDeps {
  /** Where the Loop toggle + quantize select (+ optional "all channels") mount. */
  toolbarHost: HTMLElement;
  /** Element the column overlays; made `position:relative` if it is static. */
  overlayHost: HTMLElement;
  clip: SessionClip;
  meter: TimeSignature;
  historyDeps?: HistoryDeps;
  /** Called after a committed edit (e.g. invalidate the warp cache + persist). */
  onChange?: () => void;
  /** When present, shows an "all channels" button that hands the current loop
   *  region to the caller (already wrapped in an undo gesture + onChange). */
  applyToAll?: (loopEnabled: boolean, startTick: number, endTick: number) => void;
  /** Left inset (px) of the bar grid INSIDE the editor's widest canvas. The
   *  drum-grid draws its row labels in a fixed gutter on the same canvas, so bar 0
   *  sits `LABEL_W` px in — without this the column would start over the labels.
   *  The piano-roll/waveform have no internal gutter (default 0). */
  gridInsetLeft?: number;
}

const QUANT_LABELS: ReadonlyArray<readonly [LoopQuantize, string]> = [
  ['bar', 'compás'], ['beat', 'beat'], ['free', 'libre'],
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
  qsel.title = 'Cuantización del loop';
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
    all.textContent = 'Todos los canales';
    all.title = 'Aplicar este loop a todos los canales de audio del tema';
    all.addEventListener('click', () => {
      const { startTick, endTick } = effectiveClipLoop(clip, meter);
      historyDeps?.history.beginGesture(historyDeps.snapshot());
      deps.applyToAll!(!!clip.loopEnabled, startTick, endTick);
      historyDeps?.history.commitGesture();
      deps.onChange?.();
    });
    bar.append(all);
  }
  deps.toolbarHost.appendChild(bar);

  // ── column overlay ──
  const host = deps.overlayHost;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const col = document.createElement('div');
  col.className = 'clip-loop-col';
  const hL = document.createElement('span'); hL.className = 'clip-loop-edge l';
  const hR = document.createElement('span'); hR.className = 'clip-loop-edge r';
  col.append(hL, hR);
  host.appendChild(col);

  // The bar grid does NOT always fill the host: a piano-roll/drum editor has a
  // left label gutter, so bar 0 starts inside the host, not at its left edge.
  // Anchor the column to the widest <canvas> in the host (the note/drum grid or
  // the waveform) — for the gutter-less waveform that's the full width, so audio
  // is unchanged; for the piano-roll it lines the column up with the bar numbers.
  const contentBox = (): { leftRel: number; absLeft: number; width: number; topRel: number; height: number } => {
    const hr = host.getBoundingClientRect();
    // Horizontal: the widest <canvas> = the bar-grid area (skips the narrow key
    // gutter). Vertical: the UNION of all canvases (ruler → grid → velocity) — this
    // excludes the editor's own toolbar (DRAW/SELECT, octave, grid are divs, not
    // canvases), so the column sits over the bar-number row + grid, not above it.
    let widest: DOMRect | null = null;
    let top = Infinity, bottom = -Infinity;
    for (const c of Array.from(host.querySelectorAll('canvas'))) {
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (!widest || r.width > widest.width) widest = r;
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
    const wx = widest ?? hr;
    if (!Number.isFinite(top)) { top = hr.top; bottom = hr.bottom; }
    // gridInsetLeft skips a gutter drawn INSIDE the canvas (the drum-grid's row
    // labels live on the same canvas, so bar 0 is LABEL_W px in).
    const inset = deps.gridInsetLeft ?? 0;
    const absLeft = wx.left + inset;
    return {
      leftRel: absLeft - hr.left, absLeft, width: Math.max(1, (wx.width || 1) - inset),
      topRel: top - hr.top, height: Math.max(1, bottom - top),
    };
  };

  const layout = () => {
    const { startTick, endTick } = effectiveClipLoop(clip, meter);
    const cb = contentBox();
    col.style.left = `${cb.leftRel + tickToPx(startTick, cb.width, total)}px`;
    col.style.width = `${tickToPx(endTick - startTick, cb.width, total)}px`;
    col.style.top = `${cb.topRel}px`;
    col.style.height = `${cb.height}px`;
    col.style.display = clip.loopEnabled ? '' : 'none';
    toggle.classList.toggle('on', !!clip.loopEnabled);
  };

  toggle.addEventListener('click', () => {
    historyDeps?.history.beginGesture(historyDeps.snapshot());
    clip.loopEnabled = !clip.loopEnabled;
    if (clip.loopEnabled && clip.loopEndTick == null) { clip.loopStartTick = 0; clip.loopEndTick = total; }
    historyDeps?.history.commitGesture();
    layout(); deps.onChange?.();
  });
  qsel.addEventListener('change', () => { quantize = (qsel.value as LoopQuantize) || 'bar'; });

  const startDrag = (which: 'l' | 'r') => (down: PointerEvent) => {
    down.preventDefault(); down.stopPropagation();
    if (!clip.loopEnabled) return;
    historyDeps?.history.beginGesture(historyDeps.snapshot());
    const move = (e: PointerEvent) => {
      const cb = contentBox();
      const step = snapFor();
      const tick = snapTick(pxToTick(e.clientX - cb.absLeft, cb.width, total), step);
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
      historyDeps?.history.commitGesture();
      deps.onChange?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  hL.addEventListener('pointerdown', startDrag('l'));
  hR.addEventListener('pointerdown', startDrag('r'));

  // Defer first layout until the host has a measured width.
  requestAnimationFrame(layout);
  // Re-layout when the editor canvas sizes/resizes after mount (the bar grid lives
  // inside it; a one-shot layout could measure it before it has its final size and
  // leave the column misplaced). Cheap — just reads rects and sets styles.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => layout()).observe(host);
  }
  return { redraw: layout };
}
