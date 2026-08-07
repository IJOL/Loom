// Which stretch of an automation lane a painter writes into.
//
// It lives in its own module because BOTH painter modes need it — the LFO row
// and the step row — and importing it from either of them would put the two in
// a cycle. `loopOnly` is a parameter rather than read off a painter's state, so
// each mode keeps its own toggle and neither can silently move the other's
// region.

import { effectiveClipLoop } from '../core/clip-loop';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { TICKS_PER_STEP } from '../core/notes';
import type { TimeSignature } from '../core/meter';
import type { SessionClip, ClipEnvelope } from './session';

/** The loop region when the clip loops and `loopOnly` is on, else the whole
 *  lane. Clamped to the array, so a cycle count is measured against the
 *  sub-steps that really get written. */
export function paintRegion(
  clip: SessionClip, meter: TimeSignature, env: ClipEnvelope, loopOnly: boolean,
): { from: number; to: number } {
  const len = env.values.length;
  if (!(loopOnly && clip.loopEnabled)) return { from: 0, to: len };

  const { startTick, endTick } = effectiveClipLoop(clip, meter);
  const from = Math.max(0, Math.min(len, Math.round((startTick / TICKS_PER_STEP) * AUTOMATION_SUB_RES)));
  const to = Math.max(from, Math.min(len, Math.round((endTick / TICKS_PER_STEP) * AUTOMATION_SUB_RES)));
  // A degenerate region would write nothing at all, which looks like a broken
  // button rather than an empty loop.
  return from < to ? { from, to } : { from: 0, to: len };
}
