// Tremolo: an LFO chopping the output gain. Rendered through OfflineAudioContext
// so we measure the real effect, not just the node graph. Assertions relative.
import { describe, it, expect } from 'vitest';
import { tremoloPlugin } from './tremolo';

const inst = (ctx: BaseAudioContext) => tremoloPlugin.kind === 'fx' ? tremoloPlugin.create(ctx as unknown as AudioContext) : null!;

/** Push a steady tone through the effect and return the rendered samples. */
async function render(setup: (fx: ReturnType<typeof inst>) => void, secs = 1): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.floor(44100 * secs), 44100);
  const osc = ctx.createOscillator(); osc.frequency.value = 220;
  const fx = inst(ctx);
  setup(fx);
  osc.connect(fx.input); fx.output.connect(ctx.destination);
  osc.start();
  const buf = await ctx.startRendering();
  return buf.getChannelData(0);
}

/** Per-window (20 ms) RMS envelope — the shape the tremolo carves. */
function envelope(buf: Float32Array): number[] {
  const w = Math.floor(44100 * 0.02), env: number[] = [];
  for (let i = 0; i + w <= buf.length; i += w) {
    let s = 0; for (let j = i; j < i + w; j++) s += buf[j] * buf[j];
    env.push(Math.sqrt(s / w));
  }
  return env;
}
const spread = (e: number[]) => Math.max(...e) - Math.min(...e);

describe('tremolo', () => {
  it('at depth 0 the level is steady — a flat envelope', async () => {
    const env = envelope(await render((fx) => { fx.setBaseValue('rate', 6); fx.setBaseValue('depth', 0); }));
    // Some ripple from window edges is fine; it must be far flatter than a
    // modulated one (checked next), so assert it is small relative to the mean.
    const mean = env.reduce((a, b) => a + b, 0) / env.length;
    expect(spread(env) / mean).toBeLessThan(0.15);
  });

  it('depth carves the level up and down — more depth, more swing', async () => {
    const shallow = spread(envelope(await render((fx) => { fx.setBaseValue('rate', 6); fx.setBaseValue('depth', 0.3); })));
    const deep    = spread(envelope(await render((fx) => { fx.setBaseValue('rate', 6); fx.setBaseValue('depth', 0.9); })));
    expect(deep).toBeGreaterThan(shallow * 1.5);
  });

  it('a faster rate chops more often in the same window', async () => {
    const cross = (buf: Float32Array) => {
      const e = envelope(buf); let n = 0, up = false;
      const mid = (Math.max(...e) + Math.min(...e)) / 2;
      for (const v of e) { if (!up && v > mid) { n++; up = true; } else if (up && v < mid) up = false; }
      return n;
    };
    const slow = cross(await render((fx) => { fx.setBaseValue('rate', 2); fx.setBaseValue('depth', 0.9); }));
    const fast = cross(await render((fx) => { fx.setBaseValue('rate', 8); fx.setBaseValue('depth', 0.9); }));
    expect(fast).toBeGreaterThan(slow);
  });

  it('round-trips its params through get/set', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = inst(ctx);
    fx.setBaseValue('rate', 5.5); fx.setBaseValue('depth', 0.7);
    expect(fx.getBaseValue('rate')).toBeCloseTo(5.5, 3);
    expect(fx.getBaseValue('depth')).toBeCloseTo(0.7, 3);
  });
});
