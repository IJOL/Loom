// The wiring had no test, and a browser check said why it needed one: with a
// weave configured, both ends of the crossfade sounded identical — which is what
// "no gate at all" looks like from the outside.
import { describe, it, expect } from 'vitest';
import { createWeaveWiring } from './weave-wiring';
import { defaultWeaveState } from '../weave/weave-state';
import { setLibrary } from '../patterns/pattern-library';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { DEFAULT_METER, ticksPerBar } from '../core/meter';
import { inScale } from '../core/musicality';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import type { SessionState } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';

const BAR = ticksPerBar(DEFAULT_METER);
const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });

// Two clips on one lane, sharing nothing: A hits at step 0, B at step 8. That
// makes "which one is the gate letting through" a question with a visible answer.
const A = [hit(0, 36)];
const B = [hit(8, 40)];

function session(engineId = 'subtractive'): SessionState {
  return {
    lanes: [{
      id: 'lane1',
      engineId,
      clips: [
        { id: 'clipA', name: 'A', color: '#fff', lengthBars: 1, notes: A, gridResolution: '1/16' },
        { id: 'clipB', name: 'B', color: '#fff', lengthBars: 1, notes: B, gridResolution: '1/16' },
      ],
      inserts: [],
    }],
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState;
}

function wiring(
  state: SessionState,
  writeStep?: (destId: string, normalised: number) => void,
) {
  return createWeaveWiring({
    getLaneStates: () => new Map<string, LanePlayState>(),
    getMeter: () => DEFAULT_METER,
    getState: () => state,
    writeStep,
  });
}



describe('createWeaveWiring — the weave actually reaches the scheduler', () => {
  it('has nothing to say about an untouched lane', () => {
    // The whole feature is additive: a session nobody has woven schedules
    // exactly as it did before the panel existed.
    expect(wiring(session()).notesFor('lane1')).toBeUndefined();
  });

  it('builds a source once a lane names its loops', () => {
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(typeof w.notesFor('lane1')).toBe('function');
  });

  it('hands over from A to B across the fade', () => {
    // The assertion the browser could not make. A source that never reached the
    // scheduler would answer the same at both ends and the crossfade would do
    // nothing at all.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')!()!.map((n) => n.midi)).toEqual([36]);

    w.state.lanes.lane1.weave = { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 1 };
    w.invalidate();
    // B's hit is PRODUCED, not merely allowed — it is not in the lane's playing
    // clip at all, which is exactly what a predicate could never do.
    expect(w.notesFor('lane1')!()!.map((n) => n.midi)).toEqual([40]);
  });

  it('names the loop on EVERY lane, layered or not', () => {
    // This used to assert the opposite, and asking the engine was the wrong
    // question. The tag is one field that every engine but LAYERS ignores; what
    // is exclusive to LAYERS is ROUTING by it. Tagging only there meant the
    // panel could colour the handover on a layered lane and nowhere else — and
    // on an ordinary lane the drawing showed nothing about what the fader does.
    const w = wiring(session('subtractive'));
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')!()![0].layerIndex).toBe(0);
  });

  it('names the loop on a LAYERS lane, so each note reaches its own instrument', () => {
    const w = wiring(session('layers'));
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')!()![0].layerIndex).toBe(0);
  });

  it('drops the cached source when the weave moves', () => {
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    const first = w.notesFor('lane1');
    expect(w.notesFor('lane1')).toBe(first);   // cached while nothing changed
    w.invalidate();
    expect(w.notesFor('lane1')).not.toBe(first);
  });

  it('shapes the CROSS-FADE with the macros too, not just an unwoven clip', () => {
    // A lane that was weaving used to be the one lane the macros could not
    // reach: they only ever applied to a clip playing itself.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    const plain = w.notesFor('lane1')!()![0].velocity;

    w.state.macros.energy = 1;
    w.invalidate();
    expect(w.notesFor('lane1')!()![0].velocity).toBeGreaterThan(plain);
  });

  it('needs no source at all while both note macros sit at their neutral', () => {
    // The feature stays free until someone opens the panel.
    const w = wiring(session());
    w.state.macros.energy = 0.5;
    w.state.macros.density = 0.5;
    expect(w.notesFor('lane1')).toBeUndefined();
  });

  it('lets Darkness choose the scale the blend walks, without touching the session', () => {
    // The toolbar's key and scale are the user's. A macro that overwrote them
    // would give one number two owners AND leave the scene in whatever scale
    // the knob happened to stop on.
    const state = session();
    const w = wiring(state);
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    const before = state.musicality.scale;
    w.state.macros.darkness = 1;
    w.invalidate();
    expect(w.notesFor('lane1')).toBeDefined();
    expect(state.musicality.scale).toBe(before);
  });

  describe('the master flow travels on the clock', () => {
    // A bar at 120 bpm in 4/4. The wiring derives this itself from the meter and
    // the tempo; spelling it out here is what makes "half a lap" checkable.
    const BAR_SEC = 2;

    const flowing = (
      speedBars: number,
      drift: 'together' | 'offset' | 'free' = 'together',
      evolve = false,
    ) => {
      const w = createWeaveWiring({
        getLaneStates: () => new Map<string, LanePlayState>(),
        getMeter: () => DEFAULT_METER,
        getBpm: () => 120,
        getState: () => session(),
      });
      w.state.lanes.lane1 = {
        weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
        locked: false, harmonyLeader: false,
      };
      w.state.flow = { drift, speedBars, evolve };
      return w;
    };
    const posOf = (w: ReturnType<typeof flowing>) => (w.state.lanes.lane1.weave as { x: number }).x;

    it('stands still at speed OFF, which is the default', () => {
      // The default matters more than the arithmetic: a panel that started
      // travelling the moment it was opened would change a session nobody
      // touched.
      const w = flowing(0);
      w.advance(BAR_SEC * 4);
      expect(posOf(w)).toBe(0);
    });

    it('is half way round after half the journey', () => {
      const w = flowing(8);
      w.advance(BAR_SEC * 4);
      expect(posOf(w)).toBeCloseTo(0.5, 3);
    });

    it('wraps rather than arriving and stopping', () => {
      // Stopping at the end would be the static scene this whole panel exists
      // to avoid.
      const w = flowing(8);
      w.advance(BAR_SEC * 12);
      expect(posOf(w)).toBeCloseTo(0.5, 3);
    });

    it('drops the cached sources so the next tick folds the new position', () => {
      // The bug this guards is the quiet one: the number moves, the panel
      // follows it, and the music keeps playing the fold from before.
      const w = flowing(8);
      const first = w.notesFor('lane1');
      w.advance(BAR_SEC * 2);
      expect(w.notesFor('lane1')).not.toBe(first);
    });

    it('re-hooks onto a fresh loop when a lap completes, EVOLVING', () => {
      // What makes A→B endless, and what the topology's header always claimed
      // it was. Without it a lap wrapped and the SAME two loops crossed again —
      // a loop of a loop, which is the static scene the panel exists to avoid.
      //
      // The lane weaves library ids here rather than the fixture's clips: the
      // draw comes from the library, because landing the journey on the empty
      // carrier clip would be silence with no way to tell why.
      setLibrary({
        synth: {}, drums: {},
        bass: {
          [DEFAULT_MUSICALITY.style]: [
            [{ semi: 0, vel: 0.8, slide: false }],
            [{ semi: 3, vel: 0.8, slide: false }],
            [{ semi: 7, vel: 0.8, slide: false }],
          ],
        },
        catalog: {},
      } as never);
      try {
        const w = flowing(4, 'together', true);
        const style = DEFAULT_MUSICALITY.style;
        w.state.lanes.lane1 = {
          weave: { kind: 'ab', a: `lib:${style}:bass:0`, b: `lib:${style}:bass:1`, x: 0.97 },
          locked: false, harmonyLeader: false,
        };
        // Just past a whole lap, so the position folds back to the near end.
        w.advance(BAR_SEC * 4.02);
        const sel = w.state.lanes.lane1.weave as { a: string; b: string };
        // What it arrived at is what it now leaves from.
        expect(sel.a).toBe(`lib:${style}:bass:1`);
        expect(sel.b).not.toBe(sel.a);
      } finally {
        setLibrary(null as never);
      }
    });

    it('STATIC travels a lap and keeps the pair it was given', () => {
      // The other half of the switch, and the state a session is saved in: the
      // scene still moves under the clock, it just never draws new material.
      const w = flowing(4);
      const style = DEFAULT_MUSICALITY.style;
      w.state.lanes.lane1 = {
        weave: { kind: 'ab', a: `lib:${style}:bass:0`, b: `lib:${style}:bass:1`, x: 0.97 },
        locked: false, harmonyLeader: false,
      };
      w.advance(BAR_SEC * 4.02);
      const sel = w.state.lanes.lane1.weave as { a: string; b: string; x: number };
      expect(sel.a).toBe(`lib:${style}:bass:0`);
      expect(sel.b).toBe(`lib:${style}:bass:1`);
      expect(sel.x).toBeLessThan(0.5);   // it did travel
    });

    it('forgets its starting line when the speed goes back to OFF', () => {
      // 'free' counts from where the lanes were when the journey began. Keeping
      // that after the journey ends would make the NEXT one start somewhere the
      // user cannot see.
      const w = flowing(8, 'free');
      w.advance(BAR_SEC * 2);
      const travelled = posOf(w);
      expect(travelled).toBeGreaterThan(0);
      w.state.flow = { drift: 'free', speedBars: 0 };
      w.advance(BAR_SEC * 3);
      expect(posOf(w)).toBe(travelled);
    });
  });

  it('a default weave CLEARS a travelling one — this is what New Session does', () => {
    // The weave lives beside the session rather than inside it, so
    // replaceSession alone left the previous scene's macros, its master flow and
    // its speed alive: a "new" session that was already travelling. Seen in the
    // browser — New Session came up with Drift Offset and Speed 8 bars still
    // set, from a scene that no longer existed.
    const w = wiring(session());
    w.state.macros.energy = 0.94;
    w.state.flow = { drift: 'offset', speedBars: 8 };
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0.7 },
      locked: false, harmonyLeader: false,
    };

    w.replace(defaultWeaveState());

    expect(w.state.flow.speedBars).toBe(0);
    expect(w.state.flow.drift).toBe('together');
    expect(w.state.macros.energy).toBe(0.5);
    expect(w.state.lanes.lane1).toBeUndefined();
  });

  it('leaves the lane untouched when its loops no longer exist', () => {
    // A save from another machine, or a deleted clip. Silence would be worse
    // than ignoring the weave.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:gone', b: 'clip:alsoGone', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')).toBeUndefined();
  });
});

// The step row is the LAST unpinned link of a chain whose every other link has
// a test: writeStep -> applyPlaybackUnmountedWrite -> applyAutomationToSession
// -> engine.setBaseValue -> worklet.setParams -> VoiceManager's live bag, which
// live-params.dsp.test.ts proves moves the note already sounding. This closes
// the near end. It also settles a question left open in the commit that added
// the row: two browser attempts read "no change" and both were the measurement
// failing (soloing the lane took the master to silence), not the code.
describe('the step row moves a parameter in time with the bar', () => {
  // 4/4 at the default 120bpm: one bar is exactly 2 seconds, so each of four
  // steps owns half a second and the assertions can name instants, not windows.
  const BAR_SEC = 2;
  const VALUES = [0, 0.25, 0.5, 1];

  function row(on = true, destId = 'lane1.filter.cutoff') {
    const writes: Array<[string, number]> = [];
    const w = wiring(session(), (id, v) => { writes.push([id, v]); });
    w.state.steps = [{ destId, values: [...VALUES], mode: 'hold', on }];
    return { w, writes };
  }

  it('writes the value under the playhead, stepping with the bar', () => {
    const { w, writes } = row();
    for (const t of [0, 0.5, 1, 1.5, 2]) w.advance(t);

    expect(writes.map(([, v]) => v)).toEqual([0, 0.25, 0.5, 1, 0]);
    expect(writes.every(([id]) => id === 'lane1.filter.cutoff')).toBe(true);
  });

  it('does not rewrite while the playhead sits on the same step', () => {
    // The row is ticked once per frame; a write per frame would be sixty
    // identical values a second reaching the engine for no reason.
    const { w, writes } = row();
    w.advance(0.5);
    w.advance(0.6);
    w.advance(0.9);

    expect(writes).toHaveLength(1);
  });

  it('off means off — the row is the one control that keeps writing unattended', () => {
    const { w, writes } = row(false);
    for (const t of [0, 0.5, 1]) w.advance(t);

    expect(writes).toHaveLength(0);
  });

  it('a shape with nowhere to land writes nothing', () => {
    // You sketch the curve first and choose the destination after, so an empty
    // destId is an ordinary state and not an error.
    const { w, writes } = row(true, '');
    for (const t of [0, 0.5, 1]) w.advance(t);

    expect(writes).toHaveLength(0);
  });

  it('unplugging WEAVE stops the row too', () => {
    // Bypass has to mean the whole panel. A row that went on writing a cutoff
    // while the switch said off is exactly the "am I sure it is not sounding?"
    // doubt the switch exists to remove.
    const { w, writes } = row();
    w.advance(0);
    w.state.bypass = true;
    for (const t of [0.5, 1, 1.5]) w.advance(t);

    expect(writes).toHaveLength(1);
  });

  it('runs while the flow sits at Off — they are different jobs', () => {
    // Moving a parameter in time with the loop and moving the loops themselves
    // are separate; the row must not need the flow travelling to work.
    const { w, writes } = row();
    expect(w.state.flow.speedBars).toBe(0);
    for (const t of [0, BAR_SEC / 4]) w.advance(t);

    expect(writes.map(([, v]) => v)).toEqual([0, 0.25]);
  });
});

// The blend walks pitches in scale DEGREES, and the conversion measures a note's
// distance from the scale root sitting at `octaveBase` — which is a MIDI number,
// not an octave index. This file passed 3, the only such value in the codebase:
// every other caller passes a real MIDI (36, 48, 60). With 3 the distance lands
// between the scale's intervals, the degree lookup fails, and the note comes out
// somewhere else entirely. Heard as "scene 2 nunca se escucha limpio".
describe('the weave does not transpose what it folds', () => {
  const both = (): SessionState => ({
    lanes: [{
      id: 'lane1',
      engineId: 'subtractive',
      clips: [
        // The SAME onset on both sides, so the fold actually converts a pitch —
        // the fixture above deliberately shares no onsets and never would.
        { id: 'clipA', name: 'A', color: '#fff', lengthBars: 1, notes: [hit(0, 45)], gridResolution: '1/16' },
        { id: 'clipB', name: 'B', color: '#fff', lengthBars: 1, notes: [hit(0, 52)], gridResolution: '1/16' },
      ],
      inserts: [],
    }],
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState);

  const at = (x: number) => {
    const w = wiring(both());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x },
      locked: false, harmonyLeader: false,
    };
    return w.notesFor('lane1')!()!.map((n) => n.midi);
  };

  it('hands back A\'s own pitch at one end', () => {
    expect(at(0)).toEqual([45]);
  });

  it('and B\'s own pitch at the other', () => {
    expect(at(1)).toEqual([52]);
  });

  it('and stays BETWEEN them in the middle, never outside', () => {
    const mid = at(0.5)[0];
    expect(mid).toBeGreaterThanOrEqual(45);
    expect(mid).toBeLessThanOrEqual(52);
  });
});

// "siempre hemos hablado que el bajo manda" — and it never did. The machinery
// was written, tested and never called: `createWeaveNotes` had no caller outside
// its own test file, and nothing anywhere set `harmonyLeader`, so the rule that
// keeps a lane off the notes that grate against the bass has been dead since it
// was written.
//
// The leader is now chosen by EAR rather than by a flag: whichever weaving lane
// is playing the lowest note is the one the others defer to. That is what "the
// bass leads" means without asking anyone to mark it, and it follows the music
// — swap the bass line for something higher and the leadership moves with it.
describe('the lowest lane leads, and the others keep off its worst intervals', () => {
  const twoLanes = (lowMidi: number, highMidi: number): SessionState => ({
    lanes: ['low', 'high'].map((id) => ({
      id,
      engineId: 'subtractive',
      clips: [
        { id: `${id}A`, name: 'A', color: '#fff', lengthBars: 1, gridResolution: '1/16',
          notes: [hit(0, id === 'low' ? lowMidi : highMidi)] },
        { id: `${id}B`, name: 'B', color: '#fff', lengthBars: 1, gridResolution: '1/16',
          notes: [hit(0, id === 'low' ? lowMidi : highMidi)] },
      ],
      inserts: [],
    })),
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY, key: 0, scale: 'minor' },
  } as unknown as SessionState);

  const weaving = (w: ReturnType<typeof wiring>, id: string) => {
    w.state.lanes[id] = {
      weave: { kind: 'ab', a: `clip:${id}A`, b: `clip:${id}B`, x: 0 },
      locked: false, harmonyLeader: false,
    };
  };

  /** What the HIGH lane ends up playing, with a bass note under it. */
  const highNote = (lowMidi: number, highMidi: number): number => {
    const w = wiring(twoLanes(lowMidi, highMidi));
    weaving(w, 'low');
    weaving(w, 'high');
    return w.notesFor('high')!()![0].midi;
  };

  it('nudges a MINOR SECOND above the bass off the clash', () => {
    // C2 under C#4: a semitone apart within the octave, which is the interval
    // that grates hardest of the three.
    expect(highNote(36, 61)).not.toBe(61);
  });

  it('nudges a TRITONE off it too', () => {
    expect(highNote(36, 66)).not.toBe(66);
  });

  it('leaves a consonant note exactly where the author wrote it', () => {
    // A fifth above the bass. The rule is deliberately less than harmony: it
    // forbids what grates and touches nothing else.
    expect(highNote(36, 67)).toBe(67);
  });

  it('never moves the LEADER — it is the reference, not a participant', () => {
    // Moving it would make the rule chase its own tail: a lane adjusting to a
    // root that adjusts to the lane.
    const w = wiring(twoLanes(36, 61));
    weaving(w, 'low');
    weaving(w, 'high');
    expect(w.notesFor('low')!()![0].midi).toBe(36);
  });

  it('follows the music: whoever is lowest leads, not whoever is first', () => {
    // The lanes are declared low-then-high; here the SECOND one is lower, and
    // the rule has to notice.
    const w = wiring(twoLanes(61, 36));
    weaving(w, 'low');
    weaving(w, 'high');
    expect(w.notesFor('high')!()![0].midi).toBe(36);   // the actual bass, untouched
    expect(w.notesFor('low')!()![0].midi).not.toBe(61);
  });

  it('does nothing at all when only one lane is weaving', () => {
    // Nothing to clash WITH. A lane on its own must sound exactly as its author
    // wrote it, whatever notes that is.
    const w = wiring(twoLanes(36, 61));
    weaving(w, 'high');
    expect(w.notesFor('high')!()![0].midi).toBe(61);
  });
});

// The harmony has never moved. A session picks a key once and stays there for
// ever, which is what "no va a ningun lado" was: busy for two minutes and still
// standing in the same place.
describe('the scene walks a chord progression', () => {
  const oneLane = (): SessionState => ({
    lanes: [{
      id: 'lane1',
      engineId: 'subtractive',
      clips: [
        { id: 'clipA', name: 'A', color: '#fff', lengthBars: 1, gridResolution: '1/16',
          notes: [hit(0, 45)] },                                   // A2, the tonic
        { id: 'clipB', name: 'B', color: '#fff', lengthBars: 1, gridResolution: '1/16',
          notes: [hit(0, 45)] },
      ],
      inserts: [],
    }],
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY, key: 9, scale: 'minor' },
  } as unknown as SessionState);

  const woven = (progression: string, atBar: number): number => {
    const w = createWeaveWiring({
      getLaneStates: () => new Map<string, LanePlayState>(),
      getMeter: () => DEFAULT_METER,
      getBpm: () => 120,
      getState: oneLane,
    });
    w.state.progression = progression;
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    w.advance(atBar * 2);        // one bar is 2s at 120bpm in 4/4
    w.invalidate();
    return w.notesFor('lane1')!()![0].midi;
  };

  it('stands still on the static progression, which is the default', () => {
    // Loom as it always was, and now something the user chose rather than
    // something nobody wrote.
    for (const bar of [0, 1, 2, 3]) expect(woven('static', bar)).toBe(45);
  });

  it('moves the material onto the chord the bar is under', () => {
    // Two chords, two bars each: the first two bars are home and the next two
    // are somewhere else.
    expect(woven('i-VI', 0)).toBe(45);
    expect(woven('i-VI', 2)).not.toBe(45);
  });

  it('keeps every note in the key while it moves them', () => {
    // Diatonic transposition, not a semitone shift: the whole reason a
    // progression is stored in degrees.
    for (const bar of [0, 1, 2, 3]) {
      expect(inScale(woven('i-VI-III-VII', bar), 9, 'minor')).toBe(true);
    }
  });

  it('walks the SESSION\'s bars, not the clip\'s own', () => {
    // A one-bar clip under a four-chord progression has to hear all four
    // chords. Anchored to the clip it would restart every bar and only the
    // first chord would ever sound.
    const heard = new Set([0, 1, 2, 3].map((bar) => woven('i-VI-III-VII', bar)));
    expect(heard.size).toBeGreaterThan(2);
  });
});
