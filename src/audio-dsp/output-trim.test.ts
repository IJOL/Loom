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

function renderKarplus(trim: number | undefined): number {
  const p: ParamBag = {
    'string.damping': 0.4, 'string.brightness': 0.7, 'excite.time': 0.01, 'excite.tone': 0.5,
    'amp.attack': 0.005, 'amp.release': 0.5, 'amp.level': 0.8, 'amp.builtinEnv': 1,
    ...(trim !== undefined ? { 'output.trim': trim } : {}),
  };
  const v = new KarplusRenderer(note, p, SR);
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

  it('karplus: trim=2 ~doubles output vs trim=1 (averaged over the noise burst)', () => {
    // Karplus' excitation is a random noise burst → each render differs ~15%.
    // Average many renders per side so the ratio reflects the trim, not noise;
    // wide bounds keep it from ever flaking on the residual variance.
    const avg = (trim: number) => { let s = 0; for (let i = 0; i < 10; i++) s += renderKarplus(trim); return s / 10; };
    const ratio = avg(2) / avg(1);
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
  });
});
