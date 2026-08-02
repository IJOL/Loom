// The five mpump presets that needed unison or a non-lowpass filter — both added
// this session. Each is checked for the feature that unblocked it, and that it
// renders audible and bounded through the engine.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePresetEntry } from './preset-loader';
import { SubtractiveVoiceRenderer } from '../audio-dsp/subtractive-renderer';
import type { ParamBag, NoteSpec } from '../audio-dsp/types';

const presets: Array<{ name: string; params: Record<string, number>; modulators?: unknown[] }> =
  JSON.parse(readFileSync(join(process.cwd(), 'public/presets/subtractive.json'), 'utf8')).presets;
const find = (needle: string) => presets.find((p) => p.name.includes(needle));

const SR = 48000;
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const note = (o: Partial<NoteSpec> = {}): NoteSpec =>
  ({ midi: 57, beginSec: 0, durationSec: 0.3, velocity: 0.85, accent: false, slide: false, ...o });
const DEFAULTS: ParamBag = {
  'master.tune': 0, 'osc1.wave': 0, 'osc1.level': 0.6, 'osc1.detune': 0,
  'osc2.wave': 1, 'osc2.level': 0.4, 'osc2.detune': 7, 'sub.level': 0.3, 'noise.level': 0, 'noise.color': 0.6,
  'filter.cutoff': 0.55, 'filter.resonance': 0.25, 'filter.envAmount': 0.45,
  'filter.drive': 0, 'filter.keyTrack': 0, 'filter.builtinEnv': 1,
  'filter.attack': 0.01, 'filter.decay': 0.3, 'filter.sustain': 0.4, 'filter.release': 0.35,
  'amp.builtinEnv': 1, 'amp.attack': 0.01, 'amp.decay': 0.2, 'amp.sustain': 0.7, 'amp.release': 0.3,
};
const audible = (p: { params: Record<string, number> }, midi = 57) => {
  const v = new SubtractiveVoiceRenderer(note({ midi }), { ...DEFAULTS, ...p.params }, SR);
  const b: number[] = [];
  for (let i = 0; i < SR * 0.15; i++) b.push(v.renderSample(i / SR));
  return { rms: rms(b), peak: Math.max(...b.map(Math.abs)) };
};

describe('the five unison / filter-type presets', () => {
  const CASES: Array<[string, (p: { params: Record<string, number> }) => void]> = [
    ['LEAD Supersaw 7', (p) => expect(p.params['master.unison'], 'needs unison').toBeGreaterThanOrEqual(5)],
    ['LEAD Hoover Rave', (p) => expect(p.params['master.unison'], 'needs unison').toBeGreaterThanOrEqual(3)],
    ['BASS Hoover', (p) => expect(p.params['master.unison'], 'needs unison').toBeGreaterThanOrEqual(3)],
    ['LEAD Razor', (p) => expect(p.params['filter.type'], 'needs bandpass').toBe(2)],
    ['PAD Ethereal', (p) => expect(p.params['filter.type'], 'needs highpass').toBe(1)],
  ];
  for (const [needle, check] of CASES) {
    it(`${needle} has the feature that unblocked it, and is audible + bounded`, () => {
      const p = find(needle);
      expect(p, `${needle} missing`).toBeDefined();
      expect(validatePresetEntry(p)).toBe(true);
      check(p!);
      const { rms: r, peak } = audible(p!);
      expect(r, `${needle} is silent`).toBeGreaterThan(0.01);
      expect(peak, `${needle} blew up`).toBeLessThan(4);
    });
  }
});
