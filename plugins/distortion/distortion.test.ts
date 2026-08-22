// The distortion had NO test of its own in the tree. It gets one here rather
// than travelling uncovered — the rule the engine migration applied to `unison`
// and `fold`, and the reason this file exists at all.
//
// Every claim is measured against a control render of the same source, never
// against an absolute figure.
// Writing this file found a real constraint: `node-web-audio-api` throws
// `InvalidStateError: cannot assign curve twice` on a second write to a
// WaveShaperNode's `curve`, so a drive change used to be unrunnable here. The
// answer was not to test around it — the bitcrusher already swaps in a fresh
// shaper for exactly this reason, and the distortion now does the same. Drive
// is therefore measured as audio, like everything else. The curve is ALSO
// tested directly, because it is pure and the shape claims are sharper there.
import { describe, it, expect, beforeAll } from 'vitest';
import type { FxInstance } from '@loom/plugin-sdk';
import manifest from './plugin.json';
import { makeCurve } from './curve';

let create: (ctx: AudioContext) => FxInstance;
beforeAll(async () => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    registerFx: (_id: string, c: (ctx: AudioContext) => FxInstance) => { create = c; },
  };
  await import('./main');
});

const SR = 44100;

/** Crest factor: peak divided by RMS. A sine sits near √2. Clipping flattens
 *  the peaks while the body of the wave stays, so the ratio FALLS — which is a
 *  shape measurement, immune to how loud either render happens to be. */
function crest(d: Float32Array): number {
  let peak = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); sum += d[i] * d[i]; }
  return peak / Math.sqrt(sum / d.length);
}

async function render(set: Record<string, number> | null): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const osc = ctx.createOscillator();
  osc.frequency.value = 220;
  if (set) {
    const fx = create(ctx as unknown as AudioContext);
    for (const [id, v] of Object.entries(set)) fx.setBaseValue(id, v);
    osc.connect(fx.input);
    fx.output.connect(ctx.destination);
  } else {
    osc.connect(ctx.destination);   // the control: the same sine, untouched
  }
  osc.start();
  return (await ctx.startRendering()).getChannelData(0).slice();
}

describe('distortion plugin', () => {
  it('registers under the id its manifest declares', () => {
    expect(manifest.components[0].id).toBe('distortion');
    expect(create).toBeTypeOf('function');
  });

  it('declares drive + mix, and the factory answers to both', () => {
    const ids = manifest.components[0].params.map((p) => p.id).sort();
    expect(ids).toEqual(['drive', 'mix']);
    const inst = create(new OfflineAudioContext(1, 128, SR) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
      inst.setBaseValue(p.id, p.default);
      expect(inst.getBaseValue(p.id)).toBeCloseTo(p.default, 5);
    }
  });

  it('flattens the waveform: less crest than the same sine untouched', async () => {
    expect(crest(await render({ drive: 0.9, mix: 1 }))).toBeLessThan(crest(await render(null)));
  });

  it('drive reaches the audio: more drive, flatter still', async () => {
    // The knob swaps the shaper rather than nudging a gain, so this is what
    // proves the swap really rewires into the live path.
    expect(crest(await render({ drive: 0.9, mix: 1 })))
      .toBeLessThan(crest(await render({ drive: 0.02, mix: 1 })));
  });

  it('mix 0 hands back the dry signal', async () => {
    const dry = await render({ drive: 0.9, mix: 0 });
    const bare = await render(null);
    expect(crest(dry)).toBeCloseTo(crest(bare), 2);
  });

  it('a redundant drive write rebuilds nothing', () => {
    // Counted, not inferred from "it did not throw": deleting the `v !== drive`
    // guard would build a FRESH shaper, whose first curve write is legal, so a
    // not-toThrow assertion stays green against the very thing it names. The
    // only honest witness is whether another shaper was made.
    const ctx = new OfflineAudioContext(1, 128, SR) as unknown as AudioContext;
    let built = 0;
    const real = ctx.createWaveShaper.bind(ctx);
    ctx.createWaveShaper = () => { built++; return real(); };

    const inst = create(ctx);
    const afterConstruction = built;
    inst.setBaseValue('drive', inst.getBaseValue('drive'));
    expect(built).toBe(afterConstruction);

    // And the control: a real move DOES build one, so the counter is measuring
    // something rather than sitting at zero.
    inst.setBaseValue('drive', inst.getBaseValue('drive') + 0.2);
    expect(built).toBe(afterConstruction + 1);
  });
});

describe('distortion curve — drive is a SHAPE knob', () => {
  /** How far the curve bends away from the straight line it would be if the
   *  effect did nothing. Measured on the curve itself, which is pure maths and
   *  needs no graph — see the note at the top of the file. */
  function bend(curve: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2) / curve.length - 1;          // the input this entry maps
      const straight = x * (curve[curve.length - 1] - curve[0]) / 2;
      sum += Math.abs(curve[i] - straight);
    }
    return sum / curve.length;
  }

  it('more drive bends the transfer curve further from straight', () => {
    expect(bend(makeCurve(0.9))).toBeGreaterThan(bend(makeCurve(0.05)));
  });

  it('the curve is monotonic, so it distorts rather than folds', () => {
    // A curve that turned back on itself would be a wavefolder, a different
    // effect entirely — and this one is not advertised as that.
    const c = makeCurve(0.9);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
});
