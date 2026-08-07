// The shared chorus/flanger graph had no test of its own, and it is published
// SDK API: an untested primitive here is a promise to third parties that
// nothing verifies — the rule the engine migration applied to `unison` and
// `fold`.
//
// Everything is measured against a control render, never an absolute figure.
// What a modulated delay IS, is a comb whose notches MOVE, so the claim to
// prove is always "more than the same graph standing still".
import { describe, it, expect } from 'vitest';
import { createModulatedDelay, type ModulatedDelaySpec } from './modulated-delay';
import { rms } from '../../../../test/dsp-asserts';

const SR = 44100;

const CHORUS: ModulatedDelaySpec  = { baseDelaySec: 0.018, sweepSec: 0.006,  maxFeedback: 0 };
const FLANGER: ModulatedDelaySpec = { baseDelaySec: 0.002, sweepSec: 0.0018, maxFeedback: 0.9 };

/** Render one second of a 220 Hz sine through the graph. `set` stands in for
 *  the knobs at their committed values. */
async function render(spec: ModulatedDelaySpec, set: Record<string, number> = {}): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = createModulatedDelay(ctx as unknown as AudioContext, spec);
  for (const [id, v] of Object.entries(set)) fx.setBaseValue(id, v);
  const osc = ctx.createOscillator();
  osc.frequency.value = 220;
  osc.connect(fx.input);
  fx.output.connect(ctx.destination);
  osc.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** How much the level moves over the render, as a fraction of its own mean.
 *  A static comb holds one level; a swept comb breathes. */
function levelSwing(buf: Float32Array, windows = 20): number {
  const size = Math.floor(buf.length / windows);
  const levels: number[] = [];
  for (let w = 0; w < windows; w++) {
    levels.push(rms(buf.subarray(w * size, (w + 1) * size)));
  }
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  return mean === 0 ? 0 : (Math.max(...levels) - Math.min(...levels)) / mean;
}

describe('modulated delay — the LFO is what makes it an effect', () => {
  it('sweeps the comb: the level breathes far more than with the LFO held still', async () => {
    const moving = levelSwing(await render(CHORUS, { depth: 1, mix: 0.5, rate: 4 }));
    // The control: identical graph, identical mix, depth 0 — the delay time
    // stops moving and the comb stands still.
    const still = levelSwing(await render(CHORUS, { depth: 0, mix: 0.5, rate: 4 }));
    expect(moving).toBeGreaterThan(still * 2);
  });

  it('mix 0 hands back the dry signal', async () => {
    const dry = await render(CHORUS, { mix: 0, depth: 1 });
    const ctx = new OfflineAudioContext(1, SR, SR);
    const osc = ctx.createOscillator();
    osc.frequency.value = 220;
    osc.connect(ctx.destination);
    osc.start();
    const bare = (await ctx.startRendering()).getChannelData(0);
    // Relative to the untouched source, not to a magnitude of its own.
    expect(rms(dry)).toBeGreaterThan(rms(bare) * 0.99);
    expect(rms(dry)).toBeLessThan(rms(bare) * 1.01);
  });
});

describe('modulated delay — feedback belongs to the flanger alone', () => {
  it('feedback keeps the effect sounding after the source stops', async () => {
    // What a feedback path IS: the delay line feeding itself, so energy
    // survives the input. Measured on the tail after the oscillator stops,
    // against the same graph with feedback at zero — not against a magnitude.
    //
    // TWO WRONG VERSIONS OF THIS TEST ARE WORTH RECORDING, because both were
    // wrong about the effect rather than about the code:
    //
    //   1. It first asserted that feedback widens the level swing. It does not,
    //      and the measurement said so: 0.114 against 0.114. Resonance is not
    //      amplitude modulation.
    //   2. It then measured the tail from 0.55 s — fifty milliseconds after the
    //      source stops. A flanger's line is TWO MILLISECONDS long, so by then
    //      even 0.81 effective feedback has passed through it twenty-five times
    //      and decayed to dust (1.5e-3). The measurement was of nothing, and the
    //      absolute floor it was checked against was invented, not derived.
    //
    // So the window starts 5 ms after the stop: past the longest delay the line
    // can hold (2 ms base + 1.8 ms of sweep), which is what makes everything in
    // it the feedback path and nothing else.
    const tail = async (feedback: number) => {
      const ctx = new OfflineAudioContext(1, SR, SR);
      const fx = createModulatedDelay(ctx as unknown as AudioContext, FLANGER);
      fx.setBaseValue('depth', 1);
      fx.setBaseValue('mix', 1);
      fx.setBaseValue('feedback', feedback);
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      osc.connect(fx.input);
      fx.output.connect(ctx.destination);
      osc.start();
      osc.stop(0.5);
      const out = (await ctx.startRendering()).getChannelData(0);
      return {
        during: rms(out.subarray(Math.floor(SR * 0.2), Math.floor(SR * 0.45))),
        after:  rms(out.subarray(Math.floor(SR * 0.505), Math.floor(SR * 0.56))),
      };
    };
    const none = await tail(0);
    const some = await tail(0.3);
    const lots = await tail(0.9);

    // The control is not "small", it is EXACTLY nothing: with no feedback path
    // the line has emptied before the window opens. That is what stops the
    // ordering below from being an ordering over numerical dust.
    expect(none.after).toBe(0);
    // More feedback, more tail — three points, so a single lucky pair cannot
    // carry it.
    expect(lots.after).toBeGreaterThan(some.after * 2);
    // And against the SIGNAL's own level, which is the comparison the second
    // version promised in a comment and never actually made.
    expect(lots.after).toBeGreaterThan(lots.during * 0.1);
  });

  it('the two shipped configurations do not sound the same', () => {
    // Inherited from the chorus/flanger test when those two became separate
    // plugins. The claim is not about either of them — it is about this graph:
    // that its spec really steers the sound, so a chorus and a flanger built
    // from it are two effects and not one with two names.
    return (async () => {
      const c = await render(CHORUS,  { mix: 0.6, rate: 1, depth: 0.7 });
      const f = await render(FLANGER, { mix: 0.6, rate: 1, depth: 0.7 });
      let d = 0;
      for (let i = 0; i < c.length; i++) d += Math.abs(c[i] - f[i]);
      expect(d / c.length / Math.max(1e-9, rms(c))).toBeGreaterThan(0.05);
    })();
  });

  it('a spec with no feedback ceiling refuses a feedback write', () => {
    const fx = createModulatedDelay(
      new OfflineAudioContext(1, 128, SR) as unknown as AudioContext, CHORUS,
    );
    fx.setBaseValue('feedback', 0.9);
    // Refused at the source, not silently absorbed into a node nothing is
    // listening to: the getter still reports the untouched default.
    expect(fx.getBaseValue('feedback')).toBe(0.4);
  });
});
