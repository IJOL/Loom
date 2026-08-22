// The quantization staircase: input −1..1 mapped to `2^bits` evenly-spaced
// levels. Fractional bit counts are honoured (levels = 2^bits) so the knob is
// smooth rather than stepping between integers.
//
// Apart from main.ts because it is pure maths and measurable without a graph —
// the same split the distortion next door makes, for the same reason.

export function crushCurve(bits: number): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  const levels = Math.max(2, Math.pow(2, bits));
  const step = 2 / (levels - 1);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;          // input position, −1..1
    // Rounded in the 0..2 domain, not in −1..1. The difference is where the
    // staircase is ANCHORED: rounding x itself puts a tread on zero and lets
    // the grid fall where it may, so the ends only land on ±1 when the level
    // count is odd — and 2^bits never is. At 8 bits nobody could hear the
    // half-step of slop; at 2 the knob delivered five levels instead of four;
    // at 1 — the bottom of its own range — every input inside (−1, 1) rounded
    // to the single tread at zero and the effect output SILENCE. Shifting by
    // one first pins the ends: level 0 is exactly −1, level (levels−1) is
    // exactly +1, and one bit is the hard square it should always have been.
    curve[i] = Math.max(-1, Math.min(1, Math.round((x + 1) / step) * step - 1));
  }
  return curve;
}
