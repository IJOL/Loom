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

// The trance gate is this same effect with a synced rate, a square shape and
// smoothed edges — so those three are what these cover.
describe('tremolo as a trance gate', () => {
  it('synced, the rate comes from the tempo: 1/16 at 120 BPM is 8 Hz', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = inst(ctx);
    fx.setBaseValue('sync', 5);        // index 5 = 1/16 per the options table
    fx.setBpm?.(120);
    expect(fx.getBaseValue('rate')).toBeCloseTo(8, 2);
  });

  it('a tempo change moves a synced gate with it', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = inst(ctx);
    fx.setBaseValue('sync', 2);        // 1/8
    fx.setBpm?.(120);
    const at120 = fx.getBaseValue('rate');
    fx.setBpm?.(140);
    expect(fx.getBaseValue('rate')).toBeGreaterThan(at120);
  });

  it('Free leaves the rate under the knob, tempo notwithstanding', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = inst(ctx);
    fx.setBaseValue('sync', 0);
    fx.setBaseValue('rate', 3);
    fx.setBpm?.(180);
    expect(fx.getBaseValue('rate')).toBeCloseTo(3, 3);
  });

  it('a square shape gates harder than a sine — that is the gate sound', async () => {
    // A square LFO sits at its extremes; a sine spends most of its time in
    // between. At the same depth the square must swing the envelope further.
    const sine   = spread(envelope(await render((fx) => {
      fx.setBaseValue('rate', 6); fx.setBaseValue('depth', 0.9); fx.setBaseValue('shape', 0);
    })));
    const square = spread(envelope(await render((fx) => {
      fx.setBaseValue('rate', 6); fx.setBaseValue('depth', 0.9); fx.setBaseValue('shape', 1);
      fx.setBaseValue('smooth', 0.2);
    })));
    expect(square).toBeGreaterThan(sine);
  });

  it('smoothing rounds the gate edges — heavy smoothing swings less', async () => {
    // The smoother is a lowpass on the LFO, so a long time constant blunts the
    // square towards a sine and the envelope stops reaching the extremes.
    const sharp = spread(envelope(await render((fx) => {
      fx.setBaseValue('rate', 6); fx.setBaseValue('depth', 0.9);
      fx.setBaseValue('shape', 1); fx.setBaseValue('smooth', 0.2);
    })));
    const soft  = spread(envelope(await render((fx) => {
      fx.setBaseValue('rate', 6); fx.setBaseValue('depth', 0.9);
      fx.setBaseValue('shape', 1); fx.setBaseValue('smooth', 50);
    })));
    expect(soft).toBeLessThan(sharp);
  });

  it('round-trips the gate params', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = inst(ctx);
    fx.setBaseValue('shape', 1); fx.setBaseValue('smooth', 12); fx.setBaseValue('sync', 3);
    expect(fx.getBaseValue('shape')).toBe(1);
    expect(fx.getBaseValue('smooth')).toBeCloseTo(12, 3);
    expect(fx.getBaseValue('sync')).toBe(3);
  });
});
