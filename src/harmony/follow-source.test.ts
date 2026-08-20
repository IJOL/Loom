import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';
import type { Progression } from '../arranger/progression';
import { createFollowSource, progressionFor, type FollowDeps } from './follow-source';

const BAR = TICKS_PER_QUARTER * 4;
const n = (start: number, duration: number, midi: number): NoteEvent =>
  ({ start, duration, midi, velocity: 100 });

const deps = (over: Partial<FollowDeps> = {}): FollowDeps => ({
  leaderNotes: () => [n(0, BAR, 57)],
  role: () => 'pad',
  tonality: () => ({ key: 9, scale: 'minor' }),
  style: () => 'lo-fi',
  barTicks: () => BAR,
  bars: () => 1,
  octaveBase: () => 48,
  written: () => undefined,
  ...over,
});

describe('createFollowSource produces a part', () => {
  it('gives notes for a lane with a leader and a role', () => {
    expect(createFollowSource(deps())()!.length).toBeGreaterThan(0);
  });

  it('is silent when the leader has no notes', () => {
    expect(createFollowSource(deps({ leaderNotes: () => [] }))()).toEqual([]);
  });

  it('is silent — not broken — when the leader is gone entirely', () => {
    // A deleted leader reaches here as undefined, on the scheduler's tick.
    expect(createFollowSource(deps({ leaderNotes: () => undefined }))()).toEqual([]);
  });

  it('is silent when the lane has no role', () => {
    expect(createFollowSource(deps({ role: () => undefined }))()).toEqual([]);
  });

  it('plays a different part for a different role', () => {
    const pad = createFollowSource(deps())();
    const bass = createFollowSource(deps({ role: () => 'bass' }))();
    expect(bass).not.toEqual(pad);
  });
});

describe('createFollowSource re-derives only when it must', () => {
  it('re-derives when the leader changes', () => {
    // The replacement has to imply a DIFFERENT chord, not merely be different
    // notes. An earlier version swapped A for C+E — the other two notes of the
    // A minor triad — so the analysis correctly inferred the same chord and the
    // pad came out identical, which looked like a stale cache and was not.
    // D (62) and F (65) sit in the triad on degree 3 and outside the tonic's.
    let notes = [n(0, BAR, 57)];
    const src = createFollowSource(deps({ leaderNotes: () => notes }));
    const before = src()!.map((x) => x.midi);
    notes = [n(0, BAR / 2, 62), n(BAR / 2, BAR / 2, 65)];
    expect(src()!.map((x) => x.midi)).not.toEqual(before);
  });

  it('does NOT re-derive when nothing changed — the cache holds', () => {
    const src = createFollowSource(deps());
    // Reference identity, deliberately: this runs on the scheduler's tick, so
    // returning a fresh array every call is the thing being guarded against.
    expect(src()).toBe(src());
  });

  it('ignores a velocity edit on the leader', () => {
    // The fingerprint covers start and pitch, the two fields the analysis
    // reads. Re-deriving on a velocity change would be work for no difference.
    let notes = [n(0, BAR, 57)];
    const src = createFollowSource(deps({ leaderNotes: () => notes }));
    const first = src();
    notes = [{ ...notes[0], velocity: 20 }];
    expect(src()).toBe(first);
  });

  it('re-derives when the role changes', () => {
    let role: 'pad' | 'bass' = 'pad';
    const src = createFollowSource(deps({ role: () => role }));
    const before = src();
    role = 'bass';
    expect(src()).not.toBe(before);
  });
});

describe('the window measures the MATERIAL, not the clip', () => {
  // Four bars of notes, handed over by a leader whose clip claims two — a lane
  // weaving a four-bar library loop inside a two-bar clip. Reported as "it
  // alternates between two patterns", which is what half a phrase on repeat is.
  const fourBars = [
    n(0, BAR, 60),                 // bar 1: C
    n(BAR, BAR, 58),               // bar 2: A#  — a different chord
    n(BAR * 2, BAR, 60),           // bar 3: C
    n(BAR * 3, BAR, 67),           // bar 4: G
  ];

  it('finds a chord for every bar the notes span', () => {
    const p = progressionFor(deps({ leaderNotes: () => fourBars, bars: () => 2 }));
    const spanned = p.reduce((sum, c) => sum + c.bars, 0);
    expect(spanned).toBe(4);
  });

  it('finds harmony the two-bar window could not see', () => {
    const wide = progressionFor(deps({ leaderNotes: () => fourBars, bars: () => 2 }));
    // Bars three and four exist at all, which is the whole point — under the
    // clip-length window they were never looked at.
    expect(wide.length).toBeGreaterThan(1);
  });

  it('still fills a clip LONGER than the material', () => {
    // The caller's number is a floor, not the answer: a one-bar phrase in a
    // four-bar clip must not leave three bars of silence.
    const p = progressionFor(deps({ leaderNotes: () => [n(0, BAR, 60)], bars: () => 4 }));
    expect(p.reduce((sum, c) => sum + c.bars, 0)).toBe(4);
  });
});

describe('a written progression wins over the inferred one', () => {
  it('changes what sounds', () => {
    const written: Progression = [{ degree: 3, bars: 1 }];
    expect(createFollowSource(deps({ written: () => written }))()!.map((x) => x.midi))
      .not.toEqual(createFollowSource(deps())()!.map((x) => x.midi));
  });

  it('progressionFor returns the written one verbatim', () => {
    const written: Progression = [{ degree: 3, bars: 2 }];
    expect(progressionFor(deps({ written: () => written }))).toEqual([{ degree: 3, bars: 2 }]);
  });

  it('an EMPTY written track means nothing written, not silence', () => {
    // The editor cannot reach zero slots by design, so an empty one is a
    // corrupt save — falling back to the inference is the recoverable reading.
    expect(progressionFor(deps({ written: () => [] })))
      .toEqual(progressionFor(deps()));
  });
});
