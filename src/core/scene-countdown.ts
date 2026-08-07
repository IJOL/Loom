// What the scene countdown ring should show at this instant.
//
// The ring never stores its own copy of the switch instant: `launchScene` and
// `launchClip` already wrote it into every affected lane's `queuedBoundary`,
// and `governingLoopSec` already decided which loop governs. This module only
// reads those, so the drawing cannot disagree with the audio.
//
// Pure: no DOM, no AudioContext, no lit. The widget in scene-ring.ts is a dumb
// consumer of the value this returns.

import type { LanePlayState } from '../session/session-runtime';
import { clipLoopSec, governingLoopSec, sceneSwitchBoundary } from './launch-timing';
import { songBarSec } from './song-position';
import { DEFAULT_METER, type TimeSignature } from './meter';

export type CountdownState = 'silent' | 'idle' | 'armed' | 'imminent';

export interface SceneCountdown {
  state: CountdownState;
  /** 0..1 — how much of the wedge to fill. ELAPSED when idle, REMAINING when
   *  armed/imminent, so the widget draws one number without branching. */
  frac: number;
  /** Length of the governing loop in bars. May be fractional. */
  bars: number;
  /** Seconds until the switch; null when nothing is queued. */
  secsLeft: number | null;
  /** Pre-formatted centre reading — produced here so the beats-per-bar count
   *  follows the session meter and stays covered by this module's tests. */
  centerText: string;
}

const SILENT: SceneCountdown = {
  state: 'silent', frac: 0, bars: 0, secsLeft: null, centerText: '',
};

export function sceneCountdown(
  laneStates: Map<string, LanePlayState>,
  now: number,
  bpm: number,
  meter: TimeSignature = DEFAULT_METER,
): SceneCountdown {
  const playing: { loopStartedAt: number; loopSec: number }[] = [];
  let nearest = Infinity;
  for (const lp of laneStates.values()) {
    if (lp.queued && lp.queuedBoundary < nearest) nearest = lp.queuedBoundary;
    if (!lp.playing) continue;
    const loopSec = clipLoopSec(lp.playing, bpm, meter);
    if (loopSec > 0) playing.push({ loopStartedAt: lp.loopStartedAt, loopSec });
  }

  const barSec = songBarSec(bpm, meter);
  if (barSec <= 0) return SILENT;
  if (playing.length === 0 && nearest === Infinity) return SILENT;

  const gov = governingLoopSec(playing.map((p) => p.loopSec));
  // Cold start (queued, nothing playing) has no governing loop: the boundary
  // came off the quantize grid, so one bar is the honest span to count down.
  const span = gov > 0 ? gov : barSec;
  const bars = span / barSec;

  if (nearest < Infinity) {
    const secsLeft = Math.max(0, nearest - now);
    const frac = Math.max(0, Math.min(1, secsLeft / span));
    const state: CountdownState = secsLeft <= barSec ? 'imminent' : 'armed';
    return { state, frac, bars, secsLeft, centerText: remainingText(frac * bars, meter) };
  }

  // Idle: the elapsed phase of the loop that governs, expressed against the
  // same instant a switch would land on — sceneSwitchBoundary, not a modulo.
  const T = sceneSwitchBoundary(playing, now);
  const frac = Math.max(0, Math.min(1, 1 - (T - now) / span));
  return {
    state: 'idle', frac, bars, secsLeft: null,
    centerText: String(Math.floor(frac * bars) + 1),
  };
}

/** Bars left, or — inside the final bar — beats left in the session meter. */
function remainingText(barsLeft: number, meter: TimeSignature): string {
  if (barsLeft >= 1) return String(Math.ceil(barsLeft));
  return String(Math.max(1, Math.ceil(barsLeft * meter.num)));
}
