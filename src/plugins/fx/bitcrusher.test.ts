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
