// Pure per-scene global-loop math for the global transport (Phase 2). Resolves a
// scene's A–B window and computes which global-loop iteration a time falls in, so
// the runtime can re-anchor every lane to bar A at each B boundary. No DOM/audio.
import { songBarSec } from './song-position';
import { type TimeSignature, DEFAULT_METER } from './meter';

export interface GlobalLoop { enabled: boolean; startBar: number; endBar: number; }

export function effectiveGlobalLoop(scene: {
  globalLoopEnabled?: boolean; globalLoopStartBar?: number; globalLoopEndBar?: number;
}): GlobalLoop {
  const startBar = Math.max(0, scene.globalLoopStartBar ?? 0);
  const endBar = scene.globalLoopEndBar ?? 0;
  const enabled = !!scene.globalLoopEnabled && endBar > startBar;
  return { enabled, startBar, endBar };
}

export function globalLoopIteration(
  now: number, anchorSec: number, loop: GlobalLoop, bpm: number, meter: TimeSignature = DEFAULT_METER,
): { iter: number; iterStartSec: number; lenSec: number; aSec: number } {
  const barSec = songBarSec(bpm, meter);
  const lenSec = Math.max(1e-6, (loop.endBar - loop.startBar) * barSec);
  const aSec = loop.startBar * barSec;
  const elapsed = now - anchorSec;
  const iter = elapsed < 0 ? 0 : Math.floor(elapsed / lenSec);
  const iterStartSec = anchorSec + iter * lenSec;
  return { iter, iterStartSec, lenSec, aSec };
}

/** Fold a raw (linear) song-bar position into the active loop window [A,B). */
export function wrapSongBars(rawBars: number, loop: GlobalLoop): number {
  if (!loop.enabled) return rawBars;
  const len = loop.endBar - loop.startBar;
  if (len <= 0) return rawBars;
  const off = ((rawBars - loop.startBar) % len + len) % len;
  return loop.startBar + off;
}
