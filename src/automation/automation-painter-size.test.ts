// ensureLaneSize — the one place an envelope array is resized to the length the
// clip needs. It had no coverage, and one of its two branches THROWS DATA AWAY,
// so what it does to an over-long lane is worth pinning: a session saved before
// the envelope length became meter-correct stored `lengthBars * 16 * SUB_RES`,
// and the first draw of that lane resizes it for good.
//
// WHICH branch that resize takes is not "4/4 or not". A bar is
// stepsPerBar = num * 16 / den steps, so the old 16-step bar is too LONG only
// where the meter's bar is shorter than a whole note (3/4, 2/4, 6/8, 7/8) — the
// meters with a longer bar (5/4, 9/8, 12/8) make the stored array too SHORT and
// take the harmless grow branch. Both sides are covered below so the comment on
// the destructive branch stays checkable.
import { describe, it, expect } from 'vitest';
import { ensureLaneSize } from './automation-painter';
import { envelopeValueLength } from '../core/clip-envelope-length';
import { DEFAULT_METER, type TimeSignature } from '../core/meter';

const THREE_FOUR: TimeSignature = { num: 3, den: 4 };
const FIVE_FOUR: TimeSignature = { num: 5, den: 4 };

/** A lane whose every slot holds a value no other slot holds, so "which slots
 *  survived" is observable rather than inferred from a length. */
function rampLane(length: number): { values: number[] } {
  return { values: Array.from({ length }, (_, i) => (i + 1) / (length + 1)) };
}

describe('ensureLaneSize', () => {
  it('leaves a lane that is already the right length alone', () => {
    const lane = rampLane(envelopeValueLength(2, THREE_FOUR));
    const before = [...lane.values];
    ensureLaneSize(lane, envelopeValueLength(2, THREE_FOUR));
    expect(lane.values).toEqual(before);
  });

  it('grows by holding the last value, so the curve extends flat', () => {
    const lane = rampLane(envelopeValueLength(1, THREE_FOUR));
    const head = [...lane.values];
    const longer = envelopeValueLength(2, THREE_FOUR);
    expect(longer).toBeGreaterThan(head.length); // guard: this really is a grow
    ensureLaneSize(lane, longer);
    expect(lane.values.length).toBe(longer);
    expect(lane.values.slice(0, head.length)).toEqual(head);
    expect(new Set(lane.values.slice(head.length))).toEqual(new Set([head[head.length - 1]]));
  });

  it('truncates in place, and the tail is not kept anywhere', () => {
    // The real case: a 3/4 session saved before the length owner existed stored
    // `lengthBars * 16 * SUB_RES`; the live tick now wraps at the meter-correct
    // (shorter) length and clip-auto-strip's first draw trims the array to match.
    const oldLength = envelopeValueLength(2, DEFAULT_METER); // the old 16-step bar
    const meterCorrect = envelopeValueLength(2, THREE_FOUR);
    expect(meterCorrect).toBeLessThan(oldLength); // guard: this really is a trim
    const lane = rampLane(oldLength);
    const saved = [...lane.values];
    ensureLaneSize(lane, meterCorrect);
    // Same array object the live audio path reads — trimmed, not replaced.
    expect(lane.values.length).toBe(meterCorrect);
    expect(lane.values).toEqual(saved.slice(0, meterCorrect));
  });

  it('PADS the same old save when the meter has a longer bar — nothing is lost', () => {
    // The other side, and the reason the trim above is not "any meter but 4/4":
    // 5/4 counts 20 steps to a bar where the old constant counted 16, so the
    // stored array is SHORT and the grow branch runs. A 5/4 session saved before
    // the length owner existed keeps its whole curve.
    const oldLength = envelopeValueLength(2, DEFAULT_METER);
    const meterCorrect = envelopeValueLength(2, FIVE_FOUR);
    expect(meterCorrect).toBeGreaterThan(oldLength); // guard: this really is a grow
    const lane = rampLane(oldLength);
    const saved = [...lane.values];
    ensureLaneSize(lane, meterCorrect);
    expect(lane.values.length).toBe(meterCorrect);
    expect(lane.values.slice(0, saved.length)).toEqual(saved); // every stored slot survived
  });

  it('splits the common meters into a padding half and a truncating half', () => {
    // The arithmetic the destructive branch's comment names, made executable:
    // stepsPerBar = num*16/den, so the pre-fix `lengthBars*16*SUB_RES` array is
    // short wherever a bar is LONGER than a whole note and long wherever it is
    // shorter. Compared against the 4/4 length rather than against 16 directly,
    // so the meter owner stays the one that decides.
    const four = envelopeValueLength(2, DEFAULT_METER);
    const pads: TimeSignature[] = [{ num: 5, den: 4 }, { num: 9, den: 8 }, { num: 12, den: 8 }];
    const trims: TimeSignature[] = [
      { num: 3, den: 4 }, { num: 2, den: 4 }, { num: 6, den: 8 }, { num: 7, den: 8 },
    ];
    for (const m of pads) expect(envelopeValueLength(2, m)).toBeGreaterThan(four);
    for (const m of trims) expect(envelopeValueLength(2, m)).toBeLessThan(four);
  });

  it('never goes negative, whatever the caller asks for', () => {
    const lane = rampLane(8);
    ensureLaneSize(lane, -5);
    expect(lane.values.length).toBe(0);
  });
});
