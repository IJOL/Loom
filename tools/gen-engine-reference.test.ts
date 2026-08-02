// tools/gen-engine-reference.test.ts
// Validates the reference generator against the ONE reference that already
// exists and is trusted: plugins/karplus/reference-render.json.
//
// The comparison is by SHAPE, not bit for bit, and that is not a softening.
// plugins/karplus/karplus-parity.dsp.test.ts explains why: the plugin stopped
// multiplying by its own engine trim (the host does it now), so the committed
// numbers sit at a different scale from anything the plugin renders today. The
// criterion used here is the same one that test already uses — normalise both by
// their peak, and the worst deviation must be a vanishing fraction of it.
import { describe, it, expect, beforeAll } from 'vitest';
import committed from '../plugins/karplus/reference-render.json';
import {
  renderReference, loadPluginRenderers, pluginDefaultParams, STRIDE, RENDER_SEC, SR,
} from './gen-engine-reference';
import type { ParamBag } from '../src/audio-dsp/types';

function peakOf(xs: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < xs.length; i++) p = Math.max(p, Math.abs(xs[i]));
  return p;
}

/** Worst deviation between two renders once both are normalised by their peak,
 *  as a fraction of the reference peak. */
function shapeError(reference: number[], fresh: number[]): number {
  const pr = peakOf(reference), pf = peakOf(fresh);
  if (pr === 0 || pf === 0) return Infinity;
  const k = pr / pf;
  let worst = 0;
  for (let i = 0; i < reference.length; i++) {
    worst = Math.max(worst, Math.abs(reference[i] - fresh[i] * k));
  }
  return worst / pr;
}

describe('the engine reference generator', () => {
  let karplusParams: ParamBag;

  beforeAll(async () => {
    await loadPluginRenderers();
    karplusParams = await pluginDefaultParams('karplus');
  });

  it('keeps one sample in every 512 over 0.6 s — the committed reference length', () => {
    expect(STRIDE).toBe(512);
    expect(Math.ceil((RENDER_SEC * SR) / STRIDE)).toBe(committed.length);   // 57
  });

  it('reproduces the shape of the committed Karplus reference', () => {
    const fresh = renderReference('karplus', karplusParams);
    expect(fresh.length).toBe(committed.length);
    expect(shapeError(committed as number[], fresh)).toBeLessThan(1e-6);
  });

  it('is deterministic: two runs of the same engine agree bit for bit', () => {
    // Without this, a reference captured today and checked tomorrow would fail
    // for reasons that have nothing to do with the code under test — which is
    // exactly the trap a noise-excited engine sets.
    const a = renderReference('karplus', karplusParams);
    const b = renderReference('karplus', karplusParams);
    expect(a).toEqual(b);
  });

  it('renders every in-tree melodic engine from its declared defaults', () => {
    for (const id of ['tb303', 'subtractive', 'fm', 'wavetable', 'westcoast']) {
      const out = renderReference(id);
      expect(out.length, `${id} should render ${committed.length} kept samples`).toBe(committed.length);
      expect(out.every(Number.isFinite), `${id} rendered a non-finite sample`).toBe(true);
      expect(peakOf(out), `${id} rendered silence at its own defaults`).toBeGreaterThan(0);
    }
  });
});
