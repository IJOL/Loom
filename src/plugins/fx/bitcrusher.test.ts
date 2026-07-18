// Bitcrusher: bit-depth reduction (a WaveShaper quantization staircase) plus a
// lo-fi tone lowpass, mixed with the dry signal. All native Web Audio — the
// quantization IS the crush, and a WaveShaperNode does it statelessly, so unlike
// a worklet decimator this renders and is measurable under OfflineAudioContext.
import { describe, it, expect } from 'vitest';
import { bitcrusherPlugin } from './bitcrusher';

const mk = (ctx: BaseAudioContext) => bitcrusherPlugin.kind === 'fx' ? bitcrusherPlugin.create(ctx as unknown as AudioContext) : null!;

async function render(setup: (fx: ReturnType<typeof mk>) => void, secs = 0.3): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.floor(44100 * secs), 44100);
  // A quiet-ish sine: quantization error grows as the staircase coarsens.
  const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 220;
  const amp = ctx.createGain(); amp.gain.value = 0.8;
  const fx = mk(ctx); setup(fx);
  osc.connect(amp).connect(fx.input); fx.output.connect(ctx.destination);
  osc.start();
  return (await ctx.startRendering()).getChannelData(0);
}
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
/** Distance from a clean reference: how much the crusher has mangled the wave. */
function mangle(a: Float32Array, b: Float32Array): number {
  let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
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

  it('stays bounded', async () => {
    const b = await render((fx) => { fx.setBaseValue('mix', 1); fx.setBaseValue('bits', 1); fx.setBaseValue('tone', 20000); });
    let peak = 0; for (const v of b) { const a = Math.abs(v); if (a > peak) peak = a; }
    expect(peak).toBeLessThan(2);
    expect(Number.isFinite(peak)).toBe(true);
  });

  it('round-trips its params', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = mk(ctx);
    fx.setBaseValue('bits', 5); fx.setBaseValue('tone', 4000); fx.setBaseValue('mix', 0.7);
    expect(fx.getBaseValue('bits')).toBeCloseTo(5, 3);
    expect(fx.getBaseValue('tone')).toBeCloseTo(4000, 3);
    expect(fx.getBaseValue('mix')).toBeCloseTo(0.7, 3);
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
    return (await ctx.startRendering()).getChannelData(0);
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
