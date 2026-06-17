// Clip loop brace: pure px↔tick math + a DOM strip mounted above a clip editor.
// The strip maps its OWN full width to [0, total) ticks (independent of the
// canvas zoom) — it marks bars, not pixels. Drag the handles to set the clip's
// loop sub-region; the toggle enables/disables it.
import type { SessionClip } from '../session/session';
import { ticksPerBar, type TimeSignature } from './meter';
import { TICKS_PER_STEP } from './notes';
import { effectiveClipLoop } from './clip-loop';
import type { HistoryDeps } from '../save/history-wiring';

export function pxToTick(px: number, widthPx: number, total: number): number {
  if (widthPx <= 0) return 0;
  const t = (px / widthPx) * total;
  return Math.max(0, Math.min(total, t));
}
export function tickToPx(tick: number, widthPx: number, total: number): number {
  if (total <= 0) return 0;
  return (tick / total) * widthPx;
}
export function snapTick(tick: number, step: number): number {
  return Math.round(tick / step) * step;
}
export function clampLoopRegion(
  start: number, end: number, total: number, step: number,
): { start: number; end: number } {
  let a = Math.max(0, Math.min(total, Math.min(start, end)));
  let b = Math.max(0, Math.min(total, Math.max(start, end)));
  if (b - a < step) b = Math.min(total, a + step);
  if (b - a < step) a = Math.max(0, b - step);
  return { start: a, end: b };
}

/** Mount a loop-brace strip as the first child of `host` (above the editor).
 *  Mutates the clip's loop fields through historyDeps gestures so it is undoable. */
export function mountClipLoopBrace(
  host: HTMLElement,
  clip: SessionClip,
  meter: TimeSignature,
  historyDeps: HistoryDeps | undefined,
  onChange: () => void,
): void {
  const total = clip.lengthBars * ticksPerBar(meter);
  const stepTicks = TICKS_PER_STEP; // 1/16 snap

  const strip = document.createElement('div');
  strip.className = 'clip-loop-brace';
  const toggle = document.createElement('button');
  toggle.className = 'clip-loop-toggle' + (clip.loopEnabled ? ' on' : '');
  toggle.textContent = 'Loop';
  const track = document.createElement('div');
  track.className = 'clip-loop-track';
  const region = document.createElement('div');
  region.className = 'clip-loop-region';
  const hL = document.createElement('span'); hL.className = 'clip-loop-handle l';
  const hR = document.createElement('span'); hR.className = 'clip-loop-handle r';
  region.append(hL, hR);
  track.appendChild(region);
  strip.append(toggle, track);
  host.insertBefore(strip, host.firstChild);

  const layout = () => {
    const { startTick, endTick } = effectiveClipLoop(clip, meter);
    const w = track.clientWidth || 1;
    region.style.left = `${tickToPx(startTick, w, total)}px`;
    region.style.width = `${tickToPx(endTick - startTick, w, total)}px`;
    region.style.display = clip.loopEnabled ? '' : 'none';
    toggle.classList.toggle('on', !!clip.loopEnabled);
  };

  toggle.addEventListener('click', () => {
    historyDeps?.beginGesture?.();
    clip.loopEnabled = !clip.loopEnabled;
    if (clip.loopEnabled && clip.loopEndTick == null) { clip.loopStartTick = 0; clip.loopEndTick = total; }
    historyDeps?.endGesture?.();
    layout(); onChange();
  });

  const startDrag = (which: 'l' | 'r') => (down: PointerEvent) => {
    down.preventDefault();
    if (!clip.loopEnabled) return;
    historyDeps?.beginGesture?.();
    const move = (e: PointerEvent) => {
      const rect = track.getBoundingClientRect();
      const tick = snapTick(pxToTick(e.clientX - rect.left, rect.width, total), stepTicks);
      const cur = effectiveClipLoop(clip, meter);
      const next = which === 'l'
        ? clampLoopRegion(tick, cur.endTick, total, stepTicks)
        : clampLoopRegion(cur.startTick, tick, total, stepTicks);
      clip.loopStartTick = next.start; clip.loopEndTick = next.end;
      layout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      historyDeps?.endGesture?.(); onChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  hL.addEventListener('pointerdown', startDrag('l'));
  hR.addEventListener('pointerdown', startDrag('r'));

  // Defer first layout to after the host has width.
  requestAnimationFrame(layout);
}
