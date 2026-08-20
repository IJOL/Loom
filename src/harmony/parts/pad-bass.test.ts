import { describe, it, expect } from 'vitest';
import { diatonicTriad } from '../../core/harmony';
import { TICKS_PER_QUARTER } from '../../core/notes';
import type { Progression } from '../../arranger/progression';
import { renderPad } from './pad';
import { renderBass } from './bass';

const BAR = TICKS_PER_QUARTER * 4;
const o = { key: 9, scale: 'minor' as const, style: 'lo-fi' as const, barTicks: BAR, octaveBase: 48 };
const PROG: Progression = [{ degree: 0, bars: 1 }, { degree: 5, bars: 1 }];

describe('renderPad', () => {
  it('emits one stack per chord and nothing in between', () => {
    expect(new Set(renderPad(PROG, o).map((n) => n.start))).toEqual(new Set([0, BAR]));
  });

  it('holds each stack for the whole chord, however many bars it lasts', () => {
    for (const n of renderPad([{ degree: 0, bars: 2 }], o)) expect(n.duration).toBe(2 * BAR);
  });

  it('ignores the style — a pad has no rhythm of its own', () => {
    const lofi = renderPad(PROG, o);
    const trance = renderPad(PROG, { ...o, style: 'trance' });
    expect(trance).toEqual(lofi);
  });

  it('voices the second chord near the first rather than rebuilding it low', () => {
    const out = renderPad(PROG, o);
    const first = out.filter((n) => n.start === 0).map((n) => n.midi).sort((a, b) => a - b);
    const second = out.filter((n) => n.start === BAR).map((n) => n.midi).sort((a, b) => a - b);
    const moved = first.reduce((s, m, i) => s + Math.abs(second[i] - m), 0);
    // Against the same chord an octave down: the voiced answer must not be the
    // worse of the two. Relative, so it says nothing about absolute distance.
    const naive = first.reduce((s, m, i) => s + Math.abs((second[i] - 12) - m), 0);
    expect(moved).toBeLessThanOrEqual(naive);
  });

  it('is silent on an empty progression', () => {
    expect(renderPad([], o)).toEqual([]);
  });
});

describe('renderBass', () => {
  it('plays one note at a time — a bass is not a chord', () => {
    const byStart = new Map<number, number>();
    for (const n of renderBass(PROG, o)) byStart.set(n.start, (byStart.get(n.start) ?? 0) + 1);
    for (const count of byStart.values()) expect(count).toBe(1);
  });

  it('stays below the pad on every chord', () => {
    const lowestPad = Math.min(...renderPad(PROG, o).map((n) => n.midi));
    expect(Math.max(...renderBass(PROG, o).map((n) => n.midi))).toBeLessThan(lowestPad);
  });

  it('starts every chord on its root', () => {
    const first = renderBass(PROG, o).filter((n) => n.start === 0)[0];
    const root = Math.min(...renderPad([PROG[0]], o).map((n) => n.midi));
    // Compared as pitch classes rather than as a remainder: the bass sits an
    // octave DOWN, so the difference is negative and `-12 % 12` is -0, which
    // Object.is — and therefore toBe — does not consider equal to 0.
    expect(((first.midi % 12) + 12) % 12).toBe(((root % 12) + 12) % 12);
  });

  it('does not sit on one note — the fifth answers the root', () => {
    // 'eighths' has enough hits per bar for the alternation to show. A part
    // that emitted the root every time would come out with one distinct pitch.
    const out = renderBass([{ degree: 0, bars: 1 }], { ...o, style: 'trance' });
    expect(new Set(out.map((n) => n.midi)).size).toBeGreaterThan(1);
  });

  it('follows the style — a different comping rhythm gives a different bass', () => {
    const sustained = renderBass(PROG, { ...o, style: 'ambient' });
    const eighths = renderBass(PROG, { ...o, style: 'trance' });
    expect(eighths.length).toBeGreaterThan(sustained.length);
  });
});

describe('the bass stays in the bass', () => {
  const BAR2 = TICKS_PER_QUARTER * 4;
  // i - VI - III - VII: the two chords high in the scale are exactly the ones
  // whose "fifth" crossed the octave.
  const FALL = [
    { degree: 0, bars: 1 }, { degree: 5, bars: 1 },
    { degree: 2, bars: 1 }, { degree: 6, bars: 1 },
  ];
  const opts = { key: 9, scale: 'minor' as const, style: 'trance' as const,
    barTicks: BAR2, octaveBase: 36 };

  it('never spans more than an octave', () => {
    // "El bajo calculado es muy agudo, debe bajar octavas." It was not the
    // register: `degree + 4` is a fifth low in the scale and a TWELFTH high in
    // it, so on VI and VII half the line leapt an octave and a fifth above its
    // own root and came back.
    const midi = renderBass(FALL, opts).map((n) => n.midi);
    expect(Math.max(...midi) - Math.min(...midi)).toBeLessThan(12);
  });

  it('sits below the pad on every chord of the progression', () => {
    const bass = Math.max(...renderBass(FALL, opts).map((n) => n.midi));
    const pad = Math.min(...renderPad(FALL, { ...opts, octaveBase: 48 }).map((n) => n.midi));
    expect(bass).toBeLessThan(pad);
  });

  it('still alternates — folding must not flatten it to a drone', () => {
    // An octave down is the same note, so the root/fifth alternation the part
    // is built on has to survive. A clamp would have squashed the pair onto one
    // pitch, which is a bass that stopped playing anything.
    expect(new Set(renderBass(FALL, opts).map((n) => n.midi)).size).toBeGreaterThan(1);
  });

  it('every note is still a chord tone', () => {
    // Folding moves octaves, never pitch classes.
    for (const c of FALL) {
      const one = renderBass([c], opts).map((n) => ((n.midi % 12) + 12) % 12);
      const tones = new Set(diatonicTriad(c.degree, 48, 9, 'minor').map((m) => ((m % 12) + 12) % 12));
      for (const pc of one) expect(tones.has(pc)).toBe(true);
    }
  });
});
