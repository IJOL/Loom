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
  const d = (await ctx.startRendering()).getChannelData(0).subarray(Math.floor(SR * 0.5));
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

  it('answers to every param its manifest declares', () => {
    const fx = create(new OfflineAudioContext(1, 128, SR) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
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
