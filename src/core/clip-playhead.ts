// src/core/clip-playhead.ts
// Where a clip's playhead is, right now. One implementation, three flavours
// (step / tick / fraction) because that is what the surfaces want.
//
// This formula ("steps elapsed since launch, wrapped into the effective loop
// region") used to be re-derived at every surface that draws a cursor: the
// clip-editor router's playheadFrac, the drum grid's getPlayheadTick and the
// piano-roll's getPlayheadTick each spelled out `60 / bpm / 4` and called
// loopAwareStep themselves — and the automation lanes, having no copy at all,
// drew their cursor off a GLOBAL sub-step index that had nothing to do with the
// clip. One owner: all four now agree, loop included.

import type { SessionClip } from '../session/session';
import { stepsPerBar, type TimeSignature } from './meter';
import { TICKS_PER_STEP } from './notes';
import { loopAwareStep, type GlobalLoopOverride } from './clip-loop';

/** Returned when this clip is not the one currently sounding on its lane.
 *  Negative on purpose: every drawing surface already treats "< 0" as "no
 *  cursor", so it drops straight into the existing checks. */
export const PLAYHEAD_IDLE = -1;

/** The bit of LanePlayState this needs. Structural so callers can pass their
 *  LanePlayState straight in, and tests can pass a two-field literal. */
export interface PlayingLane {
  playing: { id: string } | null;
  startTime: number;
}

/** Playhead position in 16th-note steps on the clip's own axis, or
 *  PLAYHEAD_IDLE. Wraps inside the clip's effective loop region, so it tracks
 *  what you actually hear. */
export function clipPlayheadStep(
  lp: PlayingLane | undefined | null,
  clip: SessionClip,
  meter: TimeSignature,
  bpm: number,
  now: number,
  globalLoop?: GlobalLoopOverride,
): number {
  if (!lp || !lp.playing || lp.playing.id !== clip.id) return PLAYHEAD_IDLE;
  const stepDur = 60 / bpm / 4;
  if (!(stepDur > 0)) return PLAYHEAD_IDLE;
  const stepsElapsed = Math.max(0, (now - lp.startTime) / stepDur);
  return loopAwareStep(clip, meter, stepsElapsed, globalLoop);
}

/** Same position expressed in clip ticks (what the note editors draw with). */
export function clipPlayheadTick(
  lp: PlayingLane | undefined | null,
  clip: SessionClip,
  meter: TimeSignature,
  bpm: number,
  now: number,
  globalLoop?: GlobalLoopOverride,
): number {
  const step = clipPlayheadStep(lp, clip, meter, bpm, now, globalLoop);
  return step === PLAYHEAD_IDLE ? PLAYHEAD_IDLE : step * TICKS_PER_STEP;
}

/** Same position as a 0..1 fraction of the WHOLE clip (what the waveform
 *  surfaces draw with). A looping clip therefore stays inside its loop's slice
 *  of that range. */
export function clipPlayheadFrac(
  lp: PlayingLane | undefined | null,
  clip: SessionClip,
  meter: TimeSignature,
  bpm: number,
  now: number,
  globalLoop?: GlobalLoopOverride,
): number {
  const step = clipPlayheadStep(lp, clip, meter, bpm, now, globalLoop);
  if (step === PLAYHEAD_IDLE) return PLAYHEAD_IDLE;
  const totalSteps = Math.max(1, clip.lengthBars * stepsPerBar(meter));
  return step / totalSteps;
}
