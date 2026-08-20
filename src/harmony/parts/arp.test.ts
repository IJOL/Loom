import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, TICKS_PER_STEP } from '../../core/notes';
import { diatonicTriad } from '../../core/harmony';
import type { Progression } from '../../arranger/progression';
import { renderArp } from './arp';

const BAR = TICKS_PER_QUARTER * 4;
const o = { key: 9, scale: 'minor' as const, style: 'lo-fi' as const, barTicks: BAR, octaveBase: 60 };
const PROG: Progression = [{ degree: 0, bars: 1 }];

describe('renderArp', () => {
  it('plays one note at a time', () => {
    const byStart = new Map<number, number>();
    for (const n of renderArp(PROG, o)) byStart.set(n.start, (byStart.get(n.start) ?? 0) + 1);
    for (const count of byStart.values()) expect(count).toBe(1);
  });

  it('uses only the chord tones — never a scale walk from the root', () => {
    // The distinction from the arp note-FX: that one would emit the 2nd, 4th
    // and 6th of a pentatonic scale, none of which are in this chord.
    const tones = new Set(diatonicTriad(0, o.octaveBase, o.key, o.scale).map((m) => m % 12));
    for (const n of renderArp(PROG, o)) expect(tones.has(n.midi % 12)).toBe(true);
  });

  it('fills the chord rather than stopping after one pass', () => {
    expect(renderArp(PROG, o).length).toBe(BAR / TICKS_PER_STEP);
  });

  it('stays in its register — the walk restarts instead of climbing', () => {
    const out = renderArp([{ degree: 0, bars: 2 }], o);
    const tones = diatonicTriad(0, o.octaveBase, o.key, o.scale);
    expect(Math.max(...out.map((n) => n.midi))).toBe(Math.max(...tones));
  });

  it('is deterministic — the same progression twice gives the same notes', () => {
    expect(renderArp(PROG, o)).toEqual(renderArp(PROG, o));
  });

  it('follows the progression from chord to chord', () => {
    const out = renderArp([{ degree: 0, bars: 1 }, { degree: 4, bars: 1 }], o);
    const fifth = new Set(diatonicTriad(4, o.octaveBase, o.key, o.scale).map((m) => m % 12));
    for (const n of out.filter((x) => x.start >= BAR)) expect(fifth.has(n.midi % 12)).toBe(true);
  });

  it('is silent on an empty progression', () => {
    expect(renderArp([], o)).toEqual([]);
  });
});
