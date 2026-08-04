// The transfer curve IS the distortion: `drive` rebuilds it rather than pushing
// the signal harder into a fixed one, so the knob changes the SHAPE of the
// clipping and not just how hard the signal hits it.
//
// It lives apart from main.ts because it is pure maths and can be measured
// without a graph — which is not a preference here but a necessity: the suite's
// audio engine refuses a second write to a WaveShaperNode's curve, so no
// rendered test can move the drive knob. See distortion.test.ts.

export function makeCurve(amount: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 100;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}
