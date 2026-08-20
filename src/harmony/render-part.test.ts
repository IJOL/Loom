import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER } from '../core/notes';
import type { Progression } from '../arranger/progression';
import { renderPart } from './render-part';
import { renderPad } from './parts/pad';
import { renderBass } from './parts/bass';
import { renderComp } from './parts/comp';
import { renderArp } from './parts/arp';

const BAR = TICKS_PER_QUARTER * 4;
const o = { key: 9, scale: 'minor' as const, style: 'lo-fi' as const, barTicks: BAR, octaveBase: 48 };
const PROG: Progression = [{ degree: 0, bars: 1 }];

describe('renderPart routes a role to its renderer', () => {
  it('sends each role to the right one', () => {
    expect(renderPart('pad', PROG, o)).toEqual(renderPad(PROG, o));
    expect(renderPart('bass', PROG, o)).toEqual(renderBass(PROG, o));
    expect(renderPart('comp', PROG, o)).toEqual(renderComp(PROG, o));
    expect(renderPart('arp', PROG, o)).toEqual(renderArp(PROG, o));
  });

  it('gives every accompanying role something to play', () => {
    for (const role of ['bass', 'comp', 'pad', 'arp'] as const) {
      expect(renderPart(role, PROG, o).length).toBeGreaterThan(0);
    }
  });

  it('gives each role a DIFFERENT part — the table is not four aliases', () => {
    const shapes = ['bass', 'comp', 'pad', 'arp'].map((role) =>
      JSON.stringify(renderPart(role as 'bass', PROG, o)));
    expect(new Set(shapes).size).toBe(4);
  });
});

describe('renderPart declines rather than guessing', () => {
  it('a MELODY lane accompanies nothing', () => {
    expect(renderPart('melody', PROG, o)).toEqual([]);
  });

  it('an unmarked lane accompanies nothing', () => {
    // This is also what keeps a drum lane out: laneRoleOf answers undefined for
    // a percussion lane, so the guard never needs to know an engine id.
    expect(renderPart(undefined, PROG, o)).toEqual([]);
  });

  it('an empty progression is silence, not a default chord', () => {
    expect(renderPart('pad', [], o)).toEqual([]);
  });
});
