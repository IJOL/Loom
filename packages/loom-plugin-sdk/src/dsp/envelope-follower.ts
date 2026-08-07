// An envelope follower: turns an audio signal into a control signal that tracks
// how loud it is. Rectify, then smooth. The auto-wah steers a filter with it and
// the gate opens and closes a gain with it — two plugins, one primitive, which
// is the point of publishing it here rather than writing it twice.
//
// ⚠️ THE SMOOTHING FLOOR IS NOT A TUNING CHOICE. This project already shipped a
// level detector that destroyed the signal it was watching: its smoothing was a
// pair of biquad lowpasses whose cutoff came from the time constants, and at a
// 0.25 s release that lands at 0.64 Hz — where a float32 biquad stops filtering
// and starts integrating. Measured in Chrome, the output grew 1.06 → 17.3 in
// four seconds with the input at exactly zero, so the "ducked" lane came back
// phase-inverted and +9.5 dB LOUDER, and stopping the transport did not reset
// it. See src/audio-dsp/duck-detector.ts for the full autopsy.
//
// So the cutoff is clamped at FOLLOWER_MIN_HZ and a test asserts the clamp holds
// even when asked for a 100-second time constant. Do not lower it to get a
// smoother envelope: below this the filter is no longer a filter.
//
// This is a main-thread GRAPH builder, not a per-sample kernel — it makes native
// Web Audio nodes and cannot run inside the worklet.

/** Hz. The floor the smoothing filter is clamped to. Public so a test can
 *  assert the clamp rather than restate the number. */
export const FOLLOWER_MIN_HZ = 2;

export interface EnvelopeFollowerOptions {
  /** How fast the envelope rises, in milliseconds. */
  attackMs: number;
  /** How fast it falls, in milliseconds. */
  releaseMs: number;
}

export interface EnvelopeFollower {
  /** Feed the signal to be measured here. */
  readonly input: AudioNode;
  /** A LEVEL ESTIMATE, not a normalised one. Calibrated so a full-scale SINE
   *  settles at 1.0; a square reads about 1.56, because its mean rectified value
   *  really is higher — see the calibration note by `scale` below. Anything that
   *  multiplies audio by this must clamp or the loud case gets louder. */
  readonly output: AudioNode;
  setAttack(ms: number): void;
  setRelease(ms: number): void;
  /** The two smoothing cutoffs actually in force, in Hz. Exposed so a test can
   *  prove the clamp, and prove the two sides are really independent, rather
   *  than trust either. */
  smoothingHz(): { attack: number; release: number };
  dispose(): void;
}

/** A time constant in ms → the cutoff of a one-pole with that constant, floored.
 *  τ and f are related by f = 1/(2πτ); the floor is what the header is about. */
function cutoffFor(ms: number): number {
  const tau = Math.max(0.01, ms) / 1000;
  return Math.max(FOLLOWER_MIN_HZ, 1 / (2 * Math.PI * tau));
}

/** A rectifying curve for a WaveShaper: y = |x|. 1024 points is ample — the
 *  curve is a straight line either side of zero, so the table's resolution
 *  costs nothing in accuracy. */
function absCurve(): Float32Array {
  const n = 1025;                       // odd, so one sample lands exactly on 0
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.abs((i * 2) / (n - 1) - 1);
  return c;
}

export function createEnvelopeFollower(
  ctx: AudioContext, opts: EnvelopeFollowerOptions,
): EnvelopeFollower {
  const input = ctx.createGain();

  // 1. Rectify. A WaveShaper with an absolute-value curve, so both halves of
  //    the wave contribute — a follower that only saw the positive half would
  //    report half the level and lag by up to a cycle.
  const rectify = ctx.createWaveShaper();
  rectify.curve = absCurve() as Float32Array<ArrayBuffer>;
  rectify.oversample = 'none';           // measuring a level, not making sound

  // 2. Smooth, TWICE — this is what makes attack and release two knobs instead
  //    of one. An earlier version ran a single filter pair at
  //    `max(cutoffFor(attack), cutoffFor(release))` and this comment claimed a
  //    real asymmetric follower "needs per-sample state, which is a worklet".
  //    That was simply wrong, and the cost of being wrong was measured: the
  //    faster constant always won, so with a gate at attack 2 ms the release
  //    knob was INERT over its whole 10–1000 ms range — a 1-second release
  //    closed in under twenty milliseconds, identical to four decimal places.
  //    A noise gate's release is the control it is bought for.
  //
  //    max(a, b) is expressible in native nodes: (a + b + |a − b|) / 2, and the
  //    absolute value is a WaveShaper — the same one this file already builds to
  //    rectify. Feed the rectified signal down a FAST chain and a SLOW one and
  //    take the larger: rising, the fast chain is ahead, so attack governs;
  //    falling, the slow chain lags above it, so release governs.
  //
  //    Two poles per chain, not one: a single pole leaves audible ripple at low
  //    input frequencies and the second costs almost nothing. Q at 0.5 keeps
  //    them from resonating — a peaking smoother would report a level the signal
  //    never had.
  const mkChain = () => {
    const a = ctx.createBiquadFilter();
    const b = ctx.createBiquadFilter();
    for (const f of [a, b]) { f.type = 'lowpass'; f.Q.value = 0.5; }
    a.connect(b);
    return { head: a, tail: b };
  };
  const fast = mkChain();
  const slow = mkChain();
  rectify.connect(fast.head);
  rectify.connect(slow.head);

  // (a + b) and (a − b).
  const sum = ctx.createGain();
  const diff = ctx.createGain();
  const negate = ctx.createGain(); negate.gain.value = -1;
  fast.tail.connect(sum);
  slow.tail.connect(sum);
  fast.tail.connect(diff);
  slow.tail.connect(negate).connect(diff);

  // |a − b|. The shaper's curve is only defined over −1..1 and CLAMPS outside
  // it, so the difference is scaled down into that window and back out again —
  // otherwise a signal hotter than full scale would silently have its
  // difference clipped and the max would come out wrong in the loud case.
  const ABS_HEADROOM = 4;
  const preAbs  = ctx.createGain(); preAbs.gain.value  = 1 / ABS_HEADROOM;
  const absShape = ctx.createWaveShaper();
  absShape.curve = absCurve() as Float32Array<ArrayBuffer>;
  absShape.oversample = 'none';
  const postAbs = ctx.createGain(); postAbs.gain.value = ABS_HEADROOM;
  diff.connect(preAbs).connect(absShape).connect(postAbs);

  const max = ctx.createGain(); max.gain.value = 0.5;
  sum.connect(max);
  postAbs.connect(max);

  // 3. Scale. Rectifying a sine gives a mean of 2/π ≈ 0.637 of its peak, so
  //    without this a full-scale input would report ~0.64 and every downstream
  //    range would quietly be short by a third. It is calibrated FOR A SINE and
  //    nothing else: a square's mean rectified value is its peak, so a
  //    full-scale square settles at π/2 ≈ 1.57, measured. That is not a bug —
  //    the follower reports level, it does not normalise it — but a consumer
  //    that multiplies audio by this signal must clamp, or the loud case gets
  //    louder. Said again on `output` in the interface, where a caller reads it.
  const scale = ctx.createGain();
  scale.gain.value = Math.PI / 2;

  input.connect(rectify);
  max.connect(scale);

  let attackMs = opts.attackMs;
  let releaseMs = opts.releaseMs;

  const apply = () => {
    const aHz = cutoffFor(attackMs);
    const rHz = cutoffFor(releaseMs);
    fast.head.frequency.value = aHz; fast.tail.frequency.value = aHz;
    slow.head.frequency.value = rHz; slow.tail.frequency.value = rHz;
  };
  apply();

  return {
    input,
    output: scale,
    setAttack: (ms) => { attackMs = ms; apply(); },
    setRelease: (ms) => { releaseMs = ms; apply(); },
    smoothingHz: () => ({ attack: fast.head.frequency.value, release: slow.head.frequency.value }),
    dispose: () => {
      for (const n of [input, rectify, fast.head, fast.tail, slow.head, slow.tail,
                       sum, diff, negate, preAbs, absShape, postAbs, max, scale]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
}
