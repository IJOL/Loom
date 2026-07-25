// ensureLaneSize — the one place an envelope array is resized to the length the
// clip needs. It had no coverage, and one of its two branches THROWS DATA AWAY,
// so what it does to an over-long lane is worth pinning: a session saved before
// the envelope length became meter-correct carries a longer array in any meter
// but 4/4, and the first draw of that lane trims it for good.
import { describe, it, expect } from 'vitest';
import { ensureLaneSize } from './automation-painter';
import { envelopeValueLength } from '../core/clip-envelope-length';
import { DEFAULT_METER, type TimeSignature } from '../core/meter';

const THREE_FOUR: TimeSignature = { num: 3, den: 4 };

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

  it('never goes negative, whatever the caller asks for', () => {
    const lane = rampLane(8);
    ensureLaneSize(lane, -5);
    expect(lane.values.length).toBe(0);
  });
});
