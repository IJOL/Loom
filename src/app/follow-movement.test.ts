// Can a follower MOVE?
//
// The accompaniment was reported as "super static", and it was. Three separate
// reasons, and only one of them is a defect:
//
//   1. On a one-chord loop the analysis honestly answers ONE CHORD, for ever.
//      Correct, and useless as accompaniment.
//   2. A PAD over one chord is a single stack held across the whole span — one
//      event. The progression fold shifts a note by the degree of the bar it
//      STARTS in, so a note that starts once takes one chord and never moves;
//      and Density drops notes in weak positions, of which a lone downbeat has
//      none. Nothing can move a part that is one event. That is the pad being a
//      pad, not a bug.
//   3. The macros were not passed to the follow source at all. That one WAS a
//      defect, and these tests are why it is now fixed.
//
// Every case below is over the same material that produced the complaint: two
// bars that are nothing but a C minor triad, however hard anything analyses it.

import { describe, it, expect } from 'vitest';
import { createWeaveWiring } from './weave-wiring';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { DEFAULT_METER, ticksPerBar } from '../core/meter';
import type { SessionState } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';

const BAR = ticksPerBar(DEFAULT_METER);

const ONE_CHORD_LOOP = [0, 1, 2, 3].flatMap((i) => [60, 63, 67].map((midi) => ({
  start: i * (BAR / 2), duration: BAR / 4, midi, velocity: 100,
})));

function session(role: string, style = DEFAULT_MUSICALITY.style): SessionState {
  return {
    name: 'T', masterInserts: [], sends: [], scenes: [], globalQuantize: 'immediate',
    musicality: { ...DEFAULT_MUSICALITY, key: 0, scale: 'minor', style },
    lanes: [
      {
        id: 'lead', engineId: 'subtractive', role: 'melody', inserts: [],
        clips: [{ id: 'leadClip', name: 'lead', color: '#fff', lengthBars: 2,
                  gridResolution: '1/16', notes: ONE_CHORD_LOOP }],
      },
      { id: 'chords', engineId: 'subtractive', role, inserts: [], clips: [], follow: { leaderId: 'lead' } },
    ],
  } as unknown as SessionState;
}

const wiring = (state: SessionState) => createWeaveWiring({
  getLaneStates: () => new Map<string, LanePlayState>(),
  getMeter: () => DEFAULT_METER,
  getState: () => state,
});

const notesOf = (w: ReturnType<typeof wiring>) => w.notesFor('chords')?.() ?? [];
const pitches = (w: ReturnType<typeof wiring>) => notesOf(w).map((n) => n.midi);

describe('the complaint, pinned: a pad over one chord cannot move', () => {
  it('is a single stack, so bar two never differs from bar one', () => {
    const out = notesOf(wiring(session('pad')));
    const bar1 = out.filter((n) => n.start < BAR).map((n) => n.midi).sort();
    const bar2 = out.filter((n) => n.start >= BAR).map((n) => n.midi).sort();
    expect(bar2.length === 0 || JSON.stringify(bar1) === JSON.stringify(bar2)).toBe(true);
  });

  it('but a chosen progression walks it, because it is used and not deduced', () => {
    // This used to assert the opposite, and the opposite was the complaint. A
    // chosen progression reached a follower only by folding the LEADER's notes
    // — which the analysis then read back as one chord, because a one-bar
    // library loop transposed per bar still infers the tonic. So the harmony
    // was known, thrown away, and guessed at again, wrongly.
    //
    // Taken directly, four chords are four chords: the pad is one stack per
    // chord and there are now four of them where there was one.
    const s = session('pad');
    const w = wiring(s);
    const flat = pitches(w);
    s.musicality.progression = 'i-VI-III-VII';
    w.invalidate();
    const walked = pitches(w);
    expect(walked).not.toEqual(flat);
    // TWO chords, not four: the clip is two bars and the clip owns its length —
    // anything past it is discarded before it reaches a voice. So a four-bar
    // progression is heard a window at a time, two chords per lap, and the far
    // half arrives on the next. Asserting four here would be asserting that
    // half of them get thrown away, which is what used to happen.
    expect(walked.length).toBe(flat.length * 2);
    expect(new Set(walked).size).toBeGreaterThan(new Set(flat).size);
  });

  it('and within ONE chord it still does not move — that part was never the bug', () => {
    // The original insight survives: a pad has one onset per chord, so nothing
    // shifts it inside a chord's own span. What was wrong was the number of
    // chords, not what the pad does with them.
    const s = session('pad');
    const w = wiring(s);
    s.musicality.progression = 'i-VI';
    w.invalidate();
    const firstChord = notesOf(w).filter((n) => n.start < BAR * 2);
    expect(new Set(firstChord.map((n) => n.start)).size).toBe(1);
  });
});

describe('a part with onsets DOES walk a progression', () => {
  it('a comp changes its notes while the leader does not change at all', () => {
    const s = session('comp');
    const w = wiring(s);
    const flat = pitches(w);
    s.musicality.progression = 'i-VI-III-VII';
    w.invalidate();
    expect(pitches(w)).not.toEqual(flat);
  });
});

describe('the macros reach a follower', () => {
  it('Density thins a part that has weak positions to lose', () => {
    // 'house' comps OFFBEAT, and applyDensity drops by metric weight — so a
    // style whose hits all land on strong beats has nothing to give up however
    // far the knob goes down. That is the macro working, not failing.
    const w = wiring(session('comp', 'house'));
    const full = pitches(w).length;
    w.state.macros.density = 0.05;
    w.invalidate();
    expect(pitches(w).length).toBeLessThan(full);
  });

  it('Energy moves the velocities', () => {
    const s = session('comp');
    const w = wiring(s);
    const soft = notesOf(w).map((n) => n.velocity);
    w.state.macros.energy = 1;
    w.invalidate();
    expect(notesOf(w).map((n) => n.velocity)).not.toEqual(soft);
  });

  it('at the neutrals the part is exactly as rendered — the layer costs nothing', () => {
    const s = session('comp');
    const w = wiring(s);
    const before = pitches(w);
    w.state.macros.density = 0.5;
    w.state.macros.energy = 0.5;
    w.invalidate();
    expect(pitches(w)).toEqual(before);
  });
});
