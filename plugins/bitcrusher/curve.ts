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
    curve[i] = Math.max(-1, Math.min(1, Math.round(x / step) * step));
  }
  return curve;
}
