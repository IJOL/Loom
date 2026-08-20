// Does a follower actually change what the transport FIRES?
//
// Every other test asks a piece of the chain in isolation — the analysis infers,
// the renderer renders, the wiring builds a source. None of them runs the
// transport, which is the only thing that can say whether an answer reaches a
// note. This counts triggers through the real tickSession → tickLane path.
//
// It is not ceremony. WEAVE's first shape shipped SILENT behind a fully green
// suite, and the file next door exists because of it.

import { describe, it, expect } from 'vitest';
import { createWeaveWiring } from './weave-wiring';
import { tickSession, emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip, SessionState } from '../session/session';
import { DEFAULT_METER, ticksPerBar } from '../core/meter';

const BPM = 120;
const SEC_PER_BAR = (60 / BPM) * 4;
const LOOK = 0.2;
const BAR = ticksPerBar(DEFAULT_METER);

/** A bar built plainly on the tonic of A minor. What it implies is not in doubt,
 *  so a failure here is the wiring and never the analysis. */
const LEAD_CLIP: SessionClip = {
  id: 'leadClip', name: 'lead', color: '#fff', lengthBars: 1, gridResolution: '1/16',
  notes: [
    { start: 0, duration: BAR / 2, midi: 57, velocity: 100 },
    { start: BAR / 2, duration: BAR / 2, midi: 60, velocity: 100 },
  ],
};

/** The follower's own clip, deliberately EMPTY. A follower has no material of
 *  its own — what it needs from a clip is the loop's length, not its notes. */
const EMPTY_CLIP: SessionClip = {
  id: 'chordsClip', name: 'chords', color: '#fff', lengthBars: 1,
  gridResolution: '1/16', notes: [],
};

function fixture(opts: { follow?: boolean; leaderId?: string; withFollowerClip?: boolean }) {
  const state = {
    name: 'T', masterInserts: [], sends: [], scenes: [], globalQuantize: 'immediate',
    musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false },
    lanes: [
      { id: 'lead', engineId: 'subtractive', role: 'melody', inserts: [], clips: [LEAD_CLIP] },
      {
        id: 'chords', engineId: 'subtractive', role: 'pad', inserts: [],
        clips: [EMPTY_CLIP],
        follow: opts.follow ? { leaderId: opts.leaderId ?? 'lead' } : undefined,
      },
    ],
  } as unknown as SessionState;

  const laneStates = new Map<string, LanePlayState>([
    ['lead', { ...emptyLanePlayState('lead'), playing: LEAD_CLIP, startTime: 0, loopStartedAt: 0 }],
    ['chords', {
      ...emptyLanePlayState('chords'),
      playing: opts.withFollowerClip === false ? null : EMPTY_CLIP,
      startTime: 0, loopStartedAt: 0,
    }],
  ]);

  const weave = createWeaveWiring({
    getLaneStates: () => laneStates,
    getMeter: () => DEFAULT_METER,
    getState: () => state,
  });
  return { state, laneStates, weave };
}

/** One bar of transport, counting what fired on each lane. */
function runBar(
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  notesFor?: (laneId: string) => ReturnType<ReturnType<typeof createWeaveWiring>['notesFor']>,
) {
  const fired = new Map<string, number>();
  // Stop one look-ahead short of the bar: the last window reaches into the next
  // iteration and would count a note twice, which says nothing about following.
  for (let t = 0; t < SEC_PER_BAR - LOOK; t += LOOK) {
    tickSession(
      laneStates, state, t, LOOK, BPM,
      (laneId) => { fired.set(laneId, (fired.get(laneId) ?? 0) + 1); },
      () => {},
      undefined, undefined, undefined, undefined, undefined, notesFor,
    );
  }
  return fired;
}

describe('a follower fires notes through the real transport', () => {
  it('sounds over one bar', () => {
    const { state, laneStates, weave } = fixture({ follow: true });
    const fired = runBar(state, laneStates, weave.notesFor);
    expect(fired.get('chords') ?? 0).toBeGreaterThan(0);
  });

  it('plays notes its OWN clip does not contain', () => {
    // The follower's clip is empty. Anything it fires can only have come from
    // the derived source — which is the whole claim, and the one an isolated
    // test cannot make.
    const { state, laneStates, weave } = fixture({ follow: true });
    const withFollow = runBar(state, laneStates, weave.notesFor);
    expect(withFollow.get('chords') ?? 0).toBeGreaterThan(0);
  });

  it('is silent on that lane WITHOUT the wiring — the source is what does it', () => {
    // The negative control. Same session, same empty clip, no notesFor: the
    // lane has nothing of its own to play, so it must fire nothing.
    const { state, laneStates } = fixture({ follow: true });
    const fired = runBar(state, laneStates, undefined);
    expect(fired.get('chords') ?? 0).toBe(0);
  });

  it('a follower whose leader is gone stays silent rather than throwing', () => {
    const { state, laneStates, weave } = fixture({ follow: true, leaderId: 'ghost' });
    expect(() => runBar(state, laneStates, weave.notesFor)).not.toThrow();
    const fired = runBar(state, laneStates, weave.notesFor);
    expect(fired.get('chords') ?? 0).toBe(0);
  });
});

describe('the leader is unchanged by being followed', () => {
  it('fires the same count whether or not anything follows it', () => {
    const followed = fixture({ follow: true });
    const alone = fixture({ follow: false });
    const a = runBar(followed.state, followed.laneStates, followed.weave.notesFor);
    const b = runBar(alone.state, alone.laneStates, alone.weave.notesFor);
    expect(a.get('lead')).toBe(b.get('lead'));
  });
});

describe('a follower still needs a launched clip', () => {
  it('is silent with nothing playing on its own lane', () => {
    // Not a defect — a consequence of where this plugs in. The scheduler ticks
    // a lane because a clip is PLAYING on it; the derived notes replace what
    // that clip contains, they do not replace the clip. So a follower needs a
    // cell in the scene, and an empty one is enough.
    const { state, laneStates, weave } = fixture({ follow: true, withFollowerClip: false });
    const fired = runBar(state, laneStates, weave.notesFor);
    expect(fired.get('chords') ?? 0).toBe(0);
  });
});
