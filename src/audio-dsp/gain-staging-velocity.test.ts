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
import { velGain01, velNorm, DEFAULT_VELOCITY } from '../core/velocity-gain';
import karplusPlugin from '../../plugins/karplus/plugin.json';
import fmPlugin from '../../plugins/fm/plugin.json';

/** The trims as they stood while the curve was missing, straight off the
 *  comments in gain-staging.ts: they multiplied v01 with nothing in front. */
const PRE_FIX_TRIM: Record<string, number> = { fm: 0.25, karplus: 1.2 };

/** The per-engine trims this test compares against history. BOTH now live in
 *  their plugin manifests — the host's ENGINE_TRIM table is gone with the last
 *  built-in melodic engine — so reading them HERE is what keeps the ported
 *  plugins honest about values that were tuned by ear. */
const TRIM: Record<string, number> = {
  fm: fmPlugin.components[0].capabilities.outputTrim,
  karplus: karplusPlugin.components[0].capabilities.outputTrim,
};

/** Level now over level then, at the same note velocity. */
function levelRatio(id: string, v01: number): number {
  return (TRIM[id] * velGain01(v01, false)) / (PRE_FIX_TRIM[id] * v01);
}

/** The lift in closed form — the restored curve over the raw velocity it
 *  replaced, once the trim has been divided by velGain01(1) = 1.4. This is the
 *  expression the comment on those two constants quotes, written independently
 *  of the stored (rounded) numbers so it is something to check them AGAINST. */
function closedFormLift(v01: number): number {
  return (0.3 + 1.1 * v01) / (1.4 * v01);
}

/** The softest note a clip can carry. `velNorm` clamps at 0 and MIDI velocity 0
 *  is a note-off, so velocity 1 is the real bottom of the range — not the 0.1
 *  the sampled cases below stop at. */
const BOTTOM = velNorm(1);

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
        const vs = [1, velNorm(DEFAULT_VELOCITY), 0.5, 0.25, 0.1, BOTTOM];
        const ratios = vs.map((v) => levelRatio(id, v));
        for (let i = 1; i < ratios.length; i++) {
          expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
        }
        // …and nowhere in the range is a note quieter than it used to be.
        expect(Math.min(...ratios)).toBeGreaterThanOrEqual(ratios[0]);
      });

      it('follows the closed form the constants\' comment quotes', () => {
        // Ratio against ratio, so this pins the SHAPE rather than a magnitude.
        // 2 decimals is the slack from the trims being stored rounded to three
        // (0.25/1.4 = 0.17857…, stored 0.179 — worth about 0.02 dB).
        for (const v of [1, velNorm(DEFAULT_VELOCITY), 0.25, 0.1, BOTTOM]) {
          expect(levelRatio(id, v) / closedFormLift(v)).toBeCloseTo(1, 2);
        }
      });

      it('lifts the bottom of the range far past where these cases stop', () => {
        // The number the comment used to call "the very bottom" (~+9 dB) is the
        // lift at v = 0.1, which is only the lowest point sampled above. At the
        // real bottom, MIDI velocity 1, the lift is exactly 28× — (0.3·127 +
        // 1.1)/1.4 = 39.2/1.4, about +29 dB — and it has no bound as v → 0.
        // Asserted as a ratio between two points on the same curve.
        expect(levelRatio(id, BOTTOM) / levelRatio(id, 0.1)).toBeGreaterThan(3);
        expect(closedFormLift(BOTTOM) / 28).toBeCloseTo(1, 9);
      });
    });
  }

  it('moves both engines by the same factor, so their balance is untouched', () => {
    for (const v of [1, velNorm(DEFAULT_VELOCITY), 0.25]) {
      expect(levelRatio('fm', v) / levelRatio('karplus', v)).toBeCloseTo(1, 2);
    }
  });
});
