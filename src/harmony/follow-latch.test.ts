// A follower's harmony may only change where a BAR does.
//
// The journey is counted on the LEADER's legs and the leader wraps when it
// likes, so a chord could arrive halfway through this lane's iteration — the
// scheduler asks for the notes every tick and takes whatever it is handed, so
// the rest of the bar came out of the new harmony. Reported from the panel:
// "el bajo cambia el patrón a mitad del patrón anterior... el follow está en
// medio del loop y cambia".

import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';
import type { Progression } from '../arranger/progression';
import { createFollowSource, type FollowDeps } from './follow-source';

const BAR = TICKS_PER_QUARTER * 4;
const n = (start: number, duration: number, midi: number): NoteEvent =>
  ({ start, duration, midi, velocity: 100 });
const LEADER = [n(0, BAR, 60), n(BAR, BAR, 58)];

const HOME: Progression = [{ degree: 0, bars: 1 }, { degree: 5, bars: 1 }];
const AWAY: Progression = [{ degree: 3, bars: 1 }, { degree: 6, bars: 1 }];

function deps(over: Partial<FollowDeps> = {}): FollowDeps {
  return {
    leaderNotes: () => LEADER,
    role: () => 'comp',
    tonality: () => ({ key: 0, scale: 'minor' }),
    style: () => 'trance',
    barTicks: () => BAR,
    bars: () => 2,
    octaveBase: () => 48,
    written: () => undefined,
    sessionProgression: () => HOME,
    clipBars: () => 2,
    // Every case here is about a lane with a bar already in flight. Stopped,
    // there is nothing to protect and nothing is held.
    playing: () => true,
    ...over,
  };
}

const pitches = (src: () => NoteEvent[] | undefined) =>
  (src() ?? []).map((x) => x.midi).join(',');

describe('the harmony is latched to the lane bar line', () => {
  it('a journey that moves mid-iteration does NOT reach the notes', () => {
    // The leg advances between two asks WITHOUT the lap moving — exactly what
    // happens when the leader wraps in the middle of the follower's bar.
    let leg = 0;
    const src = createFollowSource(deps({
      lap: () => 0,
      travel: (base) => (leg === 0 ? base : AWAY),
    }));
    const before = pitches(src);
    leg = 1;
    expect(pitches(src)).toEqual(before);
  });

  it('and DOES reach them at the next bar line', () => {
    let leg = 0;
    let lap = 0;
    const src = createFollowSource(deps({
      lap: () => lap,
      travel: (base) => (leg === 0 ? base : AWAY),
    }));
    const before = pitches(src);
    leg = 1;
    lap = 1;
    expect(pitches(src)).not.toEqual(before);
  });

  it('but the USER choosing a progression lands at once', () => {
    // Waiting is right for something that happened on its own and wrong for
    // something somebody just did — the same rule the macros follow.
    let chosen = HOME;
    const src = createFollowSource(deps({ lap: () => 0, sessionProgression: () => chosen }));
    const before = pitches(src);
    chosen = AWAY;
    expect(pitches(src)).not.toEqual(before);
  });

  it('but STOPPED, nothing is held — an edit must not wait for a bar line', () => {
    // A lane sitting still has no bar in flight to protect, and holding it
    // there would mean editing the leader's clip, or picking a progression,
    // showed nothing until the transport had gone round once. One is a glitch;
    // the other is a dead control.
    let leg = 0;
    const src = createFollowSource(deps({
      playing: () => false, travel: (base) => (leg === 0 ? base : AWAY),
    }));
    const before = pitches(src);
    leg = 5;
    expect(pitches(src)).not.toEqual(before);
  });
});

describe('the whole progression reaches a shorter clip', () => {
  const FOUR: Progression = [
    { degree: 0, bars: 1 }, { degree: 5, bars: 1 },
    { degree: 2, bars: 1 }, { degree: 6, bars: 1 },
  ];

  it('two bars at a time, and the far half is genuinely heard', () => {
    const at = (lap: number) => pitches(createFollowSource(deps({
      sessionProgression: () => FOUR, clipBars: () => 2, lap: () => lap,
    })));
    expect(at(1)).not.toEqual(at(0));
    // Over two laps every chord of the four has sounded.
    const both = new Set((at(0) + ',' + at(1)).split(','));
    expect(both.size).toBeGreaterThan(new Set(at(0).split(',')).size);
  });

  it('nothing it emits falls outside the clip the scheduler will loop', () => {
    // Anything past the clip is discarded before it reaches a voice, so a part
    // that ran long was a part that went silent without saying so.
    for (let lap = 0; lap < 6; lap++) {
      const out = createFollowSource(deps({
        sessionProgression: () => FOUR, clipBars: () => 2, lap: () => lap,
      }))() ?? [];
      expect(out.length).toBeGreaterThan(0);
      for (const x of out) expect(x.start).toBeLessThan(BAR * 2);
    }
  });

  it('a one-bar progression fills both bars instead of leaving one empty', () => {
    const out = createFollowSource(deps({
      sessionProgression: () => [{ degree: 0, bars: 1 }], clipBars: () => 2, lap: () => 0,
    }))() ?? [];
    expect(out.some((x) => x.start >= BAR)).toBe(true);
  });
});
