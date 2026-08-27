// The panel's ONLY way into the host, and it had no test — which mattered the
// moment it stopped being read-only. A panel plugin is compiled separately and
// cannot be typechecked against this file, so every promise here is one only a
// test can keep.
import { describe, it, expect, vi } from 'vitest';
import { createPanelContext } from './panel-context';
import { defaultWeaveState } from '../weave/weave-state';
import { DEFAULT_METER } from '../core/meter';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { setLibrary } from '../patterns/pattern-library';
import {
  registerEngineCapabilities, unregisterEngineCapabilities,
} from '../plugins/capabilities';
import type { SessionState } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';
import type { MusicalityState } from '../session/session-types';

const lane = (id: string) => ({
  id, engineId: 'subtractive', name: id, clips: [], inserts: [],
});

function harness(
  laneIds: string[] = ['lane1', 'lane2'],
  opts: { addLane?: boolean } = {},
) {
  const state = {
    lanes: laneIds.map(lane),
    // One row, the way onAddLane's ensureScenesForRows leaves it.
    scenes: [{ id: 'scene1', name: 'Scene 1', clipPerLane: {} as Record<string, number | null> }],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState;

  const written: MusicalityState[] = [];
  const added: string[] = [];
  const weave = defaultWeaveState();
  const changed: string[] = [];
  const stops: number[] = [];
  // What the destination catalogue offers. Empty is the ordinary lane: no
  // `l0.gain`, so a sound fader has nothing to write until the lane is a rack.
  const destIds: string[] = [];
  const converted: { laneId: string; slots?: number }[] = [];
  // `refresh` REMOUNTS the panel, so counting it is counting how often every
  // control in the row is destroyed and rebuilt.
  const refreshes: number[] = [];

  // A fixture with no callbacks stands in for a host that refuses — the panel
  // has to tell the difference rather than report a lane id that names nothing.
  const callbacks = opts.addLane === false ? {} : {
    onAddLane: (engineId: string) => {
      added.push(engineId);
      state.lanes.push(lane(`new${state.lanes.length + 1}`) as never);
    },
    onConvertToLayered: (laneId: string, o?: { slots?: number }) => {
      converted.push({ laneId, slots: o?.slots });
    },
  };

  const ctx = createPanelContext({
    sessionHost: {
      state,
      laneStates: new Map<string, LanePlayState>(),
      renderWithMixer: () => {},
      callbacks,
    } as never,
    seq: { bpm: 128, meter: DEFAULT_METER, isPlaying: () => false } as never,
    ctx: { currentTime: 0 } as never,
    weave,
    refresh: () => { refreshes.push(1); },
    onWeaveChanged: (id) => changed.push(id),
    setMusicality: (m) => { written.push(m); state.musicality = m; },
    stopTransport: () => { stops.push(1); },
    destinations: () => destIds.map((id) => ({ id })) as never,
  });

  return { ctx, state, weave, written, added, changed, stops, destIds, converted, refreshes };
}

/** Run `fn` with a two-pattern library installed for the default style, then put
 *  the library back. Two, because that is the fewest that can be the two ends of
 *  a crossfade — the point of the test is WHICH ids get picked, not what they
 *  sound like. */
function withLibrary(fn: () => void, count = 2): void {
  const step = (semi: number) => ({ semi, vel: 0.8, slide: false });
  const style = DEFAULT_MUSICALITY.style;
  const two = [[step(0), null, step(7), null], [step(3), step(5), null, null]];
  // Above two, the shelf grows with patterns that differ only in pitch: a test
  // about WHICH id gets drawn needs a third the selection does not already name,
  // and nothing here listens to them.
  const more = Array.from({ length: Math.max(0, count - two.length) },
    (_, i) => [step(2 + i), null, null, step(9)]);
  setLibrary({
    synth: {}, drums: {},
    bass: { [style]: [...two, ...more] },
    catalog: {},
  } as never);
  try { fn(); } finally { setLibrary(null as never); }
}

/** A lane weaving two loops, sitting at `x`. */
const weaving = (x: number) => ({
  weave: { kind: 'ab' as const, a: 'clip:a', b: 'clip:b', x },
  locked: false, harmonyLeader: false,
});

describe('createPanelContext — the project\'s musical ground', () => {
  it('reads the SESSION\'s key, scale and style, not a copy', () => {
    const h = harness();
    h.state.musicality = { key: 5, scale: 'dorian', style: 'house', lock: false };
    const m = h.ctx.musicality();
    expect(m.key).toBe(5);
    expect(m.scale).toBe('dorian');
    expect(m.style).toBe('house');
    expect(m.bpm).toBe(128);
  });

  it('writes through the host\'s ONE musicality path', () => {
    // Not by assigning state.musicality: that path is undoable and repaints the
    // toolbar chip, and a panel writing around it would leave the chip showing
    // one key while the music played another.
    const h = harness();
    h.ctx.setMusicality(7, 'phrygian', 'jungle');
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatchObject({ key: 7, scale: 'phrygian', style: 'jungle' });
  });

  it('carries the harmony lock through untouched', () => {
    // The panel does not show it, so it must not decide it either.
    const h = harness();
    h.state.musicality = { ...DEFAULT_MUSICALITY, lock: true };
    h.ctx.setMusicality(0, 'minor', 'techno');
    expect(h.written[0].lock).toBe(true);
  });

  it('invalidates the weave when the ground moves', () => {
    // Which style each lane draws from just changed, so every loop list and
    // every built source is stale.
    const h = harness();
    h.ctx.setMusicality(2, 'minor', 'techno');
    expect(h.changed).toContain('*');
  });

  // The tempo is READ here and not written: the transport's own BPM input sits
  // on screen above every panel and is already editable, so the ABI carries no
  // setter for it. `musicality().bpm` above is what a panel gets.

  it('offers the twelve roots and every scale', () => {
    const h = harness();
    expect(h.ctx.keys()).toHaveLength(12);
    expect(h.ctx.scales().map((s) => s.id)).toContain('phrygian');
  });
});

describe('createPanelContext — reshuffle', () => {
  it('deals the lane styles again', () => {
    const h = harness();
    const before = h.weave.seed;
    h.ctx.reseed();
    expect(h.weave.seed).not.toBe(before);
    expect(h.changed).toContain('*');
  });

  it('leaves the style MIX alone', () => {
    // How far the lanes may wander is the user's setting. Re-dealing must not
    // quietly widen or narrow it.
    const h = harness();
    h.weave.macros.styleMix = 0.7;
    h.ctx.reseed();
    expect(h.weave.macros.styleMix).toBe(0.7);
  });

  it('a tap deals ONLY the end nobody is hearing', () => {
    // The report: pressing Reshuffle replaced both ends at once, so whatever was
    // sounding stopped mid-phrase. A fifth of the way across the leg, A is four
    // fifths of what you hear — it survives, and B becomes the one loop on the
    // shelf the selection does not already name.
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = {
        weave: { kind: 'ab', a: 'lib:acid-techno:bass:0', b: 'lib:acid-techno:bass:1', x: 0.2 },
        locked: false, harmonyLeader: false,
      };
      h.ctx.reseed();
      expect(h.weave.lanes.lane1!.weave).toEqual({
        kind: 'ab', a: 'lib:acid-techno:bass:0', b: 'lib:acid-techno:bass:2', x: 0.2,
      });
    }, 3);
  });

  it('holding deals the loud end too', () => {
    // The other gesture, and the whole reason the tap can be narrow: when you do
    // want to leave where you are entirely, hold. The loud end here is a CLIP,
    // and the dice deals from the LIBRARY — so a library id in its place is
    // proof the end that was sounding got replaced.
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = {
        weave: { kind: 'ab', a: 'clip:c1', b: 'lib:acid-techno:bass:1', x: 0.2 },
        locked: false, harmonyLeader: false,
      };
      h.ctx.reseed('all');
      const sel = h.weave.lanes.lane1!.weave as { a: string; x: number };
      expect(sel.a.startsWith('lib:')).toBe(true);
      // And still exactly where it was in its journey: re-dealing the material
      // must not snap the lane back to the start of the leg.
      expect(sel.x).toBe(0.2);
    }, 3);
  });

  it('obeys the LOCK either way', () => {
    // The lock is the point of the dice — roll, keep what you like, roll again —
    // and the narrower tap must not have quietly become a way round it.
    withLibrary(() => {
      const h = harness(['lane1']);
      const weave = { kind: 'ab' as const, a: 'lib:acid-techno:bass:0', b: 'lib:acid-techno:bass:1', x: 0.2 };
      h.weave.lanes.lane1 = { weave, locked: true, harmonyLeader: false };
      h.ctx.reseed();
      h.ctx.reseed('all');
      expect(h.weave.lanes.lane1!.weave).toEqual(weave);
    }, 3);
  });
});

describe('createPanelContext — the sound fader', () => {
  it('builds the rack it needs, one slot per end of the control', () => {
    // Reported as a control that did nothing: the fader writes `l0.gain` and
    // `l1.gain`, an ordinary lane has neither, so every write was skipped in
    // silence — while the four steps that would have made it work lived on
    // another page. Turning it on is now what builds the thing it moves.
    //
    // `slots` and no `contrast`: what the far end HOLDS is the lane's own
    // instrument duplicated, not another engine dealt for you. It asked for a
    // contrasting one until a rack came up with a Sampler in slot 2 — an engine
    // with no renderer in the worklet, so the far end of the fader was silence.
    const h = harness(['lane1']);
    h.ctx.setLaneSound('lane1', 0);
    expect(h.converted).toEqual([{ laneId: 'lane1', slots: 2 }]);
    expect(h.ctx.laneSound('lane1')).toEqual({ x: 0, y: 0 });
  });

  it('leaves a lane that already has the gains alone', () => {
    // A rack the user built by hand, or one converted a moment ago. Converting
    // again would rewrite their two slots with a fresh pair.
    const h = harness(['lane1']);
    h.destIds.push('lane1.l0.gain', 'lane1.l1.gain');
    h.ctx.setLaneSound('lane1', 0.5, 0.75);
    expect(h.converted).toEqual([]);
    expect(h.ctx.laneSound('lane1')).toEqual({ x: 0.5, y: 0.75 });
  });

  it('does not rebuild the row while the control is being MOVED', () => {
    // `refresh` remounts the whole panel, so a rebuild per drag event replaces
    // the element the pointer is holding: a click survived it — one event — and
    // a drag died on the second. Reported as a fader you could not drag, only
    // click.
    const h = harness(['lane1']);
    h.destIds.push('lane1.l0.gain');
    h.ctx.setLaneSound('lane1', 0.1);
    const after = h.refreshes.length;
    for (const x of [0.2, 0.3, 0.4, 0.5]) h.ctx.setLaneSound('lane1', x);
    expect(h.refreshes.length).toBe(after);
  });

  it('DOES rebuild it when the control appears or disappears', () => {
    // Which is the other half of the same rule: turning it on can have made the
    // lane a rack, and the row's instrument and preset dropdowns then point at
    // one. Without the rebuild the slot buttons showed up whenever something
    // else happened to repaint.
    const h = harness(['lane1']);
    h.destIds.push('lane1.l0.gain');
    const before = h.refreshes.length;
    h.ctx.setLaneSound('lane1', 0);
    expect(h.refreshes.length).toBeGreaterThan(before);
    const on = h.refreshes.length;
    h.ctx.setLaneSound('lane1', null);
    expect(h.refreshes.length).toBeGreaterThan(on);
  });

  it('keeps the vertical axis when only the horizontal one is moved', () => {
    // Two controls can move the pad — a drag moves both, a lap of the flow may
    // move one — and either resetting the other would teleport the sound.
    const h = harness(['lane1']);
    h.destIds.push('lane1.l0.gain');
    h.ctx.setLaneSound('lane1', 0.2, 0.9);
    h.ctx.setLaneSound('lane1', 0.6);
    expect(h.ctx.laneSound('lane1')).toEqual({ x: 0.6, y: 0.9 });
  });

  it('reports no slots for an ordinary lane, so its own pickers stand', () => {
    // The lane row asks this to decide whether its instrument and preset
    // dropdowns name the LANE or one of the instruments inside it. An ordinary
    // lane must answer empty, or its own two controls would start pointing at a
    // rack that does not exist.
    const h = harness(['lane1']);
    expect(h.ctx.laneSlots('lane1')).toEqual([]);
  });

  it('never converts on the way OFF', () => {
    // Turning the fader off means "go back to routing each note by the loop it
    // came from". Swapping the lane's instrument on that press would be the
    // opposite of leaving it alone.
    const h = harness(['lane1']);
    h.ctx.setLaneSound('lane1', null);
    expect(h.converted).toEqual([]);
    expect(h.ctx.laneSound('lane1')).toBeNull();
  });
});

describe('createPanelContext — adding a weaving track', () => {
  it('goes through the host\'s add-lane path', () => {
    // Pushing a lane onto the array here would give a row in the grid with no
    // strip and no engine behind it.
    const h = harness([]);
    h.ctx.addLane('subtractive');
    expect(h.added).toEqual(['subtractive']);
  });

  it('arrives already weaving two LIBRARY loops', () => {
    // A track that arrived empty would leave the panel exactly as useless as it
    // was — that is the whole difference from "add a track" in the grid.
    //
    // And never the carrier clip, which is empty by construction: as an end of
    // the crossfade it would make one extreme of the fader silence, which looks
    // exactly like a broken weave. Seen in the browser, not in a test — all
    // three new tracks came up weaving "Weave" -> a library loop.
    withLibrary(() => {
      const h = harness([]);
      const id = h.ctx.addLane('subtractive');
      expect(id).not.toBe('');
      const sel = h.weave.lanes[id]?.weave as { a: string; b: string } | undefined;
      expect(sel?.a.startsWith('lib:')).toBe(true);
      expect(sel?.b.startsWith('lib:')).toBe(true);
    });
  });

  it('weaves NOTHING when the library has no loops for the style', () => {
    // Rather than pressing the empty carrier clip into service. The lane then
    // plays its clip untouched, which is honest — a fader whose one end is
    // silence is not.
    const h = harness([]);
    const id = h.ctx.addLane('subtractive');
    expect(h.weave.lanes[id]).toBeUndefined();
  });

  it('gives it a clip to carry the weave', () => {
    // The weave REPLACES a clip's notes rather than existing beside them, and
    // the scheduler skips a lane with nothing playing — so a track with a weave
    // and no clip is silent however well the weave folds. This is the exact bug
    // "New Session -> add a track -> play" would have shown.
    const h = harness([]);
    const id = h.ctx.addLane('subtractive');
    const made = h.state.lanes.find((l) => l.id === id)!;
    expect(made.clips).toHaveLength(1);
    expect(h.state.scenes[0].clipPerLane[id]).toBe(0);
  });

  it('reports nothing when the host refuses', () => {
    // A fixture with no session callbacks. The caller must be able to tell,
    // rather than reading a lane id that names nothing.
    const h = harness([], { addLane: false });
    expect(h.ctx.addLane('subtractive')).toBe('');
  });
});

describe('createPanelContext — swapping a lane\'s instrument', () => {
  it('re-picks the loops when the shelves move under the lane', () => {
    // A melodic lane reads bass and lead; a drum machine reads drums. A
    // selection left naming bass loops on a drum lane still RESOLVES — the id
    // carries the kind — so it would quietly play a bassline through the drum
    // voices. Nothing about that looks like a bug from the outside.
    withLibrary(() => {
      const h = harness(['lane1']);
      const id = 'lane1';
      h.weave.lanes[id] = {
        weave: { kind: 'ab', a: 'lib:acid-techno:bass:0', b: 'lib:acid-techno:bass:1', x: 0 },
        locked: false, harmonyLeader: false,
      };
      // Declared non-harmonic, the way the drums engine declares itself. The
      // capability door defaults an UNKNOWN id to "ordinary melodic
      // instrument", so a fixture that skipped this would be asserting nothing.
      registerEngineCapabilities('drums-machine', {
        harmonic: false, clipContent: 'notes', shortLabel: 'DR', outputTrim: 1,
      });
      try {
        // The swap itself is the host's; what matters is what happens after.
        h.state.lanes[0].engineId = 'drums-machine';
        h.ctx.setEngine(id, 'drums-machine');
      } finally {
        unregisterEngineCapabilities('drums-machine');
      }
      const sel = h.weave.lanes[id]?.weave as { a: string } | null;
      expect(sel?.a).not.toBe('lib:acid-techno:bass:0');
    });
  });

  it('keeps a selection whose loops are still on offer', () => {
    // Swapping between two melodic engines changes nothing about the shelves,
    // and the loops the user picked are the user's.
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = {
        weave: { kind: 'ab', a: 'lib:acid-techno:bass:0', b: 'lib:acid-techno:bass:1', x: 0.3 },
        locked: false, harmonyLeader: false,
      };
      h.ctx.setEngine('lane1', 'fm');
      const sel = h.weave.lanes.lane1?.weave as { a: string; x: number };
      expect(sel.a).toBe('lib:acid-techno:bass:0');
      expect(sel.x).toBe(0.3);
    });
  });
});

describe('createPanelContext — pointing a lane at another style', () => {
  // It used to re-pick BOTH ends on the spot, and both ends is the problem: the
  // lane cut to two loops it had never been travelling towards, mid-phrase,
  // from wherever the crossfade stood. Reported as "no es musical, debería
  // evolucionar — cambiar el siguiente, no el actual".
  it('leaves the lane playing what it is playing', () => {
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = {
        weave: { kind: 'ab', a: 'lib:acid-techno:bass:0', b: 'lib:acid-techno:bass:1', x: 0.4 },
        locked: false, harmonyLeader: false,
      };

      h.ctx.setLaneStyle('lane1', 'house');

      const sel = h.weave.lanes.lane1?.weave as { a: string; b: string; x: number };
      expect(sel.a).toBe('lib:acid-techno:bass:0');
      expect(sel.b).toBe('lib:acid-techno:bass:1');
      // And it does not jump back to the start of the leg either.
      expect(sel.x).toBe(0.4);
    });
  });

  it('records the style, so the NEXT loop drawn is in it', () => {
    // Which is the whole mechanism: rehookOnArrival draws from the choices as
    // they are NOW, so the lane crosses into the new style the way it crosses
    // into everything else.
    withLibrary(() => {
      const h = harness(['lane1']);
      h.ctx.setLaneStyle('lane1', 'house');
      expect(h.ctx.laneStyle('lane1')).toBe('house');
    });
  });

  it('does NOT orphan the selection', () => {
    // The fault the old immediate re-pick was guarding, kept: reported as
    // "switching Session and Weave loses what I had in cloud". A selection left
    // naming the previous style still RESOLVES — that is what lets the lane go
    // on playing while it waits to arrive — and it must survive a remount.
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = {
        weave: { kind: 'cloud', corners: [0, 1, 2, 3].map((i) => `lib:acid-techno:bass:${i}`), x: 0.5, y: 0.5 },
        locked: false, harmonyLeader: false,
      };

      h.ctx.setLaneStyle('lane1', 'house');

      const sel = h.weave.lanes.lane1?.weave as { corners: string[] } | null;
      expect(sel?.corners).toHaveLength(4);
      expect(sel?.corners[0]).toBe('lib:acid-techno:bass:0');
    });
  });
});


describe('createPanelContext — the lane lock', () => {
  it('round-trips, and survives switching topology', () => {
    // Beside mute and solo rather than inside the weaving control, because it is
    // the same kind of decision — what this one track does while the rest carry
    // on — and rebuilding the cell must not unlock it.
    withLibrary(() => {
      const h = harness(['lane1']);
      h.ctx.setLaneLocked('lane1', true);
      expect(h.ctx.laneLocked('lane1')).toBe(true);
      h.ctx.setLaneTopology('lane1', 'cloud');
      expect(h.ctx.laneLocked('lane1')).toBe(true);
    });
  });

  it('does not invalidate the weave — the lock changes nothing PLAYING', () => {
    // Only whether the flow may move this lane next tick. Invalidating would
    // rebuild every source to fold exactly the same notes.
    const h = harness(['lane1']);
    h.ctx.setLaneLocked('lane1', true);
    expect(h.changed).toEqual([]);
  });
});

describe('createPanelContext — the master flow', () => {
  it('reports where the lanes actually are', () => {
    // Read off the LANES rather than remembered beside the speed: with a journey
    // running the host moves them, and a second number would be the one the
    // panel showed while the music followed the other.
    const h = harness();
    h.weave.lanes.lane1 = weaving(0.4);
    expect(h.ctx.flow().position).toBeCloseTo(0.4);
  });

  it('reads the position off a TRAVELLING lane, not a locked one', () => {
    // Reading the first lane with a selection pinned the master readout to a
    // locked lane: the number sat frozen while the rest of the scene crossed,
    // which reads as a broken control.
    const h = harness();
    h.weave.lanes.lane1 = { ...weaving(0.05), locked: true };
    h.weave.lanes.lane2 = weaving(0.7);
    expect(h.ctx.flow().position).toBeCloseTo(0.7);
  });

  it('falls back to a locked lane when EVERY lane is locked', () => {
    // Then the frozen number is honest — the journey really is moving nothing.
    const h = harness();
    h.weave.lanes.lane1 = { ...weaving(0.05), locked: true };
    expect(h.ctx.flow().position).toBeCloseTo(0.05);
  });

  it('moves every lane at once', () => {
    const h = harness();
    h.weave.lanes.lane1 = weaving(0);
    h.weave.lanes.lane2 = weaving(0);
    h.ctx.setFlow(0.6, 'together', 0, false);
    expect(h.weave.lanes.lane1.weave!.x).toBeCloseTo(0.6);
    expect(h.weave.lanes.lane2.weave!.x).toBeCloseTo(0.6);
  });

  it('fans the lanes out on offset drift', () => {
    const h = harness();
    h.weave.lanes.lane1 = weaving(0);
    h.weave.lanes.lane2 = weaving(0);
    h.ctx.setFlow(0, 'offset', 0, false);
    expect(h.weave.lanes.lane1.weave!.x).not.toBeCloseTo(h.weave.lanes.lane2.weave!.x);
  });

  it('hands the journey to the host when a speed is set', () => {
    // The panel stops driving and starts following: the speed lives in the
    // state the scheduler's tick reads.
    const h = harness();
    h.ctx.setFlow(0.2, 'free', 16, false);
    expect(h.ctx.flow().speedBars).toBe(16);
    expect(h.ctx.flow().drift).toBe('free');
  });

  it('does not compound under a DRAG', () => {
    // Reported as "en free hace cosas raras". A slider sends its ABSOLUTE value
    // on every pointer move, and the lanes are positioned relative to where
    // they already were — so with no fixed starting line every move added to
    // the answer of the last and the lanes ran away. Dragging to 0.3 in ten
    // steps has to land exactly where one step to 0.3 lands.
    const dragged = (steps: number) => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = weaving(0.2);
      for (let i = 1; i <= steps; i++) h.ctx.setFlow((0.3 * i) / steps, 'together', 0, false);
      return h.weave.lanes.lane1.weave!.x;
    };
    expect(dragged(10)).toBeCloseTo(dragged(1), 6);
    // The dial READS the leading lane, so dragging it to 0.3 puts that lane at
    // 0.3 — the number under your finger is the number the scene is on.
    expect(dragged(10)).toBeCloseTo(0.3, 6);
  });

  it('carries the DISTANCE between lanes, whatever the dial does', () => {
    // The complaint this whole model exists for: "los lanes siempre deberían
    // conservar la posición relativa de los knobs de lane". Two lanes a quarter
    // of a lap apart are still a quarter of a lap apart after the master moves.
    const h = harness();
    h.weave.lanes.lane1 = weaving(0.1);
    h.weave.lanes.lane2 = weaving(0.35);
    h.ctx.setFlow(0.5, 'together', 0, false);
    const gap = (a: number, b: number) => ((b - a) % 1 + 1) % 1;
    expect(gap(h.weave.lanes.lane1.weave!.x, h.weave.lanes.lane2.weave!.x))
      .toBeCloseTo(0.25, 6);
  });

  it('lays the lanes out ONCE when the drift mode changes, then carries them', () => {
    // What is left of the three modes: a layout you ask for, not a law enforced
    // against your own hands on every tick.
    const h = harness();
    h.weave.lanes.lane1 = weaving(0.1);
    h.weave.lanes.lane2 = weaving(0.35);
    h.ctx.setFlow(0, 'offset', 0, false);
    expect(h.weave.lanes.lane1.weave!.x).toBeCloseTo(0, 6);
    expect(h.weave.lanes.lane2.weave!.x).toBeCloseTo(0.5, 6);

    // …and from here the fan travels as one, spacing intact.
    h.ctx.setFlow(0.25, 'offset', 0, false);
    expect(h.weave.lanes.lane1.weave!.x).toBeCloseTo(0.25, 6);
    expect(h.weave.lanes.lane2.weave!.x).toBeCloseTo(0.75, 6);
  });

  it('keeps a lane where a HAND put it, and moves it with the rest after', () => {
    // The other half of the same sentence: "si cambias un knob de lane debería
    // conservar el cambio relativo a la posición de los demás loops". Before
    // this, the next thing the flow did wiped the gesture.
    const h = harness();
    h.weave.lanes.lane1 = weaving(0);
    h.weave.lanes.lane2 = weaving(0);
    h.ctx.setFlow(0.2, 'together', 0, false);        // both at 0.2

    h.ctx.setLaneWeave('lane2', { ...h.weave.lanes.lane2.weave!, x: 0.45 });
    h.ctx.setFlow(0.5, 'together', 0, false);        // the dial moves on

    expect(h.weave.lanes.lane1.weave!.x).toBeCloseTo(0.5, 6);
    // 0.25 ahead, exactly as the hand left it.
    expect(h.weave.lanes.lane2.weave!.x).toBeCloseTo(0.75, 6);
  });

  it('asks for no layout at all in free — that is what the mode means', () => {
    // 'free' is the one that says leave them where they are, so picking it must
    // not move anything. It is also where a scene arranged by hand lives.
    const h = harness();
    h.weave.lanes.lane1 = weaving(0.2);
    h.weave.lanes.lane2 = weaving(0.7);
    h.ctx.setFlow(0.2, 'free', 0, false);
    expect(h.weave.lanes.lane1.weave!.x).toBeCloseTo(0.2, 6);
    expect(h.weave.lanes.lane2.weave!.x).toBeCloseTo(0.7, 6);
  });

  it('refuses a nonsense speed rather than storing it', () => {
    const h = harness();
    h.ctx.setFlow(0, 'together', -4, false);
    expect(h.ctx.flow().speedBars).toBe(0);
  });

  it('skips a lane with no loops chosen', () => {
    // Giving it a position would silently start weaving a lane the user never
    // set up.
    const h = harness();
    h.weave.lanes.lane1 = weaving(0);
    h.ctx.setFlow(0.5, 'together', 0, false);
    expect(h.weave.lanes.lane2).toBeUndefined();
  });
});

describe('panel context — the evolve flag', () => {
  it('setFlow carries the evolve flag into the state', () => {
    const h = harness();
    h.ctx.setFlow(0.5, 'together', 0, true);
    expect(h.weave.flow.evolve).toBe(true);
    expect(h.ctx.flow().evolve).toBe(true);
  });

  it('STATIC parks a lane at the end instead of sending it back to the start', () => {
    const h = harness(['lane1']);
    h.weave.lanes.lane1 = weaving(0);
    h.ctx.setFlow(1, 'together', 0, false);
    expect(h.weave.lanes.lane1.weave!.x).toBe(1);
  });

  it('EVOLVE wraps, which is what lets a lane hand over', () => {
    const h = harness(['lane1']);
    h.weave.lanes.lane1 = weaving(0);
    h.ctx.setFlow(1, 'together', 0, true);
    expect(h.weave.lanes.lane1.weave!.x).toBe(0);
  });

  it('a HAND that reaches the far end hands over too', () => {
    // The bug the switch exists to fix, written down: dragging to the end used
    // to wrap back to the start AND leave the pair unchanged — the worst of
    // both. The far end is the far end whoever reached it.
    //
    // TWO calls, because that is what a gesture is: the first has no previous
    // number to be going forward FROM, and a lone call out of nowhere must not
    // be read as a lap. A real drag sends dozens.
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = weaving(0.9);
      h.ctx.setFlow(0.9, 'together', 0, true);
      h.ctx.setFlow(1, 'together', 0, true);
      const after = h.weave.lanes.lane1.weave as unknown as { a: string; b: string };
      expect(after.a).toBe('clip:b');       // what it arrived at is what it leaves from
      expect(after.b).not.toBe(after.a);
    });
  });

  it('and in STATIC it does not, however far it is dragged', () => {
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = weaving(0.9);
      h.ctx.setFlow(1, 'together', 0, false);
      const after = h.weave.lanes.lane1.weave as unknown as { a: string; b: string };
      expect(after.a).toBe('clip:a');
      expect(after.b).toBe('clip:b');
    });
  });
});

describe('half time and double time from the panel', () => {
  it('records the lane tempo on the WEAVE, not on the clip', () => {
    // The point of the whole change: a tool on top of the session does not
    // rewrite the session's material. Switch the weave off and the clip is as
    // you left it.
    const h = harness();
    const id = h.ctx.addLane('subtractive');

    h.ctx.setLaneTime(id, 2);

    expect(h.weave.lanes[id].timeScale).toBe(2);
  });

  it('gives the phrase the ROOM it needs, because it is delivered whole', () => {
    // Half time is not "play half of it twice": the phrase is stretched and the
    // carrier clip grows to hold it.
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    const clip = h.state.lanes.find((l) => l.id === id)!.clips[0]!;
    const bars = clip.lengthBars;

    h.ctx.setLaneTime(id, 2);

    expect(clip.lengthBars).toBe(bars * 2);
  });

  it('shrinks the room again on the way down', () => {
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    const clip = h.state.lanes.find((l) => l.id === id)!.clips[0]!;
    const bars = clip.lengthBars;
    h.ctx.setLaneTime(id, 2);
    h.ctx.setLaneTime(id, 0.5);
    expect(clip.lengthBars).toBe(bars);
    expect(h.weave.lanes[id].timeScale).toBe(1);
  });

  it('compounds, so two presses are four times', () => {
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    h.ctx.setLaneTime(id, 2);
    h.ctx.setLaneTime(id, 2);
    expect(h.weave.lanes[id].timeScale).toBe(4);
  });

  it('stops at two presses each way', () => {
    // Past that a phrase is one note every four bars, or a chord. Both read as
    // a broken control rather than as a tempo.
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    for (let i = 0; i < 5; i++) h.ctx.setLaneTime(id, 2);
    expect(h.weave.lanes[id].timeScale).toBe(4);
    for (let i = 0; i < 10; i++) h.ctx.setLaneTime(id, 0.5);
    expect(h.weave.lanes[id].timeScale).toBe(0.25);
  });

  it('refuses a factor that is not a tempo', () => {
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    h.ctx.setLaneTime(id, 0);
    h.ctx.setLaneTime(id, -2);
    expect(h.weave.lanes[id]?.timeScale ?? 1).toBe(1);
  });

  it('says nothing about a lane that has no clip', () => {
    const h = harness(['lane1']);
    expect(() => h.ctx.setLaneTime('lane1', 2)).not.toThrow();
  });
});

describe('octaves from the panel', () => {
  it('records the register on the WEAVE, never on the clip', () => {
    // Same rule as the lane tempo: a tool on top of the session does not
    // rewrite the session's material. Switch the weave off and the notes are as
    // you left them.
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    const clip = h.state.lanes.find((l) => l.id === id)!.clips[0]!;
    const before = clip.notes.map((n) => n.midi);

    h.ctx.setLaneOctave(id, -1);

    expect(h.ctx.laneOctave(id)).toBe(-1);
    expect(clip.notes.map((n) => n.midi)).toEqual(before);
  });

  it('compounds, because each press is one octave', () => {
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    h.ctx.setLaneOctave(id, 1);
    h.ctx.setLaneOctave(id, 1);
    expect(h.ctx.laneOctave(id)).toBe(2);
  });

  it('stops at three each way', () => {
    // Past that a part is under the bass or off the top of the keyboard, and
    // both read as a control that broke rather than as a register.
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    for (let i = 0; i < 6; i++) h.ctx.setLaneOctave(id, 1);
    expect(h.ctx.laneOctave(id)).toBe(3);
    for (let i = 0; i < 12; i++) h.ctx.setLaneOctave(id, -1);
    expect(h.ctx.laneOctave(id)).toBe(-3);
  });

  it('drops the cached fold, so the next tick plays the new register', () => {
    const h = harness(['lane1']);
    h.ctx.setLaneOctave('lane1', 1);
    expect(h.changed).toContain('lane1');
  });

  it('says nothing when asked to move by nothing', () => {
    const h = harness(['lane1']);
    h.ctx.setLaneOctave('lane1', 0);
    expect(h.changed).toEqual([]);
  });
});

describe('a hand going BACKWARDS has not arrived anywhere', () => {
  // Seen in the browser: in EVOLVE, dragging the fader from 0.95 to 0.20 in one
  // move handed over — `Clip 1 / Clip 2` became `Clip 2 / Clip 3`. applyFlow
  // reads "arrived" as "the position dropped by more than half a lap", which is
  // the right signal for the CLOCK (it only ever goes forward, so a big drop can
  // only be the far end folding round) and a false positive for a hand.
  it('does not hand over when the fader is dragged back', () => {
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = weaving(0.95);
      h.ctx.setFlow(0.95, 'together', 0, true);
      h.ctx.setFlow(0.2, 'together', 0, true);
      const after = h.weave.lanes.lane1.weave as unknown as { a: string; b: string; x: number };
      expect(after.a).toBe('clip:a');
      expect(after.b).toBe('clip:b');
      expect(after.x).toBeCloseTo(0.2, 6);
    });
  });

  it('still hands over when it reaches the far end going forward', () => {
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = weaving(0.95);
      h.ctx.setFlow(0.95, 'together', 0, true);
      h.ctx.setFlow(1, 'together', 0, true);
      const after = h.weave.lanes.lane1.weave as unknown as { a: string; b: string };
      expect(after.a).toBe('clip:b');
    });
  });
});

describe('the step rack — more than one row', () => {
  it('starts with exactly one, drawn and pointing nowhere', () => {
    const h = harness();
    const rows = h.ctx.stepRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].destId).toBe('');
    expect(rows[0].on).toBe(false);
  });

  it('grows, and says where the new row landed', () => {
    const h = harness();
    expect(h.ctx.addStepRow()).toBe(1);
    expect(h.ctx.stepRows()).toHaveLength(2);
  });

  it('edits the row it is told to and leaves its neighbour alone', () => {
    const h = harness();
    h.ctx.addStepRow();
    h.ctx.setStepsDest(1, 'lane1.filter.cutoff');
    h.ctx.setStepsOn(1, true);
    h.ctx.setStepsMode(1, 'ramp');
    h.ctx.setStep(1, 0, 0.5);

    const [first, second] = h.ctx.stepRows();
    expect(second).toMatchObject({ destId: 'lane1.filter.cutoff', on: true, mode: 'ramp' });
    expect(second.values[0]).toBe(0.5);
    expect(first).toMatchObject({ destId: '', on: false, mode: 'hold' });
  });

  it('shrinks, and never to nothing — an empty rack has no hint of what "+" adds', () => {
    const h = harness();
    h.ctx.addStepRow();
    h.ctx.removeStepRow(0);
    expect(h.ctx.stepRows()).toHaveLength(1);
    h.ctx.removeStepRow(0);
    expect(h.ctx.stepRows()).toHaveLength(1);
    expect(h.ctx.stepRows()[0].destId).toBe('');
  });

  it('a row that is gone answers nothing rather than throwing', () => {
    // A handler built over a row outlives the row: the panel repaints on the
    // NEXT frame, so a click landing in between must not take the app down.
    const h = harness();
    expect(() => {
      h.ctx.setStepsDest(9, 'x');
      h.ctx.setStepsOn(9, true);
      h.ctx.setStepsMode(9, 'ramp');
      h.ctx.setStep(9, 0, 1);
      h.ctx.stepsTool(9, 'up');
      h.ctx.removeStepRow(9);
    }).not.toThrow();
    expect(h.ctx.stepRows()).toHaveLength(1);
  });

  it('reshapes one row without touching the other', () => {
    const h = harness();
    h.ctx.addStepRow();
    const before = h.ctx.stepRows()[0].values.slice();
    h.ctx.stepsTool(1, 'invert');
    expect(h.ctx.stepRows()[0].values).toEqual(before);
    expect(h.ctx.stepRows()[1].values).not.toEqual(before);
  });
});

describe('flipping the switch is not travelling', () => {
  it('turning EVOLVE on at the far end does not hand over on the spot', () => {
    // Seen in the browser: dial wound to the top in STATIC, press EVOLVE, and
    // the pair advanced immediately — the newly wrapping position folded 1 to
    // 0, which looks exactly like a completed lap. Nothing moved; nothing
    // should change.
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = weaving(0);
      h.ctx.setFlow(0.9, 'together', 0, false);
      h.ctx.setFlow(1, 'together', 0, false);        // at the top, STATIC
      h.ctx.setFlow(1, 'together', 0, true);         // the switch, same position
      const after = h.weave.lanes.lane1.weave as unknown as { a: string; b: string };
      expect(after.a).toBe('clip:a');
      expect(after.b).toBe('clip:b');
    });
  });

  it('and the next real turn still hands over', () => {
    withLibrary(() => {
      const h = harness(['lane1']);
      h.weave.lanes.lane1 = weaving(0);
      h.ctx.setFlow(0.9, 'together', 0, true);
      h.ctx.setFlow(0.95, 'together', 0, true);
      h.ctx.setFlow(1, 'together', 0, true);
      const after = h.weave.lanes.lane1.weave as unknown as { a: string };
      expect(after.a).toBe('clip:b');
    });
  });
});

describe('unplugging the weave', () => {
  it('stops the transport, so off means off', () => {
    // Reported from a session: switching WEAVE off uncovered whatever the
    // session grid had launched, which arrived as a surprise after ten minutes
    // of listening to the weave and no memory of what was under it.
    const h = harness();
    h.ctx.setBypassed(true);
    expect(h.weave.bypass).toBe(true);
    expect(h.stops).toHaveLength(1);
  });

  it('does not start anything when it is plugged back in', () => {
    // Play is the only thing that starts the transport. Plugging the weave in
    // must not decide for the user that the scene should be running.
    const h = harness();
    h.ctx.setBypassed(true);
    h.ctx.setBypassed(false);
    expect(h.weave.bypass).toBe(false);
    expect(h.stops).toHaveLength(1);
  });

  it('leaves the desk alone', () => {
    // Muting the driven lanes was tried and reverted: it reached into the mixer
    // to answer a question about this panel, and left a session saved silent.
    // Stopping the transport is a different act and must stay one.
    const h = harness();
    h.ctx.setBypassed(true);
    expect(h.ctx.laneTransport('lane1').muted).toBe(false);
  });
});

describe('the master lock', () => {
  it('is off in a fresh weave', () => {
    // A panel that opened already frozen would look broken in the one way that
    // is hardest to diagnose: everything responds and nothing moves.
    expect(harness().ctx.locked()).toBe(false);
  });

  it('refuses a hand on a lane s loops', () => {
    // The lock holds an arrangement still. A dropdown that swapped the material
    // under it would be the one hole in that promise.
    const h = harness();
    h.weave.lanes.lane1 = weaving(0.25);
    h.ctx.setLocked(true);
    h.ctx.setLaneWeave('lane1', { kind: 'ab', a: 'clip:x', b: 'clip:y', x: 0.9 } as never);
    expect((h.weave.lanes.lane1.weave as { a: string }).a).toBe('clip:a');
  });

  it('refuses a hand on the master fader', () => {
    const h = harness();
    h.weave.lanes.lane1 = weaving(0.25);
    h.ctx.setLocked(true);
    h.ctx.setFlow(0.9, 'together', 0, false);
    expect((h.weave.lanes.lane1.weave as { x: number }).x).toBe(0.25);
  });

  it('still records how the journey WOULD behave', () => {
    // Drift, speed and EVOLVE are settings for when the lock is let go. Refusing
    // to store them would make the panel forget what the user chose.
    const h = harness();
    h.ctx.setLocked(true);
    h.ctx.setFlow(0.5, 'offset', 16, true);
    expect(h.weave.flow.speedBars).toBe(16);
    expect(h.weave.flow.evolve).toBe(true);
    expect(h.weave.flow.drift).toBe('offset');
  });

  it('lets go again', () => {
    const h = harness();
    h.weave.lanes.lane1 = weaving(0.25);
    h.ctx.setLocked(true);
    h.ctx.setLocked(false);
    h.ctx.setFlow(0.9, 'together', 0, false);
    expect((h.weave.lanes.lane1.weave as { x: number }).x).toBeCloseTo(0.9, 5);
  });

  it('leaves the macros alone', () => {
    // They are the user's hand, not evolution. A locked scene deaf to a rise in
    // Energy would pull apart from everything else in the mix.
    const h = harness();
    h.ctx.setLocked(true);
    h.ctx.setMacro('energy', 0.8);
    expect(h.weave.macros.energy).toBe(0.8);
  });

  it('leaves the chord progression alone', () => {
    // The invariant this whole round is built on: a lock freezes MATERIAL,
    // never HARMONY. The progression decides where material sits, not which
    // material plays, so freezing one is not a wish to freeze the other.
    const h = harness();
    h.ctx.setLocked(true);
    h.ctx.setProgression('i-VI-III-VII');
    expect(h.state.musicality.progression).toBe('i-VI-III-VII');
  });

  it('is not a mute', () => {
    const h = harness();
    h.ctx.setLocked(true);
    expect(h.ctx.laneTransport('lane1').muted).toBe(false);
    expect(h.weave.bypass).toBe(false);
  });
});

describe('a track s level', () => {
  it('reads and writes the mixer s own gain, not a second one', () => {
    // Balancing a weave meant leaving the panel for the desk and coming back.
    // Two numbers for one gain would be worse than that: the panel would show a
    // lane at half while the desk showed unity, and neither would be wrong.
    const levels: Record<string, number> = { lane1: 1 };
    const h = harness();
    const ctx = createPanelContext({
      sessionHost: {
        state: h.state,
        laneStates: new Map<string, LanePlayState>(),
        renderWithMixer: () => {},
        callbacks: {},
      } as never,
      seq: { bpm: 128, meter: DEFAULT_METER, isPlaying: () => false } as never,
      ctx: { currentTime: 0 } as never,
      weave: h.weave,
      refresh: () => {},
      laneLevel: (id) => levels[id] ?? 1,
      setLaneLevel: (id, v) => { levels[id] = v; },
    });
    expect(ctx.laneLevel('lane1')).toBe(1);
    ctx.setLaneLevel('lane1', 0.4);
    expect(levels.lane1).toBe(0.4);
    expect(ctx.laneLevel('lane1')).toBe(0.4);
  });

  it('reads unity for a lane with no strip, never zero', () => {
    // A fixture with no audio graph must not look like a muted lane.
    expect(harness().ctx.laneLevel('lane1')).toBe(1);
  });

  it('offers the mixer s declared range rather than a top of its own', () => {
    // Hardcoding 0..1.5 in the panel would quietly stop agreeing with the desk
    // the day that spec changes.
    const r = harness().ctx.laneLevelRange();
    expect(r.min).toBe(0);
    expect(r.max).toBeGreaterThan(1);
  });
});

describe('a weave and a follow are exclusive BOTH ways', () => {
  const AB = { kind: 'ab' as const, a: 'lib:techno:bass:0', b: 'lib:techno:bass:1', x: 0.25 };
  const followOf = (h: ReturnType<typeof harness>) =>
    (h.state.lanes[1] as { follow?: { leaderId: string } }).follow;

  it('choosing a topology stops the lane following', () => {
    // The exclusivity ran ONE way: setLaneFollow put the weave away, and
    // setLaneWeave wrote a weave and left the follow standing. The host
    // resolves follow first, so the lane kept accompanying while its row showed
    // a topology, two loops and a moving crossfade — which from the outside is
    // a lane that put itself back into follow. Reported as exactly that.
    const h = harness();
    h.ctx.setLaneFollow('lane2', 'lane1');
    expect(followOf(h)).toEqual({ leaderId: 'lane1' });
    h.ctx.setLaneWeave('lane2', AB);
    expect(followOf(h)).toBeUndefined();
  });

  it('and the lane really weaves afterwards', () => {
    const h = harness();
    h.ctx.setLaneFollow('lane2', 'lane1');
    h.ctx.setLaneWeave('lane2', AB);
    expect(h.ctx.laneWeave('lane2')).toEqual(AB);
  });

  it('turning the topology OFF is not a claim, so a follower stays one', () => {
    // Only a real weave is somebody choosing this lane's material. "Off" says
    // nothing, and a follower whose topology reads off is simply a follower.
    const h = harness();
    h.ctx.setLaneFollow('lane2', 'lane1');
    h.ctx.setLaneWeave('lane2', null);
    expect(followOf(h)).toEqual({ leaderId: 'lane1' });
  });

  it('a weave chosen by hand drops the shelved one — there is nothing older to want', () => {
    const h = harness();
    h.ctx.setLaneWeave('lane2', AB);
    h.ctx.setLaneFollow('lane2', 'lane1');   // shelves AB
    const other = { ...AB, a: 'lib:techno:bass:1', x: 0.75 };
    h.ctx.setLaneWeave('lane2', other);      // chosen by hand, so AB is spent
    h.ctx.setLaneFollow('lane2', 'lane1');
    h.ctx.setLaneFollow('lane2', null);
    expect(h.ctx.laneWeave('lane2')).toEqual(other);
  });
});

describe('the arrangement level', () => {
  it('is offered only to a lane whose notes are DERIVED', () => {
    // A weaving lane already travels with its weave and a drum lane has no
    // part at all; a knob there would move nothing, which is worse than an
    // absent one.
    const h = harness();
    expect(h.ctx.laneArrangeLevel('lane2')).toBeNull();
    h.ctx.setLaneFollow('lane2', 'lane1');
    expect(h.ctx.laneArrangeLevel('lane2')).not.toBeNull();
  });

  it('starts where the accompaniment already was, not at silence', () => {
    // One wheel. A default of 0 would take the rotating comp figure away from
    // every existing session as the price of gaining a knob.
    const h = harness();
    h.ctx.setLaneFollow('lane2', 'lane1');
    expect(h.ctx.laneArrangeLevel('lane2')).toBe(0.25);
  });

  it('round-trips what it is given, clamped', () => {
    const h = harness();
    h.ctx.setLaneFollow('lane2', 'lane1');
    h.ctx.setLaneArrangeLevel('lane2', 0.75);
    expect(h.ctx.laneArrangeLevel('lane2')).toBe(0.75);
    h.ctx.setLaneArrangeLevel('lane2', 9);
    expect(h.ctx.laneArrangeLevel('lane2')).toBe(1);
    h.ctx.setLaneArrangeLevel('lane2', -4);
    expect(h.ctx.laneArrangeLevel('lane2')).toBe(0);
    h.ctx.setLaneArrangeLevel('lane2', NaN);
    expect(h.ctx.laneArrangeLevel('lane2')).toBe(0);
  });

  it('tells the host the lane moved, so the next tick re-folds', () => {
    const h = harness();
    h.ctx.setLaneFollow('lane2', 'lane1');
    const before = h.changed.length;
    h.ctx.setLaneArrangeLevel('lane2', 1);
    expect(h.changed.length).toBeGreaterThan(before);
  });
});
