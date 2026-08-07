import { describe, it, expect } from 'vitest';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { scaleClipLength, retimeClip } from './clip-length';

const BAR = TICKS_PER_STEP * 16;
const note = (step: number, midi = 60, dur = TICKS_PER_STEP): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: dur, midi, velocity: 90 });
const starts = (ns: NoteEvent[]) => ns.map((n) => n.start);
const IN = [note(0), note(4), note(8)];

describe('scaleClipLength', () => {
  it('tiles the source when repeating at x2', () => {
    const out = scaleClipLength(IN, 2, 'repeat', BAR);
    expect(out).toHaveLength(IN.length * 2);
    expect(out.some((n) => n.start === BAR)).toBe(true);
  });

  it('leaves the first copy untouched when repeating, so the groove survives', () => {
    const out = scaleClipLength(IN, 2, 'repeat', BAR);
    expect(starts(out.filter((n) => n.start < BAR))).toEqual(starts(IN));
  });

  it('tiles three times at x3', () => {
    expect(scaleClipLength(IN, 3, 'repeat', BAR)).toHaveLength(IN.length * 3);
  });

  it('stretches positions and durations, keeping the note count', () => {
    const out = scaleClipLength(IN, 2, 'stretch', BAR);
    expect(out).toHaveLength(IN.length);
    expect(out[1].start).toBe(IN[1].start * 2);
    expect(out[1].duration).toBe(IN[1].duration * 2);
  });

  it('halves positions and durations at 0.5', () => {
    const out = scaleClipLength(IN, 0.5, 'stretch', BAR);
    expect(out[1].start).toBe(IN[1].start / 2);
    expect(out[1].duration).toBe(IN[1].duration / 2);
  });

  it('keeps only what fits when repeating at 0.5', () => {
    for (const n of scaleClipLength(IN, 0.5, 'repeat', BAR)) {
      expect(n.start).toBeLessThan(BAR / 2);
    }
  });

  it('tiles like repeat when varying, but not identically', () => {
    const src = [note(0), note(3), note(4), note(7)];
    const out = scaleClipLength(src, 2, 'vary', BAR);
    const first = out.filter((n) => n.start < BAR).map((n) => n.start);
    const second = out.filter((n) => n.start >= BAR).map((n) => n.start - BAR);
    expect(first).toEqual(starts(src));
    expect(second).not.toEqual(first);
  });

  it('drops only weak hits when varying, never the downbeat', () => {
    const src = [note(0), note(3), note(4), note(7)];
    const out = scaleClipLength(src, 3, 'vary', BAR);
    for (let c = 0; c < 3; c++) {
      expect(out.some((n) => n.start === c * BAR)).toBe(true);
    }
  });

  it('never returns a note past the target length', () => {
    const target = BAR * 2;
    for (const n of scaleClipLength(IN, 2, 'repeat', BAR)) {
      expect(n.start).toBeLessThan(target);
    }
  });

  it('returns the notes in time order', () => {
    const out = scaleClipLength(IN, 3, 'vary', BAR);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
    }
  });

  it('refuses a factor of zero rather than emptying the clip', () => {
    // An empty clip reads exactly like data loss.
    expect(scaleClipLength(IN, 0, 'repeat', BAR)).toEqual(IN);
    expect(scaleClipLength(IN, -2, 'stretch', BAR)).toEqual(IN);
    expect(scaleClipLength(IN, Number.NaN, 'repeat', BAR)).toEqual(IN);
  });

  it('handles an empty clip', () => {
    expect(scaleClipLength([], 2, 'repeat', BAR)).toEqual([]);
  });
});

describe('retimeClip', () => {
  it('packs the notes closer at double rate', () => {
    expect(retimeClip([note(0), note(8)], 2)[1].start).toBe(note(8).start / 2);
  });

  it('spreads them out at half rate', () => {
    expect(retimeClip([note(0), note(8)], 0.5)[1].start).toBe(note(8).start * 2);
  });

  it('scales durations by the same amount', () => {
    expect(retimeClip([note(0)], 2)[0].duration).toBe(note(0).duration / 2);
  });

  it('never produces a duration below one tick', () => {
    const tiny: NoteEvent = { start: 0, duration: 1, midi: 60, velocity: 90 };
    expect(retimeClip([tiny], 8)[0].duration).toBeGreaterThanOrEqual(1);
  });

  it('keeps the pitch and velocity untouched', () => {
    const out = retimeClip([note(4, 62)], 2)[0];
    expect(out.midi).toBe(62);
    expect(out.velocity).toBe(90);
  });

  it('refuses a rate of zero rather than collapsing every note onto tick 0', () => {
    // That would give a clip that plays one chord, which reads as a bug rather
    // than as a very slow tempo.
    const ns = [note(0), note(8)];
    expect(retimeClip(ns, 0)).toEqual(ns);
    expect(retimeClip(ns, -1)).toEqual(ns);
  });
});
