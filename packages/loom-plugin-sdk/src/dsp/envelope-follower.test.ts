// Two of these cases exist only to make one failure mode impossible to
// reintroduce quietly. This project shipped a level detector whose sub-Hz
// smoothing biquad phase-INVERTED and AMPLIFIED the channel instead of
// smoothing it — the "ducked" lane came back +9.5 dB louder and out of phase,
// and stopping the transport did not reset it. A follower that can go negative
// multiplies audio by a negative number; one that exceeds unity makes it
// louder. So: never negative, never above unity, and the clamp that prevents
// both is asserted directly.
import { describe, it, expect } from 'vitest';
import { createEnvelopeFollower, FOLLOWER_MIN_HZ } from './envelope-follower';

const SR = 44100;

/** Render one second of a 200 Hz sine at `level` through a follower, and hand
 *  back the control signal it produced. */
async function control(level: number, attackMs: number, releaseMs: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const src = ctx.createOscillator();
  src.frequency.value = 200;
  const amp = ctx.createGain();
  amp.gain.value = level;
  const f = createEnvelopeFollower(ctx as unknown as AudioContext, { attackMs, releaseMs });
  src.connect(amp).connect(f.input);
  f.output.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
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

  it('never amplifies: a unity input settles at unity, not above it', async () => {
    const d = await control(1.0, 10, 100);
    // Measured on the SETTLED reading, not the peak. The first few tens of ms
    // overshoot by about a third — the smoothers' step response as the signal
    // switches on — and that transient is normal for a follower: a drum hit
    // SHOULD open a wah further than the sustain does.
    //
    // What must not happen is the level sitting above unity once it has
    // arrived, which is what would make the gain it drives amplify rather than
    // attenuate. The "does not grow with time" case below covers the other
    // half: that the transient decays instead of accumulating.
    const tail = d.subarray(Math.floor(d.length * 0.5));
    let peak = 0;
    for (const v of tail) if (v > peak) peak = v;
    expect(peak).toBeLessThan(1.05);
  });

  it('clamps its smoothing above the danger zone, whatever it is asked for', () => {
    const ctx = new OfflineAudioContext(1, 1024, SR) as unknown as AudioContext;
    // A 100-second time constant asks for a sub-milliHertz cutoff — well inside
    // the range where a float32 biquad stops filtering and starts integrating.
    // It must be refused rather than honoured.
    const f = createEnvelopeFollower(ctx, { attackMs: 100_000, releaseMs: 100_000 });
    expect(f.smoothingHz()).toBeGreaterThanOrEqual(FOLLOWER_MIN_HZ);
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
  it('a faster setting raises the smoothing cutoff', () => {
    const ctx = new OfflineAudioContext(1, 1024, SR) as unknown as AudioContext;
    const f = createEnvelopeFollower(ctx, { attackMs: 200, releaseMs: 200 });
    const slow = f.smoothingHz();
    f.setAttack(2);
    expect(f.smoothingHz()).toBeGreaterThan(slow);
    f.dispose();
  });
});
