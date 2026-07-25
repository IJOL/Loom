// tickSessionEnvelopes — the LIVE clip-automation index. It had no coverage at
// all, which is how it kept wrapping at `lengthBars * 16` sub-steps while
// lane-scheduler.ts looped the same clip every `lengthBars * ticksPerBar(meter)`
// ticks. In 4/4 those are the same period; in 3/4 the curve slid a bar per lap.
//
// Every assertion here derives the clip's period from ticksPerBar — the
// scheduler's own owner — rather than restating a number, so the two cannot be
// made to agree by editing this file.
import { describe, it, expect } from 'vitest';
import { tickSessionEnvelopes, emptyLanePlayState, type LanePlayState } from './session-runtime';
import { ticksPerBar, DEFAULT_METER, type TimeSignature } from '../core/meter';
import { TICKS_PER_STEP } from '../core/notes';
import { envelopeValueLength } from '../core/clip-envelope-length';
import type { SessionClip } from './session';

const BPM = 120;
const STEP_DUR = 60 / BPM / 4;
const THREE_FOUR: TimeSignature = { num: 3, den: 4 };
const SEVEN_EIGHT: TimeSignature = { num: 7, den: 8 };
const METERS = [DEFAULT_METER, THREE_FOUR, SEVEN_EIGHT];

/** Exactly the period lane-scheduler.ts loops this clip on, in seconds. */
function clipLapSec(lengthBars: number, m: TimeSignature): number {
  return ((lengthBars * ticksPerBar(m)) / TICKS_PER_STEP) * STEP_DUR;
}

/** A clip whose envelope is a strictly increasing ramp, so every sub-step holds
 *  a value no other sub-step holds and "which slot did it read" is observable. */
function rampClip(lengthBars: number, m: TimeSignature): SessionClip {
  const len = envelopeValueLength(lengthBars, m);
  return {
    id: 'c1', lengthBars, notes: [],
    envelopes: [{
      paramId: 'lane1.filter.cutoff', enabled: true,
      values: Array.from({ length: len }, (_, i) => (i + 1) / (len + 1)),
    }],
  } as unknown as SessionClip;
}

function lanesPlaying(clip: SessionClip): Map<string, LanePlayState> {
  const lp = emptyLanePlayState('lane1');
  lp.playing = clip;
  lp.startTime = 0;
  return new Map([[lp.laneId, lp]]);
}

/** The value the tick lands on the knob at absolute time `t`. */
function appliedAt(clip: SessionClip, t: number, m: TimeSignature): number {
  let v = Number.NaN;
  tickSessionEnvelopes(lanesPlaying(clip), t, BPM, m, (_paramId, n) => { v = n; });
  return v;
}

describe('tickSessionEnvelopes — loop period', () => {
  it('starts at the top of the envelope', () => {
    for (const m of METERS) {
      const clip = rampClip(4, m);
      expect(appliedAt(clip, 0, m)).toBe(clip.envelopes![0].values[0]);
    }
  });

  it('returns to the top after exactly one clip lap, in every meter', () => {
    for (const m of METERS) {
      const clip = rampClip(4, m);
      const lap = clipLapSec(4, m);
      expect(appliedAt(clip, lap, m)).toBe(appliedAt(clip, 0, m));
      // …and the ramp really did move in between, so this is not a constant.
      expect(appliedAt(clip, lap / 2, m)).toBeGreaterThan(appliedAt(clip, 0, m));
    }
  });

  it('reaches the last slot of the envelope inside one lap', () => {
    // The honest symptom: with a 16-step bar, a 3/4 clip's last quarter was read
    // on a LATER lap, at the wrong musical position — and the tail of the array
    // was addressed with indices it does not have (falling back to 0.5).
    for (const m of METERS) {
      const clip = rampClip(2, m);
      const values = clip.envelopes![0].values;
      const lap = clipLapSec(2, m);
      // Mid-way through the final sub-step of the lap.
      const t = (lap * (values.length - 0.5)) / values.length;
      expect(appliedAt(clip, t, m)).toBe(values[values.length - 1]);
    }
  });

  it('plays the same curve on every lap — the envelope does not slide', () => {
    // THE symptom. With a 16-step bar, lap 1 of a 3/4 clip reads correctly and
    // lap 2 reads a bar late (and off the end of the array), so the curve walks
    // away from the notes it was drawn against and only realigns four laps later.
    for (const m of METERS) {
      const clip = rampClip(2, m);
      const lap = clipLapSec(2, m);
      const at = (t: number) => appliedAt(clip, t, m);
      const first = Array.from({ length: 24 }, (_, i) => at((lap * (i + 0.5)) / 24));
      const second = Array.from({ length: 24 }, (_, i) => at(lap + (lap * (i + 0.5)) / 24));
      expect(second).toEqual(first);
    }
  });

  it('walks the array one sub-step at a time, in order', () => {
    const m = THREE_FOUR;
    const clip = rampClip(1, m);
    const values = clip.envelopes![0].values;
    const lap = clipLapSec(1, m);
    // Sampled mid-sub-step so the assertion does not rest on where a float lands
    // exactly on a boundary.
    const walked = values.map((_, i) => appliedAt(clip, (lap * (i + 0.5)) / values.length, m));
    expect(walked).toEqual(values);
  });

  it('applies nothing for a lane with no clip playing', () => {
    const states = new Map([['lane1', emptyLanePlayState('lane1')]]);
    let calls = 0;
    tickSessionEnvelopes(states, 1, BPM, THREE_FOUR, () => { calls++; });
    expect(calls).toBe(0);
  });
});
