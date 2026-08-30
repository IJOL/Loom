// Behaviour of the Karplus plugin's renderer.
//
// These assertions used to live in src/audio-dsp/karplus-renderer.test.ts and
// src/audio-dsp/output-trim.test.ts, against the in-tree engine. That engine is
// gone; the shipped plugin is the only Karplus there is, so the coverage moved
// here rather than being dropped.
import { describe, it, expect, vi } from 'vitest';

// See karplus-parity.dsp.test.ts: `dsp.ts` calls Loom.registerRenderer at module
// scope, so the global must exist before the import graph is evaluated.
vi.hoisted(() => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1,
    registerRenderer: () => {},
  };
});

import { KarplusRenderer } from './dsp';
import manifest from './plugin.json';
import { SR as FIXTURE_SR, note as fixtureNote, makeRenderer, hostTrim } from '../../test/engine-fixtures';
import { CATEGORY_GAIN } from '../../src/audio-dsp/gain-staging';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';

const SR = 48000;
const P: ParamBag = {
  'string.damping': 0.4,
  'string.brightness': 0.7,
  'excite.time': 0.01,
  'excite.tone': 0.5,
  'amp.attack': 0.005,
  'amp.release': 0.5,
  'amp.level': 0.8,
  'amp.builtinEnv': 1,
};
const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({
  midi: 60,
  beginSec: 0,
  durationSec: 0.5,
  velocity: 0.8,
  accent: false,
  slide: false,
  ...o,
});
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

/** A seeded PRNG (mulberry32), rebuilt per render so both sides of a comparison
 *  get the IDENTICAL excitation burst. Production keeps Math.random. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('KarplusRenderer', () => {
  it('produces a decaying plucked tone (audible then quieter)', () => {
    const v = new KarplusRenderer(note({ durationSec: 1 }), P, SR);
    const early: number[] = [];
    for (let i = 0; i < SR * 0.05; i++) early.push(v.renderSample(i / SR));
    const late: number[] = [];
    for (let i = SR * 0.7; i < SR * 0.75; i++) late.push(v.renderSample(i / SR));
    expect(rms(early)).toBeGreaterThan(rms(late));   // string decays
    // "Audible" as a RATIO of the level knob that scales the output, not a bare
    // magnitude: two orders of magnitude below the set level is silence, above
    // it is a note. (Re-derived when the engine trim left the renderer for the
    // manifest — the old absolute 0.01 was measuring the trim as much as the
    // string.)
    expect(rms(early)).toBeGreaterThan(P['amp.level'] / 100);
  });

  it('a brighter string has more high-frequency energy than a dark one', () => {
    // The excitation is a random noise burst, so a single render's energy varies
    // ~15% — average several so the bright-vs-dark comparison reflects brightness,
    // not the noise seed (this assertion used to flake by a hair).
    const e = (b: number) => {
      let acc = 0;
      for (let k = 0; k < 8; k++) {
        const v = new KarplusRenderer(note(), { ...P, 'string.brightness': b }, SR);
        const buf: number[] = [];
        for (let i = 0; i < SR * 0.05; i++) buf.push(v.renderSample(i / SR));
        acc += rms(buf);
      }
      return acc / 8;
    };
    // Bright string must genuinely exceed dark string (averaged over the noise).
    expect(e(0.95)).toBeGreaterThan(e(0.1));
  });

  it('decays to silence and done===true after the release tail', () => {
    // durationSec=0.1, release=0.1s → need exp(-(t-0.1)/0.1)<0.001 → t≈0.79s
    // Render to 1.2s to be safely past the threshold.
    const v = new KarplusRenderer(
      note({ durationSec: 0.1 }),
      { ...P, 'amp.release': 0.1 },
      SR,
    );
    let last = 1;
    for (let i = 0; i < SR * 1.2; i++) last = v.renderSample(i / SR);
    // A vanishing fraction of the level knob — same reasoning as above.
    expect(Math.abs(last)).toBeLessThan(P['amp.level'] / 100);
    expect(v.done).toBe(true);
  });

  it('noteOff shortens the gate and triggers early release', () => {
    // durationSec=2 but noteOff at 0.05s, release=0.5s → done at ~0.05+0.5*ln(1000)≈3.5s
    // Use a short release so done is reached within the render window.
    const shortRel = { ...P, 'amp.release': 0.05 };
    const v = new KarplusRenderer(note({ durationSec: 2 }), shortRel, SR);
    // Render a bit, then call noteOff
    for (let i = 0; i < SR * 0.05; i++) v.renderSample(i / SR);
    v.noteOff(0.05);
    // With rel=0.05s → done at ~0.05+0.05*ln(1000)≈0.395s; render to 0.6s
    for (let i = SR * 0.05; i < SR * 0.6; i++) v.renderSample(i / SR);
    expect(v.done).toBe(true);
  });
});

describe('output.trim scales the plugin output (per-preset gain-staging lever)', () => {
  function render(trim: number | undefined): number {
    const p: ParamBag = { ...P, ...(trim !== undefined ? { 'output.trim': trim } : {}) };
    const v = new KarplusRenderer(note({ durationSec: 0.4 }), p, SR, seeded(20260718));
    const buf: number[] = [];
    for (let i = 0; i < SR * 0.1; i++) buf.push(v.renderSample(i / SR));
    return rms(buf);
  }

  it('trim=2 exactly doubles output vs trim=1', () => {
    // This used to average ten renders a side and allow [1.7, 2.3], because the
    // excitation is a random noise burst. That measured NOISE VARIANCE in order
    // to verify a MULTIPLICATION, and it flaked (observed 1.65). With the same
    // seeded burst on both sides, trim is what it is — a scalar — and the ratio
    // is exact.
    expect(render(2) / render(1)).toBeCloseTo(2, 6);
  });

  it('a missing output.trim defaults to 1 (no change)', () => {
    expect(render(undefined) / render(1)).toBeCloseTo(1, 6);
  });

  it('the same seed renders the same string twice — the seam really is deterministic', () => {
    // Guards the tests above: if the injected rng were ignored, the two renders
    // would differ and the exactness of the ratio would be luck.
    expect(render(1)).toBeCloseTo(render(1), 12);
  });
});

// The other half of "the ÷1.4 re-trim put the engines back where they were",
// which used to sit in src/audio-dsp/velocity-response.test.ts next to fm's.
// It has to live here now: the renderer is no longer importable from src/.
describe('the plugin sits where the in-tree engine sat, against wavetable', () => {
  /** The fixtures' PRNG, kept identical so the measured constant still applies —
   *  otherwise the pluck seed, not the balance, would move the measurement. */
  function fixtureRng(): () => number {
    let s = 0x2f6e2b1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  }
  const WINDOW_SEC = 0.05;
  const rmsOf = (v: { renderSample(t: number): number }): number => {
    const n = Math.floor(FIXTURE_SR * WINDOW_SEC);
    let acc = 0;
    for (let i = 0; i < n; i++) { const s = v.renderSample(i / FIXTURE_SR); acc += s * s; }
    return Math.sqrt(acc / n);
  };

  it('reproduces the measured karplus/wavetable full-velocity ratio', () => {
    // MEASURED, not chosen: read off this same fixture before the curve landed.
    const KARPLUS_VS_WAVETABLE = 0.47450;
    const n = fixtureNote({ velocity: 1.0 });
    // Wavetable is a plugin too now, so its renderer stopped multiplying its own
    // trim in — hostTrim puts back exactly what the host applies, which is what
    // keeps this a comparison of BALANCE rather than of packaging.
    const wavetable = rmsOf(makeRenderer('wavetable', n)) * hostTrim('wavetable');

    // RE-DERIVED for the plugin. The in-tree renderer multiplied its own
    // `synthTrim('karplus')` = ENGINE_TRIM.karplus × CATEGORY_GAIN.synth into
    // every sample. The plugin multiplies NEITHER — its trim is a manifest
    // capability the host applies at the sum point (VoiceManager.outputTrim) —
    // so BOTH factors go back on here, not just the manifest number. (In the
    // window where the in-tree renderer still existed but had lost its
    // ENGINE_TRIM entry, the compensation was only the manifest number; that
    // was right for that renderer and is wrong for this one.) Read from the
    // manifest here rather than through the fixture's hostTrim(), because THIS
    // renderer is built by hand a line below, not by makeRenderer.
    const karplusHostTrim = manifest.components[0].capabilities.outputTrim * CATEGORY_GAIN.synth;
    const plugin = rmsOf(new KarplusRenderer(n, P, FIXTURE_SR, fixtureRng())) * karplusHostTrim;

    // 1% covers rounding the trim to three decimals (1.2/1.4 → 0.857).
    expect(plugin / wavetable / KARPLUS_VS_WAVETABLE).toBeCloseTo(1, 2);
  });
});

describe('unison strings', () => {
  // A string at 220 rings at 220/440/660… — the equal-tempered fifth (329.63)
  // is nobody's harmonic until a second string actually sits there. Both sides
  // of each comparison share a seeded rng, so the pluck itself is identical.
  const mag = (xs: number[], freqHz: number): number => {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * freqHz) / SR;
    for (let i = 0; i < xs.length; i++) {
      re += xs[i] * Math.cos(w * i);
      im += xs[i] * Math.sin(w * i);
    }
    return Math.hypot(re, im);
  };
  const renderK = (bag: ParamBag, seed: number): number[] => {
    const v = new KarplusRenderer(note({ midi: 57, durationSec: 0.5 }), bag, SR, seeded(seed));
    const out: number[] = [];
    for (let i = 0; i < SR * 0.25; i++) out.push(v.renderSample(i / SR));
    return out;
  };

  it('string.unisonMode reaches the strings: Power Chord rings at the fifth', () => {
    const stack = { ...P, 'string.unison': 2, 'string.spread': 0 };
    const plain = renderK({ ...stack, 'string.unisonMode': 0 }, 1);
    const chord = renderK({ ...stack, 'string.unisonMode': 3 }, 1);
    const fifthHz = 220 * Math.pow(2, 7 / 12);
    expect(mag(plain, 220)).toBeGreaterThan(0.1);
    expect(mag(chord, fifthHz)).toBeGreaterThan(mag(plain, fifthHz) * 5);
  });

  it('a patch that never mentions unison is bit-identical to one string', () => {
    // P carries no unison params — the silent defaults must be the pre-unison
    // voice, same rng stream included, or every saved pluck changes on load.
    const a = renderK(P, 7);
    const b = renderK({ ...P, 'string.unison': 1, 'string.unisonMode': 0, 'string.spread': 8 }, 7);
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
  });
});
