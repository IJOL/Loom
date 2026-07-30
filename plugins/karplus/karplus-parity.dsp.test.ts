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
    registerEngine: () => {},
    registerRenderer: (id: string, make: unknown) => { seen.set(id, make); },
  };
  return seen;
});

import { KarplusRenderer as PluginKarplus } from './dsp';
import { KarplusRenderer as HostKarplus } from '../../src/audio-dsp/karplus-renderer';
import type { NoteSpec } from '@loom/plugin-sdk';

const SR = 48000;
const note: NoteSpec = { midi: 57, beginSec: 0, durationSec: 0.5, velocity: 0.8, accent: false, slide: false };
const params = { 'string.damping': 0.5, 'string.brightness': 0.65, 'amp.level': 0.8, 'amp.release': 0.5 };

/** Deterministic excitation so both renderers get the SAME noise burst — the
 *  pluck is random by design, and without a shared seed the comparison would be
 *  meaningless. */
function seeded(): () => number {
  let s = 12345;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function render(make: (rng: () => number) => { renderSample(t: number): number }): Float32Array {
  const r = make(seeded());
  const n = Math.round(0.6 * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r.renderSample(i / SR);
  return out;
}

describe('the Karplus plugin renderer', () => {
  it('registers itself through the Loom global, under the engine id', () => {
    expect(registered.has('karplus')).toBe(true);
  });

  it('renders the same signal as the in-tree renderer, up to the host trim', () => {
    const host = render((rng) => new HostKarplus(note, params, SR, rng));
    const plug = render((rng) => new PluginKarplus(note, params, SR, rng));

    // The plugin no longer multiplies by its own engine trim — the host does
    // that now — so compare SHAPE: the ratio between the two must be one
    // constant across the whole render.
    let peakHost = 0;
    for (const v of host) peakHost = Math.max(peakHost, Math.abs(v));
    let peakPlug = 0;
    for (const v of plug) peakPlug = Math.max(peakPlug, Math.abs(v));
    expect(peakHost).toBeGreaterThan(0);
    expect(peakPlug).toBeGreaterThan(0);

    const k = peakHost / peakPlug;
    let worst = 0;
    for (let i = 0; i < host.length; i++) {
      const d = Math.abs(host[i] - plug[i] * k);
      if (d > worst) worst = d;
    }
    // Relative: the worst deviation must be a vanishing fraction of the peak.
    expect(worst / peakHost).toBeLessThan(1e-6);
  });
});
