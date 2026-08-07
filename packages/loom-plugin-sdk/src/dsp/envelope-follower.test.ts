// Several of these cases exist only to make one failure mode impossible to
// reintroduce quietly. This project shipped a level detector whose sub-Hz
// smoothing biquad phase-INVERTED and AMPLIFIED the channel instead of
// smoothing it — the "ducked" lane came back +9.5 dB louder and out of phase,
// and stopping the transport did not reset it. A follower that can go negative
// multiplies audio by a negative number. So: never negative, it settles instead
// of climbing, and the clamp that prevents both is asserted directly.
//
// NOT "never above unity". An earlier version of this file claimed that, and a
// review measured it false: the scaling is calibrated for a SINE, so a
// full-scale square settles around 1.56. The claim is pinned below at the
// waveform it is actually true for, and the square is measured rather than
// wished away — a consumer that multiplies audio by this must clamp.
import { describe, it, expect } from 'vitest';
import { createEnvelopeFollower, FOLLOWER_MIN_HZ } from './envelope-follower';

const SR = 44100;

/** Render one second of a 200 Hz wave at `level` through a follower, and hand
 *  back the control signal it produced. */
async function control(
  level: number, attackMs: number, releaseMs: number, type: OscillatorType = 'sine',
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const src = ctx.createOscillator();
  src.frequency.value = 200;
  src.type = type;
  const amp = ctx.createGain();
  amp.gain.value = level;
  const f = createEnvelopeFollower(ctx as unknown as AudioContext, { attackMs, releaseMs });
  src.connect(amp).connect(f.input);
  f.output.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** The control signal after the source has STOPPED — which is the only place
 *  the release time is observable at all. */
async function tailAfterStop(releaseMs: number, atSec: number): Promise<number> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const src = ctx.createOscillator();
  src.frequency.value = 200;
  const f = createEnvelopeFollower(ctx as unknown as AudioContext, { attackMs: 2, releaseMs });
  src.connect(f.input);
  f.output.connect(ctx.destination);
  src.start();
  src.stop(0.5);
  const d = (await ctx.startRendering()).getChannelData(0);
  return d[Math.floor(SR * atSec)];
}

/** The settled reading — past the initial rise. */
const settled = (d: Float32Array) => d[d.length - 1];

describe('envelope follower — it tracks the level', () => {
  it('a louder signal yields a larger control value', async () => {
    const quiet = settled(await control(0.1, 10, 100));
    const loud  = settled(await control(0.8, 10, 100));
    // Relative: louder in, larger out. No absolute figure — the scaling
    // constant is an implementation detail and this must not pin it.
    expect(loud).toBeGreaterThan(quiet * 2);
  });

  it('silence in, nothing out', async () => {
    const d = await control(0, 10, 100);
    expect(settled(d)).toBeLessThan(1e-6);
  });
});

describe('envelope follower — the sidechain failure mode, made impossible', () => {
  it('never inverts: the control signal stays non-negative across its range', async () => {
    // The bug in one assertion. A follower that dips below zero multiplies the
    // audio by a negative number and flips its phase.
    for (const attack of [0.5, 10, 200]) {
      const d = await control(0.8, attack, 500);
      expect(Math.min(...d)).toBeGreaterThanOrEqual(0);
    }
  });

  it('a full-scale SINE settles at unity — and a square does not, by design', async () => {
    // Measured on the SETTLED reading, not the peak. The first tens of ms
    // overshoot — the smoothers' step response as the signal switches on — and
    // that transient is normal for a follower: a drum hit SHOULD open a wah
    // further than the sustain does.
    //
    // The window is the last FIFTH, not the second half, and the reason is the
    // release fix: the startup overshoot now decays at the RELEASE rate rather
    // than the attack rate, because that is what having a release at all means.
    // At release 100 ms it is still on its way down at 0.5 s (1.19) and arrived
    // by 0.8 s (1.02). Reading it at 0.5 s would be measuring the transient this
    // very comment says is expected.
    const peakOfTail = (d: Float32Array) => {
      let p = 0;
      for (const v of d.subarray(Math.floor(d.length * 0.8))) if (v > p) p = v;
      return p;
    };
    expect(peakOfTail(await control(1.0, 10, 100, 'sine'))).toBeLessThan(1.05);

    // The other half of the same fact, stated where someone will read it rather
    // than left as a surprise: the π/2 scaling is calibrated for a sine's mean
    // rectified value, and a square's is higher, so a square reads ABOVE unity.
    // Pinned as an ordering against the sine, not as the measured 1.56, so the
    // test says "squares read higher" and not "squares read this exactly".
    const square = peakOfTail(await control(1.0, 10, 100, 'square'));
    expect(square).toBeGreaterThan(1.2);
  });

  it('clamps its smoothing above the danger zone, whatever it is asked for', () => {
    const ctx = new OfflineAudioContext(1, 1024, SR) as unknown as AudioContext;
    // A 100-second time constant asks for a sub-milliHertz cutoff — well inside
    // the range where a float32 biquad stops filtering and starts integrating.
    // It must be refused rather than honoured. BOTH sides, since either one can
    // be dialled there independently.
    const f = createEnvelopeFollower(ctx, { attackMs: 100_000, releaseMs: 100_000 });
    expect(f.smoothingHz().attack).toBeGreaterThanOrEqual(FOLLOWER_MIN_HZ);
    expect(f.smoothingHz().release).toBeGreaterThanOrEqual(FOLLOWER_MIN_HZ);
    f.dispose();
  });

  it('does not grow with time at a long time constant — it settles', async () => {
    // The integrator bug did not show up as a wrong value, it showed up as a
    // value that kept climbing. Comparing the two halves of a render catches
    // that without inventing a threshold for "too big".
    const d = await control(0.8, 200, 1000);
    const half = Math.floor(d.length / 2);
    const peakOf = (s: Float32Array) => { let p = 0; for (const v of s) if (v > p) p = v; return p; };
    expect(peakOf(d.subarray(half))).toBeLessThan(peakOf(d.subarray(0, half)) * 1.1);
  });
});

describe('envelope follower — the knobs reach the filter', () => {
  it('a faster setting raises the smoothing cutoff, on the side it was set on', () => {
    const ctx = new OfflineAudioContext(1, 1024, SR) as unknown as AudioContext;
    const f = createEnvelopeFollower(ctx, { attackMs: 200, releaseMs: 200 });
    const before = f.smoothingHz();
    f.setAttack(2);
    expect(f.smoothingHz().attack).toBeGreaterThan(before.attack);
    // ...and NOT on the other one. The two sides sharing a cutoff is exactly the
    // bug this test would have caught and did not.
    expect(f.smoothingHz().release).toBe(before.release);
    f.dispose();
  });

  it('RELEASE really governs the fall — the knob a gate is bought for', async () => {
    // The case whose absence let a dead knob ship. The old follower ran one
    // filter pair at the FASTER of the two constants, so with a 2 ms attack the
    // whole 10–1000 ms release range collapsed onto 2 ms: a one-second release
    // closed in under twenty milliseconds, identical to four decimal places.
    // Nothing in this file touched release, so nothing failed.
    //
    // Measured after the source stops, which is the only place release is
    // observable, and stated as an ordering between two settings of the same
    // graph rather than against any figure.
    const short = await tailAfterStop(10, 0.62);
    const long  = await tailAfterStop(1000, 0.62);
    expect(long).toBeGreaterThan(short * 5);
    // And it is a real level, not two flavours of nothing: 120 ms after the
    // source stopped, a one-second release is still holding a meaningful part of
    // what it was holding while the source played.
    expect(long).toBeGreaterThan(0.1);
  });
});
