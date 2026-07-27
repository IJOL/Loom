// Sidechain duck detector: the envelope follower behind SIDECHAIN on a lane.
//
// Pure, sample-at-a-time, double precision — no AudioContext, no nodes. It runs
// inside the duck-detector AudioWorklet and is unit-tested here on its own.
//
// WHY IT IS NOT A BiquadFilterNode ANY MORE (measured 2026-07-27, Chrome 48 kHz):
// the previous implementation built the follower out of two `BiquadFilterNode`
// lowpasses whose cutoff came from the time constants — REL 0.25 s → 0.64 Hz. A
// biquad that low has its pole pair a hair from z=1, and in the float32 node
// graph the rounding error accumulates like a double integrator: the "envelope"
// grew without bound (1.06 → 17.3 in 4 s with the input at EXACTLY zero), so the
// duck multiplier drifted 0.99 → 0 → −3.0, i.e. the ducked lane first went silent,
// then came back PHASE-INVERTED and +9.5 dB LOUDER. Stopping the transport did not
// reset it (the drift continued through 5 s of silence), which is what made
// "stop and relaunch the loop" sound so different from a steady run.
//
// A one-pole follower with separate attack/release coefficients has no such pole:
// the state is a convex combination of the input and itself, so it is bounded by
// construction, at ANY time constant, and it returns to zero when the source stops.

export interface DuckParams {
  /** 0..1 — how much of the multiplier the envelope may eat. */
  depth: number;
  /** Seconds to close in on a rising source (63 % of the step). */
  attack: number;
  /** Seconds to open back up when the source falls. */
  release: number;
  /** dBFS floor — a source quieter than this ducks nothing. */
  threshold: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One-pole coefficient for a 63 %-in-`t`-seconds approach. `t` is clamped to a
 *  quarter sample so a zero time constant means "instant", never NaN/Infinity. */
function coef(t: number, sampleRate: number): number {
  const safe = Math.max(t, 0.25 / sampleRate);
  return 1 - Math.exp(-1 / (safe * sampleRate));
}

const dbToLin = (db: number): number => Math.pow(10, db / 20);

export class DuckDetector {
  private env = 0;
  private attackCoef = 1;
  private releaseCoef = 1;
  private depth = 0;
  private thresholdLin = 0;

  constructor(private readonly sampleRate: number, params?: Partial<DuckParams>) {
    this.setParams({ depth: 0.6, attack: 0.005, release: 0.25, threshold: -60, ...params });
  }

  setParams(p: DuckParams): void {
    this.depth = clamp01(p.depth);
    this.attackCoef = coef(p.attack, this.sampleRate);
    this.releaseCoef = coef(p.release, this.sampleRate);
    this.thresholdLin = dbToLin(p.threshold);
  }

  /** Feed one sample of the sidechain SOURCE; get the gain multiplier for the
   *  ducked lane. Always in [0, 1] — that is the invariant the biquad broke. */
  process(x: number): number {
    const rectified = x < 0 ? -x : x;
    // Rise fast (attack) / fall slow (release) — the asymmetry a linear filter
    // cannot express, and the reason this lives in a worklet at all.
    const k = rectified > this.env ? this.attackCoef : this.releaseCoef;
    this.env += (rectified - this.env) * k;
    const over = this.env - this.thresholdLin;
    if (over <= 0) return 1;
    return clamp01(1 - this.depth * (over > 1 ? 1 : over));
  }

  /** Current envelope (0..1-ish) — diagnostics only. */
  get envelope(): number { return this.env; }
}
