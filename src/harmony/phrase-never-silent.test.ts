// A bar of a comping part is never left empty by the phrase shaping.
//
// It was, and across half the style catalogue. The floor is an absolute
// threshold sitting just above an ordinary offbeat — right for a shape with
// strong and weak positions, and catastrophic for one made entirely of
// offbeats. Garage and house comp on the offbeat and nothing else: all four
// hits weigh exactly 0.5, the floor is 0.6, and the middle of every phrase came
// out as two bars of silence. `sustained` broke the other way, with its single
// hit landing inside the turnaround hole.
//
// Reported from use, on a garage session: "el comp es el mismo a pesar de haber
// pasado por un montón de loops".

import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';
import { SHAPES, shapeForStyle } from '../core/chord-rhythms';
import { STYLE_CATALOG, type StyleId } from '../core/musicality';
import type { Progression } from '../arranger/progression';
import { renderComp } from './parts/comp';
import { renderBass } from './parts/bass';
import { survivingHits } from './phrase';

const BAR = TICKS_PER_QUARTER * 4;
const FOUR: Progression = [
  { degree: 0, bars: 1 }, { degree: 6, bars: 1 }, { degree: 2, bars: 1 }, { degree: 4, bars: 1 },
];
const notesIn = (part: NoteEvent[], bar: number) =>
  part.filter((n) => n.start >= bar * BAR && n.start < (bar + 1) * BAR);

describe('no bar of a comp or a bass is ever silent', () => {
  it.each(STYLE_CATALOG.map((s) => s.id))('%s', (style: StyleId) => {
    const o = { key: 0, scale: 'minor' as const, style, barTicks: BAR, octaveBase: 48 };
    for (const render of [renderComp, renderBass]) {
      const part = render(FOUR, o);
      for (let bar = 0; bar < 4; bar++) {
        expect(notesIn(part, bar).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('survivingHits thins but never erases', () => {
  const stepTicks = BAR / 16;

  it('keeps the strongest hit when the floor would take them all', () => {
    // The offbeat shape: four hits, every one of them weight 0.5.
    const kept = survivingHits(SHAPES.offbeat, stepTicks, BAR, { bar: 1, bars: 4 });
    expect(kept.length).toBe(1);
    expect(SHAPES.offbeat).toContain(kept[0]);
  });

  it('still thins a shape that HAS strong positions to keep', () => {
    const kept = survivingHits(SHAPES.eighths, stepTicks, BAR, { bar: 1, bars: 4 });
    expect(kept.length).toBeGreaterThan(1);
    expect(kept.length).toBeLessThan(SHAPES.eighths.length);
  });

  it('leaves the opening bar completely alone', () => {
    for (const shape of Object.values(SHAPES)) {
      expect(survivingHits(shape, stepTicks, BAR, { bar: 0, bars: 4 }).length).toBe(shape.length);
    }
  });

  it('rescues a single-hit shape from the turnaround hole', () => {
    // `sustained` is one hit, on the downbeat — inside the hole. Waiving the
    // hole for it is deliberate: a bar reduced to one note is already the
    // sparsest statement there is, and silencing that is the erasure this
    // exists to prevent.
    expect(survivingHits(SHAPES.sustained, stepTicks, BAR, { bar: 3, bars: 4 }).length).toBe(1);
  });

  it('answers nothing for nothing', () => {
    expect(survivingHits([], stepTicks, BAR, { bar: 1, bars: 4 })).toEqual([]);
  });
});
