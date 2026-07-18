// Per-preset output trim: a preset can carry `output.trim` in its params to
// scale the engine's output level (the gain-staging "preset.trim" lever, finally
// wired). The renderer multiplies its output by output.trim (default 1), so a
// preset reads exactly `trim`× louder. Used to balance preset loudness so every
// lane's VU meter reaches a similar height.

import { describe, it, expect } from 'vitest';
import { KarplusRenderer } from './karplus-renderer';
import { SubtractiveVoiceRenderer } from './subtractive-renderer';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;
const note: NoteSpec = {
  midi: 60, beginSec: 0, durationSec: 0.4, velocity: 0.8, accent: false, slide: false,
};
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

function renderKarplus(trim: number | undefined): number {
  const p: ParamBag = {
    'string.damping': 0.4, 'string.brightness': 0.7, 'excite.time': 0.01, 'excite.tone': 0.5,
    'amp.attack': 0.005, 'amp.release': 0.5, 'amp.level': 0.8, 'amp.builtinEnv': 1,
    ...(trim !== undefined ? { 'output.trim': trim } : {}),
  };
  const v = new KarplusRenderer(note, p, SR, seeded(20260718));
  const buf: number[] = [];
  for (let i = 0; i < SR * 0.1; i++) buf.push(v.renderSample(i / SR));
  return rms(buf);
}

function renderSubtractive(trim: number | undefined): number {
  const p: ParamBag = {
    'osc1.level': 0.8, 'filter.cutoff': 0.9, 'amp.sustain': 0.9, 'amp.builtinEnv': 1,
    ...(trim !== undefined ? { 'output.trim': trim } : {}),
  };
  const v = new SubtractiveVoiceRenderer(note, p, SR);
  const buf: number[] = [];
  for (let i = 0; i < SR * 0.1; i++) buf.push(v.renderSample(i / SR));
  return rms(buf);
}

describe('output.trim scales engine output (per-preset gain-staging lever)', () => {
  // Subtractive is deterministic (osc-based, noiseLevel 0), so its trim ratios are
  // exact. Karplus uses a random noise-burst excitation, so two separate renders
  // differ ~6% — assert only the DIRECTION there, the exact ratios on subtractive.
  it('subtractive: trim=2 is exactly ~2× and trim=0.5 ~half of trim=1', () => {
    const base = renderSubtractive(1);
    expect(renderSubtractive(2) / base).toBeGreaterThan(1.95);
    expect(renderSubtractive(2) / base).toBeLessThan(2.05);
    expect(renderSubtractive(0.5) / base).toBeGreaterThan(0.49);
    expect(renderSubtractive(0.5) / base).toBeLessThan(0.51);
  });

  it('subtractive: a missing output.trim defaults to 1 (no change)', () => {
    const ratio = renderSubtractive(undefined) / renderSubtractive(1);
    expect(ratio).toBeGreaterThan(0.999);
    expect(ratio).toBeLessThan(1.001);
  });

  it('karplus: trim=2 exactly doubles output vs trim=1', () => {
    // This used to average ten renders a side and allow [1.7, 2.3], because the
    // excitation is a random noise burst. That measured NOISE VARIANCE in order
    // to verify a MULTIPLICATION, and it flaked (observed 1.65). With the same
    // seeded burst on both sides, trim is what it is — a scalar — and the ratio
    // is exact.
    const ratio = renderKarplus(2) / renderKarplus(1);
    expect(ratio).toBeCloseTo(2, 6);
  });

  it('the same seed renders the same string twice — the seam really is deterministic', () => {
    // Guards the test above: if the injected rng were ignored, the two renders
    // would differ and the exactness of the ratio would be luck.
    expect(renderKarplus(1)).toBeCloseTo(renderKarplus(1), 12);
  });
});
