// What the ÷1.4 re-trim on fm and karplus actually preserved.
//
// Those two engines scaled RAW velocity (the worklet port dropped the shared
// `0.3 + 1.1·v` curve). Restoring the curve multiplies a full-velocity note by
// velGain01(1) = 1.4, so ENGINE_TRIM.fm and ENGINE_TRIM.karplus were divided by
// it. That holds the FULL-velocity level — and only that: the restored curve has
// a floor where raw velocity had none, so every softer note is louder than it
// used to be, by more the softer it gets. These cases pin that shape so the
// comment on those two constants stays checkable.
import { describe, it, expect } from 'vitest';
import { ENGINE_TRIM } from './gain-staging';
import { velGain01, velNorm, DEFAULT_VELOCITY } from '../core/velocity-gain';

/** The trims as they stood while the curve was missing, straight off the
 *  comments in gain-staging.ts: they multiplied v01 with nothing in front. */
const PRE_FIX_TRIM: Record<string, number> = { fm: 0.25, karplus: 1.2 };

/** Level now over level then, at the same note velocity. */
function levelRatio(id: string, v01: number): number {
  return (ENGINE_TRIM[id] * velGain01(v01, false)) / (PRE_FIX_TRIM[id] * v01);
}

describe('the ÷1.4 re-trim on fm and karplus', () => {
  for (const id of Object.keys(PRE_FIX_TRIM)) {
    describe(id, () => {
      it('leaves a full-velocity note where it was', () => {
        // 2 decimals because the stored trims are rounded to three (0.25/1.4 is
        // 0.17857…, stored 0.179), which is the only slack here.
        expect(levelRatio(id, 1)).toBeCloseTo(1, 2);
      });

      it('makes the app default velocity LOUDER than it was', () => {
        // The part the comment used to get wrong: 90 is what a freshly drawn
        // note carries, and it does not sit at the preserved point.
        expect(levelRatio(id, velNorm(DEFAULT_VELOCITY))).toBeGreaterThan(levelRatio(id, 1));
      });

      it('lifts more the softer the note, across the whole range', () => {
        const vs = [1, velNorm(DEFAULT_VELOCITY), 0.5, 0.25, 0.1];
        const ratios = vs.map((v) => levelRatio(id, v));
        for (let i = 1; i < ratios.length; i++) {
          expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
        }
        // …and nowhere in the range is a note quieter than it used to be.
        expect(Math.min(...ratios)).toBeGreaterThanOrEqual(ratios[0]);
      });
    });
  }

  it('moves both engines by the same factor, so their balance is untouched', () => {
    for (const v of [1, velNorm(DEFAULT_VELOCITY), 0.25]) {
      expect(levelRatio('fm', v) / levelRatio('karplus', v)).toBeCloseTo(1, 2);
    }
  });
});
