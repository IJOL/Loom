// Bitcrusher: bit-depth reduction (a WaveShaper quantization staircase) plus a
// lo-fi tone lowpass, mixed with the dry signal. All native Web Audio — the
// quantization IS the crush, and a WaveShaperNode does it statelessly, so unlike
// a worklet decimator this renders and is measurable under OfflineAudioContext.
import { describe, it, expect, beforeAll } from 'vitest';
import type { FxInstance } from '@loom/plugin-sdk';
import manifest from './plugin.json';
import { crushCurve } from './curve';

// The plugin's own test, run against the plugin the way the host runs it: a
// two-line Loom double captures the factory, which is all main.ts asks of the
// ABI. That is the point — it proves this effect needs nothing from src/.
let create: (ctx: AudioContext) => FxInstance;
beforeAll(async () => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    registerFx: (_id: string, c: (ctx: AudioContext) => FxInstance) => { create = c; },
  };
  await import('./main');
});

const mk = (ctx: BaseAudioContext) => create(ctx as unknown as AudioContext);

async function render(setup: (fx: ReturnType<typeof mk>) => void, secs = 0.3): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.floor(44100 * secs), 44100);
  // A quiet-ish sine: quantization error grows as the staircase coarsens.
  const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 220;
  const amp = ctx.createGain(); amp.gain.value = 0.8;
  const fx = mk(ctx); setup(fx);
  osc.connect(amp).connect(fx.input); fx.output.connect(ctx.destination);
  osc.start();
  return (await ctx.startRendering()).getChannelData(0).slice();
}
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
/** Distance from a clean reference: how much the crusher has mangled the wave.
 *
 *  The guard stays, but what it was guarding is fixed. A render that came back
 *  all zeros or all NaN — twice, and only under the full suite — was never a
 *  bad render. It was a good one, read after node-web-audio-api had freed the
 *  memory behind it, because `render` returned the borrowed view rather than a
 *  copy of it; see test/setup.ts. What is left here is what the guard should
 *  always have been — a sentence rather than a riddle if that class ever comes
 *  back — and a healthy render passes it without noticing. */
function mangle(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      throw new Error(`render produced a non-finite sample at ${i}: ${a[i]} vs ${b[i]}`);
    }
    d += Math.abs(a[i] - b[i]);
  }
  return d / a.length;
}

describe('bitcrusher', () => {
  it('at mix 0 it passes the dry signal', async () => {
    const b = await render((fx) => fx.setBaseValue('mix', 0));
    expect(rms(b)).toBeGreaterThan(0.05);
  });

  it('fewer bits mangle the wave more — a coarser staircase', async () => {
    const clean = await render((fx) => { fx.setBaseValue('mix', 1); fx.setBaseValue('bits', 16); fx.setBaseValue('tone', 20000); });
    const gentle = await render((fx) => { fx.setBaseValue('mix', 1); fx.setBaseValue('bits', 6); fx.setBaseValue('tone', 20000); });
    const harsh  = await render((fx) => { fx.setBaseValue('mix', 1); fx.setBaseValue('bits', 2); fx.setBaseValue('tone', 20000); });
    expect(mangle(harsh, clean)).toBeGreaterThan(mangle(gentle, clean) * 1.5);
  });

  it('the tone lowpass dulls the output — it smooths the crushed staircase', async () => {
    // Total variation (sum of sample-to-sample jumps) is a high-frequency proxy:
    // the crush injects sharp harmonic steps; closing the lowpass smooths them.
    const tv = (b: Float32Array) => { let s = 0; for (let i = 1; i < b.length; i++) s += Math.abs(b[i] - b[i - 1]); return s; };
    const open   = tv(await render((fx) => { fx.setBaseValue('mix', 1); fx.setBaseValue('bits', 3); fx.setBaseValue('tone', 18000); }));
    const closed = tv(await render((fx) => { fx.setBaseValue('mix', 1); fx.setBaseValue('bits', 3); fx.setBaseValue('tone', 500); }));
    expect(closed).toBeLessThan(open);
  });

  it('stays bounded — and is not bounded by being silent', async () => {
    const b = await render((fx) => { fx.setBaseValue('mix', 1); fx.setBaseValue('bits', 1); fx.setBaseValue('tone', 20000); });
    let peak = 0; for (const v of b) { const a = Math.abs(v); if (a > peak) peak = a; }
    expect(peak).toBeLessThan(2);
    expect(Number.isFinite(peak)).toBe(true);
    // The half that was missing. One bit is the bottom of the knob's own range
    // and it rendered pure silence, which sails through every ceiling above.
    // A bound nothing can reach is not a bound.
    expect(rms(b), 'one bit is silent').toBeGreaterThan(0.05);
  });

  it('one bit is a hard square — louder than the sine it came from', async () => {
    const clean = await render((fx) => { fx.setBaseValue('mix', 1); fx.setBaseValue('bits', 16); fx.setBaseValue('tone', 20000); });
    const oneBit = await render((fx) => { fx.setBaseValue('mix', 1); fx.setBaseValue('bits', 1); fx.setBaseValue('tone', 20000); });
    // Two levels, ±1: every sample is driven to full scale, so the RMS rises
    // above the 0.8-peak sine's own. Relative to the source, not a magnitude.
    expect(rms(oneBit)).toBeGreaterThan(rms(clean));
  });

  it('round-trips its params', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = mk(ctx);
    fx.setBaseValue('bits', 5); fx.setBaseValue('tone', 4000); fx.setBaseValue('mix', 0.7);
    expect(fx.getBaseValue('bits')).toBeCloseTo(5, 3);
    expect(fx.getBaseValue('tone')).toBeCloseTo(4000, 3);
    expect(fx.getBaseValue('mix')).toBeCloseTo(0.7, 3);
  });

  it('answers to every param its manifest declares', () => {
    // A knob the graph never reads is a control that does nothing, and the
    // manifest alone cannot catch that.
    expect(manifest.components[0].id).toBe('bitcrusher');
    const fx = mk(new OfflineAudioContext(1, 4410, 44100));
    for (const p of manifest.components[0].params) {
      fx.setBaseValue(p.id, p.default);
      expect(fx.getBaseValue(p.id)).toBeCloseTo(p.default, 5);
    }
  });
});

// Dither is real noise summed in BEFORE the quantizer — it cannot live inside a
// WaveShaper curve, which is a stateless lookup. These render silence so the
// only thing that can reach the output IS the dither.
describe('bitcrusher dither', () => {
  async function renderSilence(dither: number, bits = 4): Promise<Float32Array> {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = mk(ctx);
    fx.setBaseValue('mix', 1);
    fx.setBaseValue('tone', 20000);
    fx.setBaseValue('bits', bits);
    fx.setBaseValue('dither', dither);
    fx.output.connect(ctx.destination);   // nothing connected to fx.input
    return (await ctx.startRendering()).getChannelData(0).slice();
  }

  it('is OFF by default — the crusher stays exactly as clean as it was', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    expect(mk(ctx).getBaseValue('dither')).toBe(0);
  });

  it('adds nothing at all when off: silence in, silence out', async () => {
    expect(rms(await renderSilence(0))).toBe(0);
  });

  it('turned up, it puts noise where there was none', async () => {
    expect(rms(await renderSilence(1))).toBeGreaterThan(0);
  });

  it('more dither means more noise', async () => {
    expect(rms(await renderSilence(2))).toBeGreaterThan(rms(await renderSilence(0.5)));
  });

  // The level tracks the step size: dither that does not scale would vanish at
  // 16 bits and swamp the signal at 2. Both depths here stay well inside what
  // the 2048-point curve can resolve — past ~11 bits the staircase is finer than
  // the curve itself and the comparison would measure the table, not the dither.
  it('scales with the step — a coarser bit depth dithers louder', async () => {
    expect(rms(await renderSilence(1, 3))).toBeGreaterThan(rms(await renderSilence(1, 8)));
  });

  it('round-trips', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = mk(ctx);
    fx.setBaseValue('dither', 1.25);
    expect(fx.getBaseValue('dither')).toBeCloseTo(1.25, 5);
  });
});

// The staircase as pure numbers. Everything above renders it; this asks what it
// IS — because the defect that shipped was not audible as distortion, it was
// audible as nothing at all, and one assertion here would have caught it.
describe('crushCurve', () => {
  const levelsOf = (bits: number) => new Set(Array.from(crushCurve(bits)).map((v) => v.toFixed(6)));

  it('gives exactly 2^bits distinct levels', () => {
    // Five levels out of a 2-bit crusher is not a rounding detail: the knob
    // says four and the ear hears the extra tread on zero as less crush.
    for (const bits of [1, 2, 3, 4]) {
      expect(levelsOf(bits).size, `${bits} bits`).toBe(Math.pow(2, bits));
    }
  });

  it('is symmetric about zero — a crushed wave must not gain a DC offset', () => {
    // The sharper half of the count above. The old staircase produced
    // {-0.667, 0, 0.667, 1} at two bits: four levels, so a headcount passed it,
    // but leaning one way. Quantizing a centred wave on a lopsided grid pushes
    // its average off zero, and DC is the one artefact a lo-fi effect has no
    // excuse for — it costs headroom everywhere downstream and is inaudible
    // until something clips.
    for (const bits of [1, 2, 3, 4]) {
      const levels = Array.from(levelsOf(bits)).map(Number).sort((a, b) => a - b);
      const mirrored = levels.map((v) => -v).sort((a, b) => a - b);
      for (let i = 0; i < levels.length; i++) {
        expect(levels[i], `${bits} bits, level ${i}`).toBeCloseTo(mirrored[i], 5);
      }
    }
  });

  it('reaches both ends — the quietest level is -1 and the loudest +1', () => {
    for (const bits of [1, 2, 3, 8]) {
      const c = crushCurve(bits);
      expect(c[0], `${bits} bits, bottom`).toBeCloseTo(-1, 5);
      expect(c[c.length - 1], `${bits} bits, top`).toBeCloseTo(1, 5);
    }
  });

  it('at one bit it is a square: two levels, no tread on zero', () => {
    const c = crushCurve(1);
    expect(levelsOf(1)).toEqual(new Set(['-1.000000', '1.000000']));
    expect(Array.from(c).some((v) => v === 0)).toBe(false);
  });

  it('at sixteen bits it is close enough to a straight wire', () => {
    const c = crushCurve(16);
    let worst = 0;
    for (let i = 0; i < c.length; i++) {
      worst = Math.max(worst, Math.abs(c[i] - ((i / (c.length - 1)) * 2 - 1)));
    }
    // One step at 16 bits is 3e-5; the curve's own 2048 points are coarser than
    // that, so the bound is the table's resolution, not the quantizer's.
    expect(worst).toBeLessThan(1e-3);
  });
});
