// src/core/lane-scheduler-anchor.test.ts
//
// Regression fence for the "seconds of one clip iteration" collapse. tickLane is
// the authority on how long one iteration lasts; launch-timing's clipLoopSec is
// the shared helper. Routing both through one owner must NOT change either of
// the two properties pinned here:
//
//  1. Passing ctx.globalLoop leaves a clip with no local loop bit-for-bit where
//     it was, as long as the global region spans the clip — laneLoopRegion's
//     documented additive-safety property, and the reason the "audio clips
//     re-trigger from the wrong buffer offset at every B boundary" symptom was
//     refuted: the anchor is re-derived by floor division, so only anchor mod P
//     matters and P is unchanged.
//  2. The shared helper stays GLOBAL-LOOP-BLIND. session-host's
//     fireAudioRetrigger divides a phase by clipLoopSec and maps the result into
//     clipLoopSourceRange's span; both are built on effectiveClipLoop. Teaching
//     the helper about globalLoop would desync that pair and restart audio
//     off-phase. The caller resolves the region — the helper only converts ticks
//     to seconds.
//
// (This case lives here rather than in lane-scheduler.test.ts because that file
// is already past the 500-line hard cap.)

import { describe, it, expect } from 'vitest';
import { clipLoopSec } from './launch-timing';
import { clipLoopSourceRange } from './clip-loop';
import { audioRetrigger } from './audio-retrigger';
import { DEFAULT_METER, ticksPerBar } from './meter';
import { probeLane, schedulerPeriodSec } from '../../test/scheduler-period';
import { emptyLanePlayState, seekSession, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';

const BAR = ticksPerBar(DEFAULT_METER);
const BPM = 120;

/** A clip with one note on the first tick of its region, so every iteration
 *  fires exactly once and the gap between fires IS the iteration period. */
function clip(lengthBars: number, loopBars?: number): SessionClip {
  return {
    color: '#a8e8b8', gridResolution: '1/16', id: `c${lengthBars}-${loopBars ?? 'x'}`,
    lengthBars,
    notes: [{ start: 0, duration: 10, midi: 60, velocity: 100 }],
    ...(loopBars === undefined
      ? {}
      : { loopEnabled: true, loopStartTick: 0, loopEndTick: loopBars * BAR }),
  };
}

describe('global-loop anchoring is unchanged after the collapse', () => {
  it('a global loop spanning the whole clip moves neither a trigger nor the anchor', () => {
    const c = clip(2);
    const plain = probeLane(c, BPM, DEFAULT_METER, 9);
    const global = probeLane(c, BPM, DEFAULT_METER, 9, { enabled: true, startBar: 0, endBar: 2 });
    // Guard against a vacuous pass: the probe must have looped at least once.
    expect(plain.times.length).toBeGreaterThan(1);
    // Bit-for-bit, not close-to: laneLoopRegion resolves to the identical region,
    // so the seconds math must run the identical float ops in the identical order.
    expect(global.times).toEqual(plain.times);
    expect(global.anchor).toBe(plain.anchor);
  });

  it('the anchor advances by whole iterations, so only anchor mod P is observable', () => {
    const c = clip(2);
    const { times, anchor } = probeLane(c, BPM, DEFAULT_METER, 9);
    const period = times[1] - times[0];
    // The anchor always lands ON a fire — never between two of them.
    expect(times).toContain(anchor);
    expect((anchor / period) % 1).toBeCloseTo(0, 9);
  });
});

describe('clipLoopSec stays global-loop-blind', () => {
  it("reports the clip's own loop even where the scheduler follows the global region", () => {
    // A 4-bar clip looping its first 2 bars, in a scene whose global loop spans
    // all 4 — the case where the two answers deliberately differ.
    const c = clip(4, 2);
    const local = schedulerPeriodSec(c, BPM, DEFAULT_METER, 10);
    const global = schedulerPeriodSec(c, BPM, DEFAULT_METER, 10, { enabled: true, startBar: 0, endBar: 4 });
    // The scheduler follows the global region: twice the local loop.
    expect(global / local).toBeCloseTo(2, 6);
    // The helper does not: it tracks the local loop the audio trim is cut from.
    expect(clipLoopSec(c, BPM, DEFAULT_METER) / local).toBeCloseTo(1, 9);
  });

  it('measures the same span of the clip as clipLoopSourceRange', () => {
    // fireAudioRetrigger divides one by the other: frac = phaseSec / clipLoopSec,
    // then offsetSec = startSec + frac * (endSec - startSec). If the two stopped
    // sharing effectiveClipLoop as their basis, that fraction would address the
    // wrong part of the buffer.
    const whole = clip(4);
    const half = clip(4, 2);
    const bufDur = 7; // arbitrary buffer length — only the ratio is asserted
    const src = clipLoopSourceRange(half, DEFAULT_METER, bufDur);
    const sourceFrac = (src.endSec - src.startSec) / bufDur;
    const secondsFrac = clipLoopSec(half, BPM, DEFAULT_METER) / clipLoopSec(whole, BPM, DEFAULT_METER);
    expect(sourceFrac / secondsFrac).toBeCloseTo(1, 9);
  });

  it('hands the audio re-trigger a phase inside the period it divides by', () => {
    // The seek path spans two files: session-runtime hands out
    // phaseSec = targetSongSec mod clipLoopSec, and session-host divides that by
    // clipLoopSec AGAIN to address clipLoopSourceRange's span. Change one period
    // without the other and the buffer restarts from the wrong second. Pinned on
    // a clip carrying BOTH a sample and a tempoMap — a pairing production never
    // builds (audio clips come from sample import, tempo maps from MIDI import)
    // but the type permits, and the only shape where the periods could diverge.
    const BAR = ticksPerBar(DEFAULT_METER);
    const bufDur = 9;
    const c: SessionClip = { color: '#a8e0d8', gridResolution: '1/16',
      id: 'audio-tm', lengthBars: 4, notes: [],
      sample: { sampleId: 's', mode: 'loop', trimStart: 0, trimEnd: bufDur },
      tempoMap: [{ tick: 0, bpm: BPM }, { tick: 2 * BAR, bpm: BPM / 2 }],
    };
    const laneStates = new Map<string, LanePlayState>();
    const lp = emptyLanePlayState('a'); lp.playing = c; laneStates.set('a', lp);

    let phaseSec = -1;
    seekSession(laneStates, 7.3, 100, BPM, DEFAULT_METER, undefined,
      (_laneId, p) => { phaseSec = p; });

    const period = clipLoopSec(c, BPM, DEFAULT_METER);
    // A real phase, strictly inside one iteration — never the whole loop or more.
    expect(phaseSec).toBeGreaterThan(0);
    expect(phaseSec / period).toBeLessThan(1);
    // So the offset lands strictly inside the source span, never clamped to its end.
    const src = clipLoopSourceRange(c, DEFAULT_METER, bufDur);
    const r = audioRetrigger(c, DEFAULT_METER, phaseSec, period, bufDur);
    expect(r).not.toBeNull();
    expect((r!.offsetSec - src.startSec) / (src.endSec - src.startSec)).toBeLessThan(1);
  });
});
