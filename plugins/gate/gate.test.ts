// What a gate IS: below the threshold the signal is held down, above it it
// passes. Every case compares two renders of the SAME source at different
// levels, normalised by that level — so what is measured is the FRACTION that
// got through, not how loud the input was.
import { describe, it, expect, beforeAll } from 'vitest';
import type { FxInstance } from '@loom/plugin-sdk';
import manifest from './plugin.json';

let create: (ctx: AudioContext) => FxInstance;
beforeAll(async () => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    registerFx: (_id: string, c: (ctx: AudioContext) => FxInstance) => { create = c; },
  };
  await import('./main');
});

const SR = 44100;
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

/** The fraction of the input that survived. Normalised by `level`, so a quiet
 *  and a loud render are directly comparable. */
async function through(level: number, set: Record<string, number> = {}): Promise<number> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const src = ctx.createOscillator();
  src.frequency.value = 200;
  const amp = ctx.createGain();
  amp.gain.value = level;
  const fx = create(ctx as unknown as AudioContext);
  for (const [id, v] of Object.entries(set)) fx.setBaseValue(id, v);
  src.connect(amp).connect(fx.input);
  fx.output.connect(ctx.destination);
  src.start();
  // Past the follower's rise, so this is the settled state and not the attack.
  const d = (await ctx.startRendering()).getChannelData(0).slice(Math.floor(SR * 0.5));
  return rms(d) / level;
}

describe('gate', () => {
  it('registers under the id its manifest declares', () => {
    expect(manifest.components[0].id).toBe('gate');
    expect(create).toBeTypeOf('function');
  });

  it('passes a signal above the threshold and holds down one below it', async () => {
    const loud  = await through(0.8,  { threshold: -24 });
    const quiet = await through(0.01, { threshold: -24 });
    // Relative: the loud signal keeps far more of ITSELF than the quiet one
    // keeps of itself. Both sides are already normalised by their own level.
    expect(loud).toBeGreaterThan(quiet * 5);
  });

  it('a higher threshold shuts out a signal that used to pass', async () => {
    // The same input, judged against two thresholds — which is what proves the
    // knob reaches the curve rather than storing a number.
    const open   = await through(0.2, { threshold: -40 });
    const closed = await through(0.2, { threshold: -6 });
    expect(closed).toBeLessThan(open * 0.5);
  });

  it('range is how far DOWN a closed gate goes, not whether it closes', async () => {
    // At -60 dB the gate is effectively shut; at -6 it is a gentle duck that
    // keeps the room tone. Same input, both below the threshold.
    const shut   = await through(0.01, { threshold: -12, range: -60 });
    const gentle = await through(0.01, { threshold: -12, range: -6 });
    expect(gentle).toBeGreaterThan(shut * 2);
  });

  it('release holds the tail open — the knob a gate is bought for', async () => {
    // The case whose absence let a dead knob ship. The follower used to run one
    // filter pair at the FASTER of attack and release, so with the gate's 2 ms
    // attack the entire 10–1000 ms release range collapsed to 2 ms: measured, a
    // 1-second release closed in under twenty milliseconds, identical to four
    // decimal places. Every gate test passed, because none of them touched it.
    //
    // The source must DROP below the threshold, not stop: a gate passes a
    // signal, it does not make one, so after silence the output is silence at
    // any release and the comparison is 0 against 0. (Written down because the
    // first version of this test did exactly that and failed for that reason.)
    // A loud burst falling to a quiet tail is also the real case — gating a
    // snare and choosing how much room to keep.
    const tail = async (releaseMs: number) => {
      const ctx = new OfflineAudioContext(1, SR, SR);
      const src = ctx.createOscillator();
      src.frequency.value = 200;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.8, 0);
      amp.gain.setValueAtTime(0.02, 0.5);   // well under the -24 dB threshold
      const fx = create(ctx as unknown as AudioContext);
      fx.setBaseValue('threshold', -24);
      fx.setBaseValue('release', releaseMs);
      src.connect(amp).connect(fx.input);
      fx.output.connect(ctx.destination);
      src.start();
      const d = (await ctx.startRendering()).getChannelData(0).slice();
      // 200–400 ms after the drop. Measured at 20–120 ms instead, a 10 ms
      // release is still on its way down and only 1.7× apart from a 1-second
      // one — true but a thin claim. By here the short release has shut
      // (0.00001) and the long one is still wide open (0.00798).
      return rms(d.subarray(Math.floor(SR * 0.7), Math.floor(SR * 0.9)));
    };
    expect(await tail(1000)).toBeGreaterThan((await tail(10)) * 5);
  });

  it('hold keeps the gate open through a dip that would otherwise close it', async () => {
    // What hold IS, and why a gate needs it: a real drum does not decay
    // smoothly, it wobbles under the threshold and back over it, and a gate with
    // no hold slams on every wobble — the tail machine-guns. So the source here
    // is a loud tone that DIPS briefly and comes back, which is the shape that
    // separates a gate with hold from one without.
    const throughDip = async (holdMs: number) => {
      const ctx = new OfflineAudioContext(1, SR, SR);
      const src = ctx.createOscillator();
      src.frequency.value = 200;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.8, 0);
      amp.gain.setValueAtTime(0.005, 0.30);   // the dip, well under the threshold
      amp.gain.setValueAtTime(0.8, 0.55);
      const fx = create(ctx as unknown as AudioContext);
      fx.setBaseValue('threshold', -24);
      fx.setBaseValue('release', 10);         // short, so only hold can keep it open
      fx.setBaseValue('hold', holdMs);
      src.connect(amp).connect(fx.input);
      fx.output.connect(ctx.destination);
      src.start();
      const d = (await ctx.startRendering()).getChannelData(0).slice();
      // 100 ms into the dip. Measured at 20 ms in, a release of 10 ms has not
      // finished closing yet and the two settings are only 1.5x apart — true,
      // but a thin claim about a knob whose whole job is the difference.
      return rms(d.subarray(Math.floor(SR * 0.40), Math.floor(SR * 0.48)));
    };
    // Same source, same release, same threshold — only the hold differs.
    expect(await throughDip(200)).toBeGreaterThan((await throughDip(0)) * 5);
  });

  it('a threshold near the bottom of its range is still distinguishable', () => {
    // The curve is indexed by LINEAR amplitude while the knob is in dB, so the
    // bottom of the knob is where resolution runs out. At the original table
    // size every threshold below about -54 dB landed on the same grid point —
    // the last stretch of the knob's travel did nothing at all. Compared as
    // curves, because that is where the collapse happened.
    const ctx = new OfflineAudioContext(1, 128, SR) as unknown as AudioContext;
    const curves: Float32Array[] = [];
    const real = ctx.createWaveShaper.bind(ctx);
    ctx.createWaveShaper = () => {
      const n = real();
      let held: Float32Array | null = null;
      Object.defineProperty(n, 'curve', {
        get: () => held,
        set: (v: Float32Array) => { held = v; curves.push(v); },
        configurable: true,
      });
      return n;
    };
    const fx = create(ctx);
    fx.setBaseValue('threshold', -60);
    fx.setBaseValue('threshold', -54);
    const [a, b] = curves.slice(-2);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(0);
  });

  it('answers to every param its manifest declares, at a value it did NOT start on', () => {
    // Writing the manifest's own default proves nothing: every shadow variable
    // is already initialised to it, so a `setBaseValue` that ignored the id
    // entirely would still read back correctly. A review proved exactly that by
    // deleting a knob's branch from a sibling plugin and watching its suite stay
    // green. So: write something else, then read it back.
    const fx = create(new OfflineAudioContext(1, 128, SR) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
      const off = p.default === p.min ? p.max : p.min;
      fx.setBaseValue(p.id, off);
      expect(fx.getBaseValue(p.id), `${p.id} did not take the written value`).toBeCloseTo(off, 5);
      fx.setBaseValue(p.id, p.default);
      expect(fx.getBaseValue(p.id)).toBeCloseTo(p.default, 5);
    }
  });

  it('a redundant threshold write rebuilds nothing', () => {
    // Counted, not inferred from "it did not throw" — the same trap the
    // distortion's equivalent fell into: rebuilding makes a FRESH shaper whose
    // first curve write is legal, so a not-toThrow assertion would stay green.
    const ctx = new OfflineAudioContext(1, 128, SR) as unknown as AudioContext;
    let built = 0;
    const real = ctx.createWaveShaper.bind(ctx);
    ctx.createWaveShaper = () => { built++; return real(); };

    const fx = create(ctx);
    const afterConstruction = built;
    fx.setBaseValue('threshold', fx.getBaseValue('threshold'));
    expect(built).toBe(afterConstruction);

    fx.setBaseValue('threshold', fx.getBaseValue('threshold') - 6);
    expect(built).toBe(afterConstruction + 1);
  });
});
