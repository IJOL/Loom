// Launching clips ONE BY ONE has to land them in the same bar as what is
// already playing. Reported from the app: "cuando doy al play clip a clip, no
// entran al ritmo".
//
// Two grids are in play and they are not the same grid. `launchScene` syncs to
// the loop that GOVERNS whatever is sounding. `launchClip`, when the lane it is
// launching is idle, quantises to `nextBoundary` — multiples of the bar counted
// from the AudioContext's own zero, which is page load. Nothing anchors that to
// the material already playing.
import { describe, it, expect } from 'vitest';
import { launchClip, emptyLanePlayState, type LanePlayState } from './session-runtime';
import type { SessionClip, SessionLane, SessionState } from './session';
import { DEFAULT_METER } from '../core/meter';

const BPM = 130;
const BAR = (4 * 60) / BPM;              // 1.846… s at 130

const clip = (id: string, lengthBars = 2): SessionClip =>
  ({ id, name: id, color: '#fff', lengthBars, notes: [], gridResolution: '1/16' } as unknown as SessionClip);

function session(): { state: SessionState; lanes: SessionLane[] } {
  const lanes = [
    { id: 'a', engineId: 'subtractive', clips: [clip('a0')], inserts: [] },
    { id: 'b', engineId: 'subtractive', clips: [clip('b0')], inserts: [] },
  ] as unknown as SessionLane[];
  return { state: { lanes, scenes: [], globalQuantize: '1/1' } as unknown as SessionState, lanes };
}

/** Lane A already playing, anchored where the transport actually started it. */
function playingSince(anchor: number): LanePlayState {
  const lp = emptyLanePlayState('a');
  lp.playing = clip('a0');
  lp.startTime = anchor;
  lp.loopStartedAt = anchor;
  return lp;
}

describe('launching a clip while something is already playing', () => {
  it('lands on the playing lane s bar line, not on a grid of its own', () => {
    // The first clip of a session starts the transport and begins IMMEDIATELY,
    // at whatever instant the click happened — `launchClipAt`'s idle branch
    // queues it at ctx.currentTime. So the material's bar lines sit at
    // 3.4, 5.25, 7.09… and the absolute grid sits at 1.85, 3.69, 5.54…
    const { state, lanes } = session();
    const states = new Map<string, LanePlayState>([['a', playingSince(3.4)]]);

    // 3.4 is the transport's own zero: the first clip started the clock and
    // began at the instant of the click, so that is where the song's bar lines
    // are. Everything launched afterwards measures from it.
    launchClip(states, state, lanes[1], clip('b0'), 4.0, BPM, DEFAULT_METER, undefined, 3.4);
    const at = states.get('b')!.queuedBoundary;

    // Where lane A's bar lines fall after `now`.
    const phase = ((at - 3.4) % BAR + BAR) % BAR;
    expect(Math.min(phase, BAR - phase)).toBeLessThan(BAR / 100);
  });

  it('waits no longer than the quantize asks for', () => {
    // Anchoring must not turn "next bar" into "some time later": the boundary
    // is still the first bar line at or after `now`, only counted from the
    // right zero.
    const { state, lanes } = session();
    const states = new Map<string, LanePlayState>([['a', playingSince(3.4)]]);
    launchClip(states, state, lanes[1], clip('b0'), 4.0, BPM, DEFAULT_METER, undefined, 3.4);
    const at = states.get('b')!.queuedBoundary;
    expect(at).toBeGreaterThanOrEqual(4.0);
    expect(at).toBeLessThanOrEqual(4.0 + BAR);
  });

  it('still quantises to its own grid when there is no transport anchor', () => {
    // No anchor is the state before anything has played, and the behaviour
    // there is what it always was: multiples of the bar from zero.
    const { state, lanes } = session();
    const states = new Map<string, LanePlayState>();
    launchClip(states, state, lanes[1], clip('b0'), 4.0, BPM, DEFAULT_METER);
    const at = states.get('b')!.queuedBoundary;
    expect(at).toBeGreaterThanOrEqual(4.0);
    expect(Math.abs(at / BAR - Math.round(at / BAR))).toBeLessThan(0.01);
  });
});
