import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FMRenderer } from './fm-renderer';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;

interface Preset { name: string; params: Record<string, number> }
const PRESETS: Preset[] = JSON.parse(
  readFileSync(resolve('public/presets/fm.json'), 'utf8'),
).presets;

// A complete FM ParamBag of defaults; each preset's params override it.
const DEFAULT_BAG: ParamBag = {
  algorithm: 0, feedback: 0, 'amp.mix': 0.7, 'output.trim': 1, 'poly.voices': 6,
  'op1.ratio': 1, 'op1.detune': 0, 'op1.level': 0.9, 'op1.attack': 0.01, 'op1.decay': 0.3, 'op1.sustain': 0.7, 'op1.release': 0.3,
  'op2.ratio': 2, 'op2.detune': 0, 'op2.level': 0.5, 'op2.attack': 0.01, 'op2.decay': 0.3, 'op2.sustain': 0.7, 'op2.release': 0.3,
  'op3.ratio': 3, 'op3.detune': 0, 'op3.level': 0.4, 'op3.attack': 0.01, 'op3.decay': 0.3, 'op3.sustain': 0.7, 'op3.release': 0.3,
  'op4.ratio': 1, 'op4.detune': 0, 'op4.level': 0.6, 'op4.attack': 0.01, 'op4.decay': 0.3, 'op4.sustain': 0.7, 'op4.release': 0.3,
};

const note = (midi: number): NoteSpec =>
  ({ midi, beginSec: 0, durationSec: 1.0, velocity: 0.8, accent: false, slide: false });

function render(bag: ParamBag, midi: number, seconds: number): Float32Array {
  const v = new FMRenderer(note(midi), bag, SR);
  const buf = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < buf.length; i++) buf[i] = v.renderSample(i / SR);
  return buf;
}

const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// Autocorrelation pitch detector, searched ±3 semitones around the expected
// frequency so a strong periodicity near the note is found reliably (robust to
// FM sidebands); returns the detected fundamental in Hz.
function detectPitchHz(buf: Float32Array, sr: number, expectedHz: number): number {
  const lo = expectedHz * Math.pow(2, -3 / 12);
  const hi = expectedHz * Math.pow(2, 3 / 12);
  const minLag = Math.max(2, Math.floor(sr / hi));
  const maxLag = Math.ceil(sr / lo);
  let bestLag = minLag, best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < buf.length; i++) s += buf[i] * buf[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return sr / bestLag;
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const MIDI = 60;                       // C4
const isMelodic = (name: string) => /^(EP|KEY) /.test(name);

describe('FM presets — objective musicality guard', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s is audible and does not clip', (_name, preset) => {
    const bag: ParamBag = { ...DEFAULT_BAG, ...preset.params };
    const buf = render(bag, MIDI, 0.5);
    expect(rms(buf)).toBeGreaterThan(0.002);   // audible
    expect(peak(buf)).toBeLessThan(1.0);       // no clipping
  });

  const melodic = PRESETS.filter((p) => isMelodic(p.name));
  it.each(melodic.map((p) => [p.name, p] as const))('%s plays in tune (±1 semitone)', (_name, preset) => {
    const bag: ParamBag = { ...DEFAULT_BAG, ...preset.params };
    // Measure a steady window after the attack.
    const full = render(bag, MIDI, 0.6);
    const win = full.subarray(Math.floor(SR * 0.15), Math.floor(SR * 0.4));
    const f = detectPitchHz(win, SR, midiToHz(MIDI));
    const cents = Math.abs(1200 * Math.log2(f / midiToHz(MIDI)));
    expect(cents).toBeLessThan(100);
  });
});
