// How long before the accompaniment repeats itself EXACTLY.
//
// The thing a scene that never stops is missing is not density — a busier two
// bars is still two bars going round — it is LENGTH. Asked for as the ladder
// those "ten levels" videos climb: "esa escalera parte de un loop de 16 notas
// a un loop de muchas bars".
//
// Nothing here writes a note. Every wheel it turns already existed — which
// figure the comp plays, which colour the pad voices, which octave the part
// sits in, how thinned it is — and each was already turning. They were simply
// all turning at RELATED rates, so they came back into line together every few
// phrases and the music arrived back at bar one with them.
//
// The lever is co-primality. Three wheels of 3, 4 and 5 phrases share no
// divisor, so the pattern of where all three stand does not come round until
// 60 phrases have passed. Small wheels, long music: a level is not "more
// notes", it is "more wheels, and none of them in step".
//
// Pure: numbers in, numbers out. It decides WHEN things differ; the renderers
// decide what differing means.

/** The period of each wheel, in PHRASES, as the level rises.
 *
 *  Co-prime by construction — 4, 5, 7 and 3 share no divisor, so the pattern of
 *  where all four stand takes their PRODUCT to come round rather than their
 *  largest. That is the whole mechanism: small wheels, long music.
 *
 *  In this order for a reason: the first wheel a listener notices should be the
 *  one that changes what they hear most plainly. Figure first — a different
 *  comping rhythm is unmistakable. Colour next, which re-voices without
 *  re-timing. Then register, which moves the part bodily. Density last, the
 *  subtlest of the four and the easiest to mistake for a mistake if it arrives
 *  first.
 *
 *  Each period is chosen to walk its own table END TO END rather than merely to
 *  be co-prime. A style has four ways of comping and a chord has four colours,
 *  so a wheel of period three over either would leave one of them silent for
 *  ever — a fourth of the vocabulary, unreachable, for the sake of an
 *  arithmetic that had other solutions. Register's five steps under a period of
 *  seven is the same rule seen from the other side: every step is reached, and
 *  the part is left at home in five turns of the seven, which is what keeps a
 *  register a register.
 *
 *  1 means the wheel is not turning: every phrase gets the same answer, which
 *  is what all of this did before the ladder existed. */
const WHEELS = [
  { key: 'figure' as const, period: 4 },
  { key: 'colour' as const, period: 5 },
  { key: 'register' as const, period: 7 },
  { key: 'density' as const, period: 3 },
];

export type WheelKey = (typeof WHEELS)[number]['key'];
export type Cycles = Record<WheelKey, number>;

/** How many wheels are turning at this level.
 *
 *  Whole wheels rather than a continuous speed, because the point is the
 *  PRODUCT of the periods and a half-turned wheel has no period. The knob adds
 *  a wheel at a time, and each one it adds multiplies how long the music takes
 *  to come round. */
export function wheelsAt(level: number): number {
  const l = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
  return Math.round(l * WHEELS.length);
}

/**
 * Where every wheel stands after `phrase` phrases.
 *
 * A wheel that is not turning reads 0 for ever, so a renderer written against
 * this does the same thing it always did at level 0 without knowing that the
 * feature exists.
 */
export function cyclesAt(phrase: number, level: number): Cycles {
  const p = Math.max(0, Math.floor(Number.isFinite(phrase) ? phrase : 0));
  const on = wheelsAt(level);
  const out = {} as Cycles;
  WHEELS.forEach((w, i) => { out[w.key] = i < on ? p % w.period : 0; });
  return out;
}

/**
 * How many phrases before every wheel stands where it started.
 *
 * The product of the periods, not their maximum, and that is the whole reason
 * they are co-prime.
 *
 * It is the period of the WHEELS, and an upper bound on the music — never a
 * promise about it. Measured on the notes, a comp at the top gives about 79
 * distinct phrases in a hundred rather than a fresh one every time, and that
 * gap is deliberate rather than broken: the register wheel is mostly at home
 * on purpose, and a slightly different density does not change a part that was
 * already sparse. Wheels turning is not the same as music differing, which is
 * why `cycle-length.test.ts` counts rendered phrases instead of trusting this.
 */
export function cycleLengthPhrases(level: number): number {
  return WHEELS.slice(0, wheelsAt(level)).reduce((n, w) => n * w.period, 1);
}
