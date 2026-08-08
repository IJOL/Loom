// The panel's ONLY way into the host, and it had no test — which mattered the
// moment it stopped being read-only. A panel plugin is compiled separately and
// cannot be typechecked against this file, so every promise here is one only a
// test can keep.
import { describe, it, expect, vi } from 'vitest';
import { createPanelContext } from './panel-context';
import { defaultWeaveState } from '../weave/weave-state';
import { DEFAULT_METER } from '../core/meter';
import { DEFAULT_MUSICALITY } from '../session/session-types';
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

  // A fixture with no callbacks stands in for a host that refuses — the panel
  // has to tell the difference rather than report a lane id that names nothing.
  const callbacks = opts.addLane === false ? {} : {
    onAddLane: (engineId: string) => {
      added.push(engineId);
      state.lanes.push(lane(`new${state.lanes.length + 1}`) as never);
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
    refresh: () => {},
    onWeaveChanged: (id) => changed.push(id),
    setMusicality: (m) => { written.push(m); state.musicality = m; },
  });

  return { ctx, state, weave, written, added, changed };
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
});

describe('createPanelContext — adding a weaving track', () => {
  it('goes through the host\'s add-lane path', () => {
    // Pushing a lane onto the array here would give a row in the grid with no
    // strip and no engine behind it.
    const h = harness([]);
    h.ctx.addLane('subtractive');
    expect(h.added).toEqual(['subtractive']);
  });

  it('arrives already weaving', () => {
    // A track that arrived empty would leave the panel exactly as useless as it
    // was — that is the whole difference from "add a track" in the grid.
    const h = harness([]);
    const id = h.ctx.addLane('subtractive');
    expect(id).not.toBe('');
    expect(h.weave.lanes[id]?.weave).not.toBe(null);
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

describe('createPanelContext — the master flow', () => {
  it('reports where the lanes actually are', () => {
    // Read off the LANES rather than remembered beside the speed: with a journey
    // running the host moves them, and a second number would be the one the
    // panel showed while the music followed the other.
    const h = harness();
    h.weave.lanes.lane1 = weaving(0.4);
    expect(h.ctx.flow().position).toBeCloseTo(0.4);
  });

  it('moves every lane at once', () => {
    const h = harness();
    h.weave.lanes.lane1 = weaving(0);
    h.weave.lanes.lane2 = weaving(0);
    h.ctx.setFlow(0.6, 'together', 0);
    expect(h.weave.lanes.lane1.weave!.x).toBeCloseTo(0.6);
    expect(h.weave.lanes.lane2.weave!.x).toBeCloseTo(0.6);
  });

  it('fans the lanes out on offset drift', () => {
    const h = harness();
    h.weave.lanes.lane1 = weaving(0);
    h.weave.lanes.lane2 = weaving(0);
    h.ctx.setFlow(0, 'offset', 0);
    expect(h.weave.lanes.lane1.weave!.x).not.toBeCloseTo(h.weave.lanes.lane2.weave!.x);
  });

  it('hands the journey to the host when a speed is set', () => {
    // The panel stops driving and starts following: the speed lives in the
    // state the scheduler's tick reads.
    const h = harness();
    h.ctx.setFlow(0.2, 'free', 16);
    expect(h.ctx.flow().speedBars).toBe(16);
    expect(h.ctx.flow().drift).toBe('free');
  });

  it('refuses a nonsense speed rather than storing it', () => {
    const h = harness();
    h.ctx.setFlow(0, 'together', -4);
    expect(h.ctx.flow().speedBars).toBe(0);
  });

  it('skips a lane with no loops chosen', () => {
    // Giving it a position would silently start weaving a lane the user never
    // set up.
    const h = harness();
    h.weave.lanes.lane1 = weaving(0);
    h.ctx.setFlow(0.5, 'together', 0);
    expect(h.weave.lanes.lane2).toBeUndefined();
  });
});
