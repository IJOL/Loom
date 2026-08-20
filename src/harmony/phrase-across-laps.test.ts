// Un bucle de 2 compases tocado dos veces es una frase de 4.
//
// Sin esto, toda la forma de frase estaba INACTIVA en el caso normal de Loom.
// Su propia regla deja en paz cualquier frase de menos de tres compases — con
// razón, porque darle forma a un bucle de dos lo dejaría con un compás de
// música — así que sobre un clip de dos compases no hacía nada: los dos
// compases salían idénticos y llenos, sin arco, sin hueco y sin giro. Se
// escribió para material de cuatro compases y sólo se había probado sobre él.

import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';
import type { Progression } from '../arranger/progression';
import { createFollowSource, type FollowDeps } from './follow-source';

const BAR = TICKS_PER_QUARTER * 4;
const n = (start: number, duration: number, midi: number): NoteEvent =>
  ({ start, duration, midi, velocity: 100 });

/** Two bars of leader — the ordinary Loom clip, and the case that did nothing. */
const TWO_BARS = [n(0, BAR, 60), n(BAR, BAR, 58)];

const deps = (over: Partial<FollowDeps> = {}): FollowDeps => ({
  leaderNotes: () => TWO_BARS,
  role: () => 'comp',
  tonality: () => ({ key: 0, scale: 'minor' }),
  style: () => 'trance',
  barTicks: () => BAR,
  bars: () => 2,
  octaveBase: () => 48,
  written: () => undefined,
  ...over,
});

const onsetsAt = (lap: number) =>
  (createFollowSource(deps({ lap: () => lap }))() ?? [])
    .map((x) => x.start).sort((a, b) => a - b).join(',');

describe('the phrase spans repeats of a short loop', () => {
  it('lap 0 and lap 1 play DIFFERENT things over the same two bars', () => {
    expect(onsetsAt(0)).not.toEqual(onsetsAt(1));
  });

  it('and it comes round — but not after two laps, because the FIGURE moves too', () => {
    // Two things now cycle at once and the period is their product. The phrase
    // POSITION comes round every two laps (four bars of phrase over a two-bar
    // loop); the style's comping figure turns over once per phrase and there
    // are four of them. So the music genuinely repeats after eight laps, and
    // NOT after two — which is the whole point of the palette. A test that
    // demanded lap 2 == lap 0 was pinning the thing this feature removes.
    expect(onsetsAt(2)).not.toEqual(onsetsAt(0));
    expect(onsetsAt(8)).toEqual(onsetsAt(0));
    expect(onsetsAt(9)).toEqual(onsetsAt(1));
  });

  it('the phrase POSITION still comes round every two laps', () => {
    // Proved independently of the figure: the turnaround hole is a property of
    // WHERE you are in the phrase, so if the offset still has period two, laps
    // 1 and 3 both carry it and laps 0 and 2 both do not.
    const holeAt = (lap: number) => {
      const notes = createFollowSource(deps({ lap: () => lap }))() ?? [];
      return notes.filter((x) => x.start >= BAR && (x.start % BAR) < BAR / 2).length === 0;
    };
    expect(holeAt(1)).toBe(true);
    expect(holeAt(3)).toBe(true);
    expect(holeAt(0)).toBe(false);
    expect(holeAt(2)).toBe(false);
  });

  it('the FIRST lap opens the phrase — the fullest of the two', () => {
    const first = onsetsAt(0).split(',').length;
    const second = onsetsAt(1).split(',').length;
    expect(first).toBeGreaterThan(second);
  });

  it('the second lap carries the turnaround hole', () => {
    const late = (createFollowSource(deps({ lap: () => 1 }))() ?? []);
    // Its last bar is the phrase's fourth: silent for the first half.
    const inLastBarFirstHalf = late.filter((x) => x.start >= BAR && (x.start % BAR) < BAR / 2);
    expect(inLastBarFirstHalf.length).toBe(0);
  });

  it('a progression already four bars long is its own phrase — the lap never SHIFTS it', () => {
    // Nothing to stretch, so the phrase must not start somewhere different on
    // every repeat. What still moves is the FIGURE, once per phrase — and with
    // a four-bar progression a phrase is a lap, so the palette turns every lap
    // and comes back round on the fifth.
    //
    // Testing that fifth lap reproduces the first is what pins the offset at
    // zero: were the lap shifting the phrase as well, four turns of a
    // four-entry palette would not land back on the opening bar.
    const four = [n(0, BAR, 60), n(BAR, BAR, 58), n(BAR * 2, BAR, 60), n(BAR * 3, BAR, 67)];
    const at = (lap: number) => (createFollowSource(deps({
      leaderNotes: () => four, bars: () => 4, lap: () => lap,
    }))() ?? []).map((x) => x.start).join(',');
    expect(at(4)).toEqual(at(0));
    expect(at(1)).not.toEqual(at(0));
  });

  it('without a lap it behaves exactly as before', () => {
    expect((createFollowSource(deps())() ?? []).map((x) => x.start).join(','))
      .toEqual(onsetsAt(0));
  });
});
