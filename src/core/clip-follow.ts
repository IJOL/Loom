// Session-global "Follow playhead" mode shared by all three clip editors, plus
// the pure scroll-target math. Follow is a working mode (like the draw/select
// tool), not a per-clip property: one flag, ON by default, reset on reload.

let _followEnabled = true;

export function isFollowEnabled(): boolean { return _followEnabled; }
export function setFollowEnabled(on: boolean): void { _followEnabled = on; }
export function toggleFollow(): boolean { _followEnabled = !_followEnabled; return _followEnabled; }

/** New scrollLeft that centers `playheadX` (content-space px) in the viewport,
 *  clamped to the scrollable range. Returns null when the content fits (nothing
 *  to scroll) or the move is below `threshold` (avoids per-frame jitter). */
export function followScrollTarget(
  playheadX: number, viewportWidth: number, contentWidth: number,
  currentScroll: number, threshold = 2,
): number | null {
  const maxScroll = contentWidth - viewportWidth;
  if (maxScroll <= 0) return null;
  const target = Math.max(0, Math.min(maxScroll, playheadX - viewportWidth / 2));
  return Math.abs(currentScroll - target) > threshold ? target : null;
}
