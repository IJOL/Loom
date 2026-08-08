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

function harness(laneIds: string[] = ['lane1', 'lane2']) {
  const state = {
    lanes: laneIds.map(lane),
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState;

  const written: MusicalityState[] = [];
  const bpms: number[] = [];
  const weave = defaultWeaveState();
  const changed: string[] = [];

  const ctx = createPanelContext({
    sessionHost: {
      state,
      laneStates: new Map<string, LanePlayState>(),
      renderWithMixer: () => {},
      callbacks: {},
    } as never,
    seq: { bpm: 128, meter: DEFAULT_METER, isPlaying: () => false } as never,
    ctx: { currentTime: 0 } as never,
    weave,
    refresh: () => {},
    onWeaveChanged: (id) => changed.push(id),
    setMusicality: (m) => { written.push(m); state.musicality = m; },
    setBpm: (b) => bpms.push(b),
  });

  return { ctx, state, weave, written, bpms, changed };
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

  it('sets the tempo through the transport, never seq.bpm', () => {
    // Writing the field would change the number and not the sound: the worklet
    // hears about the tempo from the transport's own setter.
    const h = harness();
    h.ctx.setBpm(140);
    expect(h.bpms).toEqual([140]);
  });

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
