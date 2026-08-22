// The only one of the fifteen inserts that handles two channels, so its tests
// are the only ones that render in stereo.
//
// The two knobs do different things to different sources and the tests say so
// explicitly: `width` scales a difference that must already exist, so it cannot
// touch a mono source; `depth` creates one, so it can. Testing width against a
// mono source would "prove" it does nothing and read as a bug.
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

/** How different the two channels are, as a fraction of the level present.
 *  0 means the output is mono; larger means a wider image. */
function sideRatio(L: Float32Array, R: Float32Array): number {
  let diff = 0, energy = 0;
  for (let i = 0; i < L.length; i++) {
    diff += (L[i] - R[i]) ** 2;
    energy += L[i] * L[i] + R[i] * R[i];
  }
  return energy === 0 ? 0 : Math.sqrt(diff / L.length) / Math.sqrt(energy / L.length);
}

/** Render through the effect. `stereo` picks the source: a mono tone fed to
 *  both channels, or two different tones hard left and right — which is what
 *  gives the mid/side stage something to scale. */
async function render(stereo: boolean, set: Record<string, number> = {}): Promise<[Float32Array, Float32Array]> {
  const ctx = new OfflineAudioContext(2, SR, SR);
  const fx = create(ctx as unknown as AudioContext);
  for (const [id, v] of Object.entries(set)) fx.setBaseValue(id, v);

  if (stereo) {
    const a = ctx.createOscillator(); a.frequency.value = 220;
    const b = ctx.createOscillator(); b.frequency.value = 330;
    const merge = ctx.createChannelMerger(2);
    a.connect(merge, 0, 0);
    b.connect(merge, 0, 1);
    merge.connect(fx.input);
    a.start(); b.start();
  } else {
    const osc = ctx.createOscillator(); osc.frequency.value = 220;
    osc.connect(fx.input);
    osc.start();
  }
  fx.output.connect(ctx.destination);
  const out = await ctx.startRendering();
  return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
}

describe('width — mid/side, on a source that already has sides', () => {
  it('widening pushes the channels further apart', async () => {
    const [nL, nR] = await render(true, { width: 0.2, depth: 0 });
    const [wL, wR] = await render(true, { width: 2, depth: 0 });
    expect(sideRatio(wL, wR)).toBeGreaterThan(sideRatio(nL, nR));
  });

  it('width 0 collapses it to mono — the two channels become the same signal', async () => {
    const [L, R] = await render(true, { width: 0, depth: 0 });
    // Not "small": actually identical, because with no side left both channels
    // ARE the mid. That is a sharper claim than a ratio.
    expect(sideRatio(L, R)).toBeLessThan(1e-6);
  });

  it('does nothing to a MONO source, and that is correct, not a fault', async () => {
    // A mono input has no side to scale. This is the case that would look like
    // a bug to anyone testing width with a single oscillator.
    const [nL, nR] = await render(false, { width: 0, depth: 0 });
    const [wL, wR] = await render(false, { width: 2, depth: 0 });
    expect(sideRatio(nL, nR)).toBeLessThan(1e-6);
    expect(sideRatio(wL, wR)).toBeLessThan(1e-6);
  });
});

describe('width — the auto-pan, which DOES move a mono source', () => {
  it('depth makes a mono source travel between the channels', async () => {
    const [sL, sR] = await render(false, { depth: 0, rate: 2 });
    const [mL, mR] = await render(false, { depth: 1, rate: 2 });
    expect(sideRatio(mL, mR)).toBeGreaterThan(sideRatio(sL, sR));
  });

  it('a synced rate follows the tempo — on the OSCILLATOR, not just the shadow', () => {
    const fx = create(new OfflineAudioContext(2, 128, SR) as unknown as AudioContext);
    // Read through getAudioParams, which hands back the LFO's own frequency
    // param. An earlier version asserted only on getBaseValue('rate'), which
    // returns a field: a review deleted the write to the oscillator entirely and
    // every test here stayed green, so the auto-pan could have stopped following
    // the tempo forever with nothing to say so.
    const lfoFreq = () => fx.getAudioParams().get('rate')!.value;
    fx.setBaseValue('sync', 5);        // one cycle per beat
    fx.setBpm!(120);
    const at120 = lfoFreq();
    fx.setBpm!(240);
    // Relative: twice the tempo, twice the effective rate.
    expect(lfoFreq()).toBeGreaterThan(at120 * 1.9);
    // And the reported value agrees with the node, so the knob is not lying
    // either — a synced value cannot live on the knob, which is why it is
    // shadowed at all.
    expect(fx.getBaseValue('rate')).toBeCloseTo(lfoFreq(), 5);
  });
});

describe('width — the auto-pan must not double as a volume knob', () => {
  it('raising depth does not make a mono lane louder', async () => {
    // A StereoPanner fed two channels FOLDS one side into the other rather than
    // attenuating it, and the up-mix this effect performs turns a mono track
    // into a perfectly correlated pair — the worst case. Untrimmed, depth 1
    // measured a peak of 2.00 against depth 0's 1.00: a user reaching for
    // movement got +6 dB into the master soft-clip and heard pumping.
    const peak = (b: Float32Array) => { let p = 0; for (const v of b) if (Math.abs(v) > p) p = Math.abs(v); return p; };
    const at = async (depth: number) => {
      const [L, R] = await render(false, { depth, rate: 2 });
      return Math.max(peak(L), peak(R));
    };
    const still = await at(0);
    // Relative to the SAME effect standing still, so this pins the claim against
    // the effect's own quiet state rather than any particular level.
    //
    // 1.4, not 1.0, and the gap is physics rather than slack: panning a
    // correlated signal towards one side CONCENTRATES it into that channel, so
    // that channel's peak necessarily rises. No trim can hold the centre and the
    // extreme at unity at once — one of them has to give. What is achievable is
    // bounding it, and this bounds it from the +6 dB it shipped at (2.00) to
    // +2.5 dB (1.33). Tightening this number means changing the pan law, not
    // adjusting the threshold.
    expect(await at(1)).toBeLessThan(still * 1.4);
  });
});

describe('width — manifest', () => {
  it('answers to every param it declares, at a value it did NOT start on', () => {
    expect(manifest.components[0].id).toBe('width');
    const fx = create(new OfflineAudioContext(2, 128, SR) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
      // 'rate' reports the EFFECTIVE value, covered by the sync case above.
      if (p.id === 'rate') continue;
      // Writing the manifest's own default proves nothing: every shadow variable
      // already holds it, so a setBaseValue that ignored the id entirely would
      // still read back correctly. A review proved that by deleting the `depth`
      // and `sync` branches from a copy of this plugin and watching the suite
      // stay green.
      const off = p.default === p.min ? p.max : p.min;
      fx.setBaseValue(p.id, off);
      expect(fx.getBaseValue(p.id), `${p.id} did not take the written value`).toBeCloseTo(off, 5);
      fx.setBaseValue(p.id, p.default);
      expect(fx.getBaseValue(p.id)).toBeCloseTo(p.default, 5);
    }
  });
});
