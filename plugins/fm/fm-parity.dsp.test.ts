import { describe, it, expect, vi } from 'vitest';

// `dsp.ts` calls Loom.registerRenderer at module scope — that is the whole point
// of the ABI — so the global must exist BEFORE the import graph is evaluated.
// vi.hoisted is the only hook that runs that early. Installing a two-line stub
// rather than the real host API is deliberate: it proves the DSP half of a
// plugin needs nothing from Loom but registerRenderer.
const registered = vi.hoisted(() => {
  const seen = new Map<string, unknown>();
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1,
    registerRenderer: (id: string, make: unknown) => { seen.set(id, make); },
  };
  return seen;
});

import { FMRenderer } from './dsp';
import reference from './reference-render.json';
import manifest from './plugin.json';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';

const SR = 48000;
const note: NoteSpec = { midi: 57, beginSec: 0, durationSec: 0.5, velocity: 0.8, accent: false, slide: false };
/** The reference keeps every 512th sample — enough to pin the shape, small
 *  enough to commit. Must match tools/gen-engine-reference.ts. */
const STRIDE = 512;

/** The engine's DECLARED defaults, read from the manifest — the same bag
 *  tools/gen-engine-reference.ts builds. Hard-coding a subset would not do for
 *  FM: its `algorithm` default is 2 while the renderer's own fallback is 0, and
 *  three of the four operator levels differ from their fallbacks too, so a
 *  partial bag would render a different patch and the comparison would be
 *  against nothing in particular. */
const params: ParamBag = Object.fromEntries(
  manifest.components[0].params.map((p) => [p.id, p.default]),
);

function peakOf(xs: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < xs.length; i++) p = Math.max(p, Math.abs(xs[i]));
  return p;
}

describe('the FM plugin renderer', () => {
  it('registers itself through the Loom global, under the engine id', () => {
    expect(registered.has('fm')).toBe(true);
  });

  it('still renders the frozen reference taken from the in-tree engine', () => {
    // Frozen by tools/gen-engine-reference.ts from src/audio-dsp/fm-renderer.ts
    // BEFORE anything on this branch touched it. FM excites itself with nothing
    // random, so unlike the plucked string it needs no seeded rng to reproduce.
    const r = new FMRenderer(note, params, SR);
    const n = Math.round(0.6 * SR);
    const plug: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = r.renderSample(i / SR);
      if (i % STRIDE === 0) plug.push(s);
    }
    expect(plug.length).toBe(reference.length);

    // The plugin no longer multiplies by its own engine trim — the host does
    // that now — so compare SHAPE: normalise both by their peak, and the ratio
    // between them must be one constant across the whole render.
    const peakRef = peakOf(reference);
    const peakPlug = peakOf(plug);
    expect(peakRef).toBeGreaterThan(0);
    expect(peakPlug).toBeGreaterThan(0);

    const k = peakRef / peakPlug;
    let worst = 0;
    for (let i = 0; i < reference.length; i++) {
      const d = Math.abs(reference[i] - plug[i] * k);
      if (d > worst) worst = d;
    }
    // Relative: the worst deviation must be a vanishing fraction of the peak.
    expect(worst / peakRef).toBeLessThan(1e-6);
  });
});
