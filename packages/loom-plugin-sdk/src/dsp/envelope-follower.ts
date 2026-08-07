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
  /** A control signal in roughly 0..1, to connect to an AudioParam or a gain. */
  readonly output: AudioNode;
  setAttack(ms: number): void;
  setRelease(ms: number): void;
  /** The smoothing cutoff actually in force, in Hz. Exposed so a test can
   *  prove the clamp rather than trust it. */
  smoothingHz(): number;
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

  // 2. Smooth. Two one-pole-ish lowpasses in series: one pole leaves audible
  //    ripple at low input frequencies, and the second costs almost nothing.
  //    Q at 0.5 keeps them from resonating — a peaking smoother would report a
  //    level the signal never had.
  const smooth1 = ctx.createBiquadFilter();
  const smooth2 = ctx.createBiquadFilter();
  for (const f of [smooth1, smooth2]) { f.type = 'lowpass'; f.Q.value = 0.5; }

  // 3. Scale. Rectifying a sine gives a mean of 2/π ≈ 0.637 of its peak, so
  //    without this a full-scale input would report ~0.64 and every downstream
  //    range would quietly be short by a third.
  const scale = ctx.createGain();
  scale.gain.value = Math.PI / 2;

  input.connect(rectify).connect(smooth1).connect(smooth2).connect(scale);

  let attackMs = opts.attackMs;
  let releaseMs = opts.releaseMs;

  // One filter pair, two time constants: the faster of the two sets the
  // cutoff. A true asymmetric attack/release needs per-sample state, which is
  // a worklet — and an insert is native nodes by design. The audible effect of
  // the pair is dominated by the faster one, so this is the honest native
  // approximation rather than a pretence of two-sided behaviour.
  const apply = () => {
    const hz = Math.max(cutoffFor(attackMs), cutoffFor(releaseMs));
    smooth1.frequency.value = hz;
    smooth2.frequency.value = hz;
  };
  apply();

  return {
    input,
    output: scale,
    setAttack: (ms) => { attackMs = ms; apply(); },
    setRelease: (ms) => { releaseMs = ms; apply(); },
    smoothingHz: () => smooth1.frequency.value,
    dispose: () => {
      for (const n of [input, rectify, smooth1, smooth2, scale]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
}
