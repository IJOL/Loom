// test/scheduler-period.ts
// Measure the period tickLane ACTUALLY uses for one clip iteration, the only
// honest way: put a note on the first tick of the clip's region, run the lane
// with a realistic 25 ms tick / 120 ms look-ahead, and read the gap between two
// consecutive fires. Nothing here calls the seconds helper under test, so a test
// built on this cannot pass by agreeing with itself.

import { tickLane } from '../src/core/lane-scheduler';
import type { GlobalLoopOverride } from '../src/core/clip-loop';
import type { TimeSignature } from '../src/core/meter';
import type { SessionClip } from '../src/session/session';

export interface LaneProbe {
  /** Absolute audio time of every trigger, in fire order. */
  times: number[];
  /** The loop anchor tickLane returned on the last tick. */
  anchor: number;
}

/** Run `clip` through tickLane across [0, sec), collecting triggers + anchor. */
export function probeLane(
  clip: SessionClip, bpm: number, meter: TimeSignature, sec: number,
  globalLoop?: GlobalLoopOverride,
): LaneProbe {
  const times: number[] = [];
  let anchor = 0;
  let lastScheduledAt = -Infinity;
  for (let now = 0; now < sec; now += 0.025) {
    anchor = tickLane(clip, {
      bpm, lookaheadSec: 0.12, now, loopStartedAt: anchor, lastScheduledAt, meter, globalLoop,
      onTrigger: (_n, t) => { times.push(t); if (t > lastScheduledAt) lastScheduledAt = t; },
      onAutomation: () => {},
    });
  }
  return { times, anchor };
}

/** Seconds between two consecutive iterations of `clip` as the scheduler times
 *  them. `clip` must carry exactly one note, on the first tick of its region. */
export function schedulerPeriodSec(
  clip: SessionClip, bpm: number, meter: TimeSignature, sec: number,
  globalLoop?: GlobalLoopOverride,
): number {
  const { times } = probeLane(clip, bpm, meter, sec, globalLoop);
  if (times.length < 2) throw new Error(`need 2 fires to measure a period, got ${times.length}`);
  return times[1] - times[0];
}
