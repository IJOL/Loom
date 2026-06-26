// Pure offset/gate math for re-triggering an audio clip mid-iteration after a
// global seek or loop boundary (Phase 3). Reuses clipLoopSourceRange so warp +
// trim mapping stays in one place. Returns null when no special re-trigger is
// needed (note clip, head-of-iteration, or degenerate duration).
import type { SessionClip } from '../session/session';
import { clipLoopSourceRange } from './clip-loop';
import { type TimeSignature, DEFAULT_METER } from './meter';

export function audioRetrigger(
  clip: SessionClip, meter: TimeSignature = DEFAULT_METER,
  phaseSec: number, clipDurSec: number, bufferDuration: number,
): { offsetSec: number; gateSec: number } | null {
  if (!clip.sample || phaseSec <= 0 || clipDurSec <= 0) return null;
  const { startSec, endSec } = clipLoopSourceRange(clip, meter, bufferDuration);
  const frac = Math.min(1, phaseSec / clipDurSec);
  // Clamp offsetSec to [startSec, endSec] so a bad bufferDuration fallback can't
  // produce an offset past the end of the buffer (Fix 4).
  const offsetSec = Math.min(startSec + frac * (endSec - startSec), endSec);
  const gateSec = Math.max(0.01, clipDurSec - phaseSec);
  return { offsetSec, gateSec };
}
