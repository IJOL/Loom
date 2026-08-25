// The chord track, across the plugin boundary.
//
// The panel is compiled separately and cannot import the host, so it gets the
// OPS rather than the maths. A panel doing its own splicing would be a second
// implementation of every rule in chord-track.ts — including the two that
// matter, "at least one bar" and "never remove the last".
import { describe, it, expect } from 'vitest';
import { createPanelContext } from './panel-context';
import { defaultWeaveState } from '../weave/weave-state';
import { DEFAULT_METER } from '../core/meter';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { progressionById } from '../arranger/progression';
import type { SessionState } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';

const lane = (id: string) => ({ id, engineId: 'subtractive', name: id, clips: [], inserts: [] });

function harness() {
  const state = {
    lanes: [lane('lane1')],
    scenes: [{ id: 'scene1', name: 'Scene 1', clipPerLane: {} as Record<string, number | null> }],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState;
  const weave = defaultWeaveState();
  const changed: (string | undefined)[] = [];

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
    setMusicality: () => {},
    stopTransport: () => {},
  });

  return { ctx, state, weave, changed };
}

describe('the chord track, across the plugin boundary', () => {
  it('reads the catalogue entry until something is written', () => {
    const h = harness();
    h.state.musicality.progression = 'i-VI';
    expect(h.ctx.isCustomProgression()).toBe(false);
    expect(h.ctx.chordTrack()).toEqual(progressionById('i-VI')!.chords);
  });

  it('COPIES the catalogue entry on the first edit, rather than damaging it', () => {
    // The catalogue is a shelf of starting points. An edit that wrote back
    // would change every session that ever picks that entry.
    const h = harness();
    h.state.musicality.progression = 'i-VI';
    const wasSecond = progressionById('i-VI')!.chords[1].degree;

    h.ctx.setChordDegree(1, 3);

    expect(h.ctx.isCustomProgression()).toBe(true);
    expect(h.ctx.chordTrack()[1].degree).toBe(3);
    expect(progressionById('i-VI')!.chords[1].degree).toBe(wasSecond);
  });

  it('hands out a COPY, so a panel cannot edit the state behind the host s back', () => {
    const h = harness();
    h.ctx.chordTrack()[0].degree = 6;
    expect(h.ctx.chordTrack()[0].degree).not.toBe(6);
  });

  it('keeps a slot at least one bar, through the SDK too', () => {
    // The rule lives in the pure op; this asserts the panel cannot route round it.
    const h = harness();
    h.ctx.setChordBars(0, 0);
    expect(h.ctx.chordTrack()[0].bars).toBe(1);
  });

  it('adds and removes slots', () => {
    const h = harness();
    h.state.musicality.progression = 'i-VI';
    const n = h.ctx.chordTrack().length;
    h.ctx.insertChordAfter(0);
    expect(h.ctx.chordTrack()).toHaveLength(n + 1);
    h.ctx.removeChord(1);
    expect(h.ctx.chordTrack()).toHaveLength(n);
  });

  it('refuses to remove the last slot, through the SDK too', () => {
    const h = harness();
    h.state.musicality.chords = [{ degree: 0, bars: 1 }];
    h.ctx.removeChord(0);
    expect(h.ctx.chordTrack()).toHaveLength(1);
  });

  it('goes back to the catalogue when reset', () => {
    const h = harness();
    h.state.musicality.progression = 'i-VI';
    h.ctx.setChordDegree(0, 4);
    h.ctx.resetChordTrack();
    expect(h.ctx.isCustomProgression()).toBe(false);
    expect(h.ctx.chordTrack()).toEqual(progressionById('i-VI')!.chords);
  });

  it('tells the weave it moved, so the autosave hears it', () => {
    // Nothing else would: a weave edit is deliberately not an undo entry, and
    // onWeaveChanged is the only thing that reaches the autosave.
    const h = harness();
    h.ctx.setChordDegree(0, 2);
    expect(h.changed.length).toBeGreaterThan(0);
  });
});
