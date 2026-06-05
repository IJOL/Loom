// Pure resolver for a clip's loop sub-region. Single source of truth for the
// scheduler, the sampler buffer trim and the editor brace. Returns absolute
// tick bounds on the clip's own TICKS_PER_QUARTER grid; loop off / invalid /
// out-of-range all collapse to the whole clip [0, total).
import type { SessionClip } from '../session/session';
import { ticksPerBar, type TimeSignature } from './meter';

export function effectiveClipLoop(
  clip: SessionClip, meter: TimeSignature,
): { startTick: number; endTick: number } {
  const total = clip.lengthBars * ticksPerBar(meter);
  if (!clip.loopEnabled) return { startTick: 0, endTick: total };
  const start = Math.max(0, Math.min(clip.loopStartTick ?? 0, total));
  const end = Math.max(0, Math.min(clip.loopEndTick ?? total, total));
  if (end <= start) return { startTick: 0, endTick: total };
  return { startTick: start, endTick: end };
}
