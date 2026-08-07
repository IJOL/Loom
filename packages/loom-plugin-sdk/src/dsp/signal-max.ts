// The larger of two signals, sample by sample, built out of native Web Audio
// nodes — no worklet.
//
// It exists because "take whichever is bigger" turns out to be the missing piece
// under two things a filter cannot express on its own, and both of them shipped
// broken for want of it:
//
//   ASYMMETRY. An envelope follower with one smoothing filter has ONE time
//   constant, so attack and release cannot both be knobs. Run a fast chain and a
//   slow one off the same rectifier and take the larger: rising, the fast chain
//   leads, so attack governs; falling, the slow one lags above it, so release
//   governs. (Loom shipped a follower whose release knob was measurably inert
//   because this was believed impossible.)
//
//   MEMORY. "Stay open for N milliseconds after the signal drops" — a gate's
//   hold — reads like a timer, which sounds like per-sample code. It is not: it
//   is the larger of the signal now and the signal N ms ago, and delaying a
//   signal is a DelayNode.
//
// The identity is max(a, b) = (a + b + |a − b|) / 2, and |x| is a WaveShaper
// curve. Nothing here is specific to control signals — it works on audio too,
// though it is an odd thing to want.
//
// ⚠️ Main thread only. This BUILDS NODES; it cannot run inside the worklet.

/** A WaveShaper curve for y = |x|, over the shaper's -1..1 input domain. */
function absCurve(): Float32Array {
  const n = 1025;                       // odd, so one sample lands exactly on 0
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.abs((i * 2) / (n - 1) - 1);
  return c;
}

export interface SignalMax {
  /** Feed one signal here. */
  readonly a: AudioNode;
  /** ...and the other here. */
  readonly b: AudioNode;
  /** max(a, b). */
  readonly output: AudioNode;
  dispose(): void;
}

/**
 * @param headroom How far outside ±1 the DIFFERENCE of the two inputs may run.
 *   The shaper's curve is only defined over -1..1 and CLAMPS outside it, so the
 *   difference is scaled into that window and back out again — without this, two
 *   signals whose difference exceeds unity would have it silently clipped and
 *   the result would be wrong exactly in the loud case.
 */
export function createSignalMax(ctx: AudioContext, headroom = 4): SignalMax {
  const a = ctx.createGain();
  const b = ctx.createGain();

  const sum = ctx.createGain();
  a.connect(sum);
  b.connect(sum);

  const diff = ctx.createGain();
  const negate = ctx.createGain(); negate.gain.value = -1;
  a.connect(diff);
  b.connect(negate).connect(diff);

  const preAbs = ctx.createGain(); preAbs.gain.value = 1 / headroom;
  const absShape = ctx.createWaveShaper();
  absShape.curve = absCurve() as Float32Array<ArrayBuffer>;
  absShape.oversample = 'none';
  const postAbs = ctx.createGain(); postAbs.gain.value = headroom;
  diff.connect(preAbs).connect(absShape).connect(postAbs);

  const output = ctx.createGain(); output.gain.value = 0.5;
  sum.connect(output);
  postAbs.connect(output);

  return {
    a, b, output,
    dispose: () => {
      for (const n of [a, b, sum, diff, negate, preAbs, absShape, postAbs, output]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
}
