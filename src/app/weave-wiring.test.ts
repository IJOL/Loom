// The wiring had no test, and a browser check said why it needed one: with a
// weave configured, both ends of the crossfade sounded identical — which is what
// "no gate at all" looks like from the outside.
import { describe, it, expect } from 'vitest';
import { createWeaveWiring } from './weave-wiring';
import { defaultWeaveState } from '../weave/weave-state';
import { setLibrary } from '../patterns/pattern-library';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { DEFAULT_METER, ticksPerBar } from '../core/meter';
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

function wiring(state: SessionState) {
  return createWeaveWiring({
    getLaneStates: () => new Map<string, LanePlayState>(),
    getMeter: () => DEFAULT_METER,
    getState: () => state,
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

  it('carries no layer on a lane whose instrument has none', () => {
    const w = wiring(session('subtractive'));
    w.state.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:clipA', b: 'clip:clipB', x: 0 },
      locked: false, harmonyLeader: false,
    };
    expect(w.notesFor('lane1')!()![0].layerIndex).toBeUndefined();
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

    const flowing = (speedBars: number, drift: 'together' | 'offset' | 'free' = 'together') => {
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
      w.state.flow = { drift, speedBars };
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

    it('re-hooks onto a fresh loop when a lap completes', () => {
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
        const w = flowing(4);
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
