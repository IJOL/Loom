// Per-preset output trim: a preset can carry `output.trim` in its params to
// scale the engine's output level (the gain-staging "preset.trim" lever, finally
// wired). The renderer multiplies its output by output.trim (default 1), so a
// preset reads exactly `trim`× louder. Used to balance preset loudness so every
// lane's VU meter reaches a similar height.

// Every engine is a plugin now; the other engines cover the same lever next to
// their own source (e.g. plugins/karplus/dsp.test.ts, where the Karplus half of
// this file went). Subtractive stays here because this is a claim about the
// LEVER, which the host seeds and every renderer must honour — not about that
// engine's voicing.
import { describe, it, expect } from 'vitest';
// `test/plugin-dsp` installs the Loom global the plugin's dsp.ts registers
// through, so it MUST stay above the plugin import below.
import '../../test/plugin-dsp';
import { SubtractiveVoiceRenderer } from '../../plugins/subtractive/dsp';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;
const note: NoteSpec = {
  midi: 60, beginSec: 0, durationSec: 0.4, velocity: 0.8, accent: false, slide: false,
};
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

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
  // exact.
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

});
