import { describe, it, expect } from 'vitest';
import { progressionById, type Progression } from '../arranger/progression';
import { travelProgression } from './progression-journey';

const LONG_FALL = progressionById('i-VI-III-VII')!.chords;   // 0,5,2,6
const TWO = progressionById('i-VI')!.chords;                 // 0,5
const STATIC = progressionById('static')!.chords;            // 0

const degs = (p: Progression) => p.map((c) => c.degree);
const at = (leg: number, base = LONG_FALL) => degs(travelProgression(base, leg, { seed: 7 }));

describe('a progression that travels', () => {
  it('leg 0 is the progression exactly as written', () => {
    // The whole reason this can be on by default: a session that has not
    // travelled plays what it always played.
    expect(at(0)).toEqual(degs(LONG_FALL));
  });

  it('"Stay home" stays home — there is nothing to vary', () => {
    for (let leg = 0; leg < 8; leg++) expect(at(leg, STATIC)).toEqual([0]);
  });

  it('the FIRST chord never moves, however far it travels', () => {
    for (let leg = 0; leg < 40; leg++) expect(at(leg)[0]).toBe(LONG_FALL[0].degree);
  });

  it('it does move — the same progression is not played for ever', () => {
    const seen = new Set<string>();
    for (let leg = 0; leg < 12; leg++) seen.add(at(leg).join(','));
    expect(seen.size).toBeGreaterThan(2);
  });

  it('only ONE chord moves at a time, apart from the turnaround', () => {
    // Two chords changing at once reads as a wrong chord; one reads as a
    // variation. The turnaround is exempt because it is the slot whose job is
    // to come and go.
    const last = LONG_FALL.length - 1;
    for (let leg = 1; leg < 40; leg++) {
      const got = at(leg);
      const moved = got.filter((d, i) => i !== last && d !== LONG_FALL[i].degree).length;
      expect(moved).toBeLessThanOrEqual(1);
    }
  });

  it('an interior chord only ever becomes its diatonic RELATIVE', () => {
    // A third away, up or down: two of three notes shared. Any other degree is
    // a different chord rather than a re-colouring of this one.
    const last = LONG_FALL.length - 1;
    for (let leg = 1; leg < 40; leg++) {
      at(leg).forEach((d, i) => {
        if (i === 0 || i === last || d === LONG_FALL[i].degree) return;
        const home = LONG_FALL[i].degree;
        expect([(home + 2) % 7, (home + 5) % 7]).toContain(d);
      });
    }
  });

  it('the turnaround comes AND goes — it is not just a fourth chord', () => {
    const last = LONG_FALL.length - 1;
    const legs = [1, 2, 3, 4, 5, 6];
    const dominant = legs.filter((l) => at(l)[last] === 4);
    expect(dominant.length).toBeGreaterThan(0);
    expect(dominant.length).toBeLessThan(legs.length);
  });

  it('a two-chord progression travels on its turnaround alone', () => {
    // No interior to vary, so the anchor and the turnaround are the whole of
    // it — and it must still not touch the anchor.
    for (let leg = 0; leg < 8; leg++) expect(at(leg, TWO)[0]).toBe(0);
    expect(new Set([0, 1, 2, 3].map((l) => at(l, TWO).join(','))).size).toBeGreaterThan(1);
  });

  it('the same leg gives the same harmony every time', () => {
    // The offline render has to match what came out of the speakers.
    for (let leg = 0; leg < 10; leg++) expect(at(leg)).toEqual(at(leg));
    expect(travelProgression(LONG_FALL, 5, { seed: 7 }))
      .toEqual(travelProgression(LONG_FALL, 5, { seed: 7 }));
  });

  it('bar lengths survive the journey', () => {
    // It re-colours chords; it does not re-time the phrase.
    const plain = progressionById('i-iv-v')!.chords;
    for (let leg = 0; leg < 10; leg++) {
      expect(travelProgression(plain, leg, { seed: 3 }).map((c) => c.bars))
        .toEqual(plain.map((c) => c.bars));
    }
  });

  it('a smaller scale never has a degree INVENTED for it', () => {
    // Only about the substitution, which is the part this owns. The catalogue's
    // own progressions carry degrees 5 and 6 and a pentatonic session has
    // neither — that is true before this function is called and is settled
    // downstream, where every reader takes the degree modulo the real scale.
    // Asserting it here would be this test failing for somebody else's reason.
    const pent = [{ degree: 0, bars: 1 }, { degree: 2, bars: 1 },
      { degree: 4, bars: 1 }, { degree: 2, bars: 1 }];
    for (let leg = 0; leg < 20; leg++) {
      for (const d of degs(travelProgression(pent, leg, { seed: 1, scaleLen: 5 }))) {
        expect(d).toBeLessThan(5);
        expect(d).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
