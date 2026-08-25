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
import {
  registerEngineCapabilities, unregisterEngineCapabilities,
} from '../plugins/capabilities';
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



describe('a chordal lane is voiced after the progression', () => {
  // The trap this guards is the one the file header is about: avoidClash was
  // written, tested and never called. `revoiceChords` has its own unit tests in
  // core/harmony-revoice.test.ts; what only THIS level can say is that the
  // wiring reaches it, and reaches it for the right lanes.
  const TRIAD = [72, 75, 79];        // A minor, two octaves above the pad register

  function padSession(role?: 'pad'): SessionState {
    const clip = {
      id: 'clipA', name: 'A', color: '#fff', lengthBars: 1, gridResolution: '1/16',
      notes: TRIAD.map((midi) => ({ start: 0, duration: BAR, midi, velocity: 100 })),
    };
    return {
      lanes: [{ id: 'lane1', engineId: 'subtractive', role, clips: [clip, clip], inserts: [] }],
      scenes: [],
      musicality: { ...DEFAULT_MUSICALITY, key: 9, scale: 'minor' },
    } as unknown as SessionState;
  }

  const played = (role?: 'pad'): number[] => {
    const w = wiring(padSession(role));
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipA', x: 0 },
      locked: false, harmonyLeader: false,
    };
    return (w.notesFor('lane1')!() ?? []).map((n) => n.midi).sort((a, b) => a - b);
  };

  it('brings a lane marked Pad down into the pad register', () => {
    // Written two octaves high on purpose: the shift a progression applies lands
    // a chord wherever it lands, and nothing downstream used to pull it back.
    const pad = played('pad');
    const unmarked = played();
    expect(Math.abs(pad[0] - 48)).toBeLessThan(Math.abs(unmarked[0] - 48));
  });

  it('leaves an UNMARKED lane exactly as it was', () => {
    // The escape hatch, at this level too: a lane nobody marked plays what its
    // loops say, note for note.
    expect(played()).toEqual(TRIAD);
  });

  it('plays the same chord it was handed', () => {
    const classes = (ms: number[]) => [...new Set(ms.map((m) => ((m % 12) + 12) % 12))].sort();
    expect(classes(played('pad'))).toEqual(classes(TRIAD));
  });
});

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

  it('stops naming the loop once the lane has a SOUND fader', () => {
    // Either the loop chooses the instrument or the fader does, never both.
    //
    // The tag pins a note to the layer its loop came from, which is one way to
    // use a rack. A sound fader is the other: it wants every note to reach BOTH
    // instruments so their gains can balance them, and `pickLayers` only does
    // that for a note carrying no index. Both at once is incoherent — a note
    // cannot be pinned to layer 0 and also balanced across two.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')!()![0].layerIndex).toBe(0);

    w.state.lanes.lane1.sound = 0.5;
    w.invalidate();
    expect(w.notesFor('lane1')!()![0].layerIndex).toBeUndefined();
  });

  it('keeps weaving the same NOTES whatever the sound fader says', () => {
    // The two axes are independent, and this is the assertion that says so: the
    // fader changes what the notes are played on, never which notes they are.
    const w = wiring(session());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 1 },
      locked: false, harmonyLeader: false,
    };
    const before = w.notesFor('lane1')!()!.map((n) => n.midi);

    w.state.lanes.lane1.sound = 1;
    w.invalidate();
    expect(w.notesFor('lane1')!()!.map((n) => n.midi)).toEqual(before);
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
      // ONE session, held: `() => session()` built a fresh one on every
      // read, so anything a test wrote to it was thrown away by the next.
      const s = session();
      const w = Object.assign(createWeaveWiring({
        getLaneStates: () => new Map<string, LanePlayState>(),
        getMeter: () => DEFAULT_METER,
        getBpm: () => 120,
        getState: () => s,
      }), { session: s });
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

    it('reports where the chord walk is, from the fold s own cursor', () => {
      // Never recomputed by whoever draws it: a readout counting its own bars
      // eventually disagrees with the music by one, which is the most confusing
      // thing a position display can do.
      const w = flowing(0);
      w.session.musicality.progression = 'i-VI-III-VII';
      w.advance(BAR_SEC * 2);
      expect(w.chordNow()).toEqual({ bar: 2, bars: 4, degree: 2 });
      w.advance(BAR_SEC * 5);
      expect(w.chordNow()).toMatchObject({ bar: 1, degree: 5 });
    });

    it('keeps the chords walking under the master lock', () => {
      // The invariant: a lock freezes MATERIAL, never HARMONY.
      const w = flowing(8);
      w.session.musicality.progression = 'i-VI-III-VII';
      w.state.locked = true;
      w.advance(BAR_SEC * 2);
      expect(posOf(w)).toBe(0);
      expect(w.chordNow()).toMatchObject({ bar: 2 });
    });

    it('says nothing rather than "home" when nothing is walking', () => {
      // 'static' IS a lap of one bar on the tonic, which is a different answer
      // from having no progression at all.
      const w = flowing(0);
      w.advance(0);
      expect(w.chordNow()).toEqual({ bar: 0, bars: 1, degree: 0 });
    });

    it('prints a LAP of the progression, not the bar it was standing on', () => {
      // One bar captured a quarter of a four-chord progression -- and the
      // quarter you happened to be on, so pressing the button twice gave two
      // different scenes.
      const w = flowing(0);
      w.session.musicality.progression = 'i-VI-III-VII';
      expect(w.lapNotes().bars).toBe(4);
    });

    it('is one bar with no progression, which is what it always did', () => {
      const w = flowing(0);
      expect(w.lapNotes().bars).toBe(1);
    });

    it('lays the repetitions end to end instead of on top of each other', () => {
      // A two-bar lane under a four-bar progression is folded twice: once
      // hearing chords 1-2 and once 3-4. Stacked at the same offsets it would
      // be two bars of doubled notes rather than four bars of music.
      const w = flowing(0);
      w.session.musicality.progression = 'i-VI-III-VII';
      const { bars, byLane } = w.lapNotes();
      const notes = byLane.get('lane1') ?? [];
      expect(notes.length).toBeGreaterThan(0);
      const lapTicks = bars * BAR;
      for (const n of notes) {
        expect(n.start).toBeGreaterThanOrEqual(0);
        // Nothing hangs past the end: a note starting in the last bar belongs
        // to the NEXT lap, not to the beginning of this one.
        expect(n.start).toBeLessThan(lapTicks);
      }
      expect(Math.max(...notes.map((n) => n.start))).toBeGreaterThanOrEqual(lapTicks / 2);
    });

    it('writes PLAIN notes — a printed scene keeps no routing index', () => {
      // A woven note carries `layerIndex`: the loop it survived from, which a
      // LAYERS lane reads as which of its instruments plays it. That is right
      // while the weave is running and wrong the moment it is written down —
      // a printed clip is ordinary notes you edit, and one still naming a rack
      // slot would go on routing itself after that rack was changed or emptied.
      const w = flowing(0);
      w.session.musicality.progression = 'i-VI-III-VII';
      const { byLane } = w.lapNotes();
      const all = [...byLane.values()].flat();
      expect(all.length).toBeGreaterThan(0);
      for (const n of all) {
        expect(Object.hasOwn(n, 'layerIndex'), `note at ${n.start} still carries layerIndex`).toBe(false);
      }
    });

    it('leaves the cursor exactly where it found it', () => {
      // Walking the lap moves the bar cursor. Left where the loop stopped, the
      // next scheduler tick would fold against the wrong chord.
      const w = flowing(0);
      w.session.musicality.progression = 'i-VI-III-VII';
      w.advance(BAR_SEC * 1);
      const before = w.chordNow();
      w.lapNotes();
      expect(w.chordNow()).toEqual(before);
    });

    it('stands still under the master lock, however fast the journey', () => {
      // Keep the arrangement I have. The clock carries on; the loops do not.
      const w = flowing(8);
      w.state.locked = true;
      w.advance(BAR_SEC * 4);
      expect(posOf(w)).toBe(0);
    });

    it('lets the step rack keep writing under the lock', () => {
      // A lock freezes MATERIAL. The step rack moves a PARAMETER in time with
      // the loop, which is a sound moving rather than an arrangement changing —
      // the same reason the chord progression carries on underneath it.
      const written: number[] = [];
      const w = createWeaveWiring({
        getLaneStates: () => new Map<string, LanePlayState>(),
        getMeter: () => DEFAULT_METER,
        getBpm: () => 120,
        getState: () => session(),
        writeStep: (_id, v) => written.push(v),
      });
      w.state.locked = true;
      w.state.steps = [{ destId: 'lane1.filter.cutoff', values: [0, 1], mode: 'hold', on: true }];
      w.advance(0);
      w.advance(BAR_SEC * 1.5);
      expect(written).toHaveLength(2);
    });

    it('travels again once the lock is let go', () => {
      const w = flowing(8);
      w.state.locked = true;
      w.advance(BAR_SEC * 4);
      w.state.locked = false;
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
    // ONE session, held: `getState: oneLane` built a fresh one on every read,
    // so the progression set below never reached the wiring that read it.
    const s = oneLane();
    const w = createWeaveWiring({
      getLaneStates: () => new Map<string, LanePlayState>(),
      getMeter: () => DEFAULT_METER,
      getBpm: () => 120,
      getState: () => s,
    });
    s.musicality.progression = progression;
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

describe('the fan keeps turning, whatever EVOLVE says', () => {
  // Reported from the app: "las lanes no avanzan correctamente cuando estan en
  // offset, se paran y luego recontinuan de golpe".
  //
  // The journey's geometry used to be keyed off EVOLVE: with it OFF the flow
  // CLAMPED instead of wrapping. In `together` that is a clean ending — the
  // whole scene arrives at the far end and stops. In `offset` the lanes are
  // spread ACROSS the journey, so the one that starts nearest the end arrives
  // first and parks at 1, then the next, then the next: the fan collapses onto
  // B one lane at a time and every parked lane lurches back together when the
  // flow laps.
  //
  // STATIC means "do not change my loops" — that is the re-hook, and it stays
  // off. It never meant "pile the lanes at the end".
  const BAR_SEC = 2;

  const threeLanes = (): SessionState => ({
    lanes: ['lane1', 'lane2', 'lane3'].map((id) => ({
      id,
      engineId: 'subtractive',
      clips: [
        { id: `${id}A`, name: 'A', color: '#fff', lengthBars: 1, notes: A, gridResolution: '1/16' },
        { id: `${id}B`, name: 'B', color: '#fff', lengthBars: 1, notes: B, gridResolution: '1/16' },
      ],
      inserts: [],
    })),
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState);

  /** Three fanned lanes travelling a four-bar lap, with EVOLVE off. */
  const fanned = () => {
    const state = threeLanes();
    const w = createWeaveWiring({
      getLaneStates: () => new Map<string, LanePlayState>(),
      getMeter: () => DEFAULT_METER,
      getBpm: () => 120,
      getState: () => state,
    });
    for (const l of state.lanes) {
      w.state.lanes[l.id] = {
        weave: { kind: 'ab', a: `clip:${l.id}A`, b: `clip:${l.id}B`, x: 0 },
        locked: false, harmonyLeader: false,
      };
    }
    w.state.flow = { drift: 'offset', speedBars: 4, evolve: false };
    return { w, ids: state.lanes.map((l) => l.id) };
  };

  const posOf = (w: ReturnType<typeof createWeaveWiring>, id: string) =>
    (w.state.lanes[id]!.weave as { x: number }).x;

  it('never parks a lane at the far end while the others travel', () => {
    // The symptom, stated as the thing it is: a position of exactly 1 is a lane
    // that has stopped, and in a fan the others are still going.
    const { w, ids } = fanned();
    for (let bar = 0; bar <= 8; bar += 0.25) {
      w.advance(BAR_SEC * bar);
      for (const id of ids) expect(posOf(w, id)).toBeLessThan(1);
    }
  });

  it('keeps every lane MOVING across a whole lap', () => {
    // The stall, measured: a parked lane reports the same position tick after
    // tick while the flow advances.
    const { w, ids } = fanned();
    const seen = new Map(ids.map((id) => [id, new Set<number>()]));
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      w.advance(BAR_SEC * (i * 0.25));
      for (const id of ids) seen.get(id)!.add(Number(posOf(w, id).toFixed(4)));
    }
    for (const id of ids) expect(seen.get(id)!.size).toBe(steps);
  });

  it('holds the fan s spacing all the way round', () => {
    // What 'offset' MEANS: evenly spread, and staying that way. Clamping
    // collapsed the spacing to zero as each lane hit the end.
    const { w, ids } = fanned();
    w.advance(BAR_SEC * 2.5);
    const gap = (a: string, b: string) => ((posOf(w, b) - posOf(w, a)) % 1 + 1) % 1;
    expect(gap(ids[0], ids[1])).toBeCloseTo(1 / 3, 5);
    expect(gap(ids[1], ids[2])).toBeCloseTo(1 / 3, 5);
  });

  it('still refuses to re-hook while STATIC — the loops are untouched', () => {
    // The half of STATIC that is real: the pair the user chose is the pair they
    // keep, however many laps the fan turns.
    const { w, ids } = fanned();
    const pairs = ids.map((id) => JSON.stringify(w.state.lanes[id]!.weave));
    for (let bar = 0; bar <= 12; bar += 0.5) w.advance(BAR_SEC * bar);
    ids.forEach((id, i) => {
      const now = w.state.lanes[id]!.weave as { a: string; b: string };
      const was = JSON.parse(pairs[i]) as { a: string; b: string };
      expect([now.a, now.b]).toEqual([was.a, was.b]);
    });
  });
});

describe('a lane in its own register', () => {
  // The same idea as the lane tempo and for the same reason: the same part,
  // somewhere it fits, without a note of the session's material being rewritten.
  const NOTES = [hit(0, 60), hit(4, 62), hit(8, 64)];

  function octSession(engineId = 'subtractive'): SessionState {
    const clip = {
      id: 'clipA', name: 'A', color: '#fff', lengthBars: 1, gridResolution: '1/16',
      notes: NOTES,
    };
    return {
      lanes: [{ id: 'lane1', engineId, clips: [clip, clip], inserts: [] }],
      scenes: [],
      musicality: { ...DEFAULT_MUSICALITY },
    } as unknown as SessionState;
  }

  const pitches = (octave?: number, engineId?: string) => {
    const w = wiring(octSession(engineId));
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipA', x: 0 },
      locked: false, harmonyLeader: false, octave,
    };
    return (w.notesFor('lane1')!() ?? []).map((n) => n.midi).sort((a, b) => a - b);
  };

  it('moves the whole phrase down twelve semitones an octave', () => {
    expect(pitches(-1)).toEqual(pitches().map((m) => m - 12));
  });

  it('and up, by the same twelve', () => {
    expect(pitches(2)).toEqual(pitches().map((m) => m + 24));
  });

  it('keeps every note — the phrase moves, it does not thin out', () => {
    expect(pitches(3)).toHaveLength(pitches().length);
  });

  it('leaves a percussion lane exactly where it was', () => {
    // A drum note picks a VOICE, not a pitch, so an octave on a drum lane would
    // change the instrument rather than the register.
    registerEngineCapabilities('drums-machine', {
      harmonic: false, clipContent: 'notes', shortLabel: 'DR', outputTrim: 1,
    });
    try {
      expect(pitches(-2, 'drums-machine')).toEqual(pitches(0, 'drums-machine'));
    } finally {
      unregisterEngineCapabilities('drums-machine');
    }
  });

  it('reaches PRINT, so the scene you capture is the scene you heard', () => {
    // Being in the FOLD is what buys this: lapNotes reads the same sources, so
    // an octave applied at the scheduler instead would have PRINT quietly
    // writing the un-shifted phrase.
    const w = wiring(octSession());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipA', x: 0 },
      locked: false, harmonyLeader: false, octave: -1,
    };
    const printed = w.lapNotes().byLane.get('lane1') ?? [];
    expect(printed.length).toBeGreaterThan(0);
    expect(Math.min(...printed.map((n) => n.midi))).toBe(Math.min(...pitches()) - 12);
  });
});

describe('a lane at its own tempo', () => {
  // The ×2 / ÷2 buttons used to change only the ROOM — the carrier clip's bar
  // count — which on a weaving lane is inaudible: the fold refills whatever
  // space there is, so you got a bigger room and the same phrase. Reported as
  // "no veo diferencia al pulsarlos".
  const NOTES = [hit(0, 60), hit(4, 62), hit(8, 64)];

  function timedSession(): SessionState {
    const clip = {
      id: 'clipA', name: 'A', color: '#fff', lengthBars: 1, gridResolution: '1/16',
      notes: NOTES,
    };
    return {
      lanes: [{ id: 'lane1', engineId: 'subtractive', clips: [clip, clip], inserts: [] }],
      scenes: [],
      musicality: { ...DEFAULT_MUSICALITY },
    } as unknown as SessionState;
  }

  const played = (timeScale?: number) => {
    const w = wiring(timedSession());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipA', x: 0 },
      locked: false, harmonyLeader: false, timeScale,
    };
    return (w.notesFor('lane1')!() ?? []).slice().sort((a, b) => a.start - b.start);
  };

  it('stretches the phrase at half time', () => {
    // Delivered WHOLE, not half of it twice: every note is still there and the
    // last one lands twice as far in.
    const plain = played();
    const half = played(2);
    expect(half).toHaveLength(plain.length);
    expect(half[half.length - 1].start).toBe(plain[plain.length - 1].start * 2);
  });

  it('lengthens the notes with it, rather than leaving gaps', () => {
    expect(played(2)[0].duration).toBe(played()[0].duration * 2);
  });

  it('packs it at double time', () => {
    const plain = played();
    const dbl = played(0.5);
    expect(dbl).toHaveLength(plain.length);
    expect(dbl[dbl.length - 1].start).toBe(plain[plain.length - 1].start / 2);
  });

  it('leaves a lane at 1 exactly as it was', () => {
    // The escape hatch: absent or 1 must be bit-identical, or every existing
    // session moves the day this ships.
    expect(played(1)).toEqual(played());
  });

  it('reaches PRINT, so the scene you capture is the scene you heard', () => {
    // lapNotes reads the same folds. If the tempo lived at the scheduler
    // instead, PRINT would quietly write the un-stretched phrase.
    const w = wiring(timedSession());
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipA', x: 0 },
      locked: false, harmonyLeader: false, timeScale: 2,
    };
    const printed = w.lapNotes().byLane.get('lane1') ?? [];
    const plain = played();
    expect(printed.length).toBeGreaterThan(0);
    expect(Math.max(...printed.map((n) => n.duration)))
      .toBe(Math.max(...plain.map((n) => n.duration)) * 2);
  });
});
