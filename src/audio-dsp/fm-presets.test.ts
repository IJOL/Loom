import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../engines/fm';                     // registers the FM descriptor engine
import { getEngine } from '../engines/registry';
import { FMRenderer } from './fm-renderer';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;

interface Preset { name: string; gm?: number[]; params: Record<string, number> }
const PRESETS: Preset[] = JSON.parse(
  readFileSync(resolve('public/presets/fm.json'), 'utf8'),
).presets;

// The engine's own schema, via the registry — i.e. exactly what the UI can reach.
const SPECS = getEngine('fm')!.params;
const SPEC_BY_ID = new Map(SPECS.map((s) => [s.id, s]));

// The one param a preset may carry that is NOT in the schema: the per-preset
// gain-staging lever documented in audio-dsp/gain-staging.ts and read by the
// renderer as `param(p, 'output.trim', 1)`. It has no knob by design. Anything
// else absent from the schema is a typo: `param()` would ignore it silently.
const OUTPUT_TRIM = 'output.trim';
const TRIM_MIN = 0.1, TRIM_MAX = 4;

// A full bag of schema defaults; each preset's params override it. Built FROM the
// schema so it tracks the contract instead of duplicating it (the hand-written bag
// this replaced had drifted: algorithm 0 vs the schema's 2, op3.ratio 3 vs 1, ...).
const DEFAULT_BAG: ParamBag = Object.fromEntries(SPECS.map((s) => [s.id, s.default]));

const note = (midi: number): NoteSpec =>
  ({ midi, beginSec: 0, durationSec: 1.0, velocity: 0.8, accent: false, slide: false });

function render(bag: ParamBag, midi: number, seconds: number): Float32Array {
  const v = new FMRenderer(note(midi), bag, SR);
  const buf = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < buf.length; i++) buf[i] = v.renderSample(i / SR);
  return buf;
}
const bagOf = (p: Preset): ParamBag => ({ ...DEFAULT_BAG, ...p.params });

const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Crude brightness: rms of the first difference over rms of the signal — a
 *  +6 dB/oct tilt, monotone in spectral centroid. Only ever used as a RATIO
 *  between two renders, never as a magnitude. */
function brightness(b: Float32Array): number {
  let d = 0;
  for (let i = 1; i < b.length; i++) d += (b[i] - b[i - 1]) ** 2;
  return Math.sqrt(d / b.length) / Math.max(1e-9, rms(b));
}

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
const isMelodic = (name: string) => /^(EP|KEY|BASS) /.test(name);

describe('FM presets — every param is one the engine actually has', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s uses only declared params', (_name, preset) => {
    for (const id of Object.keys(preset.params)) {
      if (id === OUTPUT_TRIM) continue;
      expect(SPEC_BY_ID.has(id), `unknown param "${id}" — not in the FM engine's param spec`).toBe(true);
    }
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))('%s keeps every value inside its spec range', (_name, preset) => {
    for (const [id, value] of Object.entries(preset.params)) {
      expect(Number.isFinite(value), `"${id}" is not a finite number`).toBe(true);
      if (id === OUTPUT_TRIM) {
        expect(value).toBeGreaterThanOrEqual(TRIM_MIN);
        expect(value).toBeLessThanOrEqual(TRIM_MAX);
        continue;
      }
      const spec = SPEC_BY_ID.get(id);
      if (!spec) continue;   // reported by the test above
      expect(value, `"${id}" below min ${spec.min}`).toBeGreaterThanOrEqual(spec.min);
      expect(value, `"${id}" above max ${spec.max}`).toBeLessThanOrEqual(spec.max);
    }
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))('%s gives discrete params whole numbers', (_name, preset) => {
    // `algorithm` indexes ALGORITHMS[]; 1.5 is not an algorithm — the renderer
    // rounds it and the UI dropdown could not show it.
    for (const [id, value] of Object.entries(preset.params)) {
      if (SPEC_BY_ID.get(id)?.kind !== 'discrete') continue;
      expect(Number.isInteger(value), `discrete "${id}" = ${value} is not an integer`).toBe(true);
    }
  });
});

describe('FM presets — objective musicality guard', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s is audible and does not clip', (_name, preset) => {
    const buf = render(bagOf(preset), MIDI, 0.5);
    expect(rms(buf)).toBeGreaterThan(0.002);   // audible
    // Unlike the subtractive's (which rings above unity on a resonant SVF), an FM
    // voice has no filter: it is tanh-limited and trimmed to 0.25 x the synth
    // category gain, so it cannot legitimately reach unity. The pack measures
    // peak <= 0.21. This bound is the FM renderer's, and does not transfer.
    expect(peak(buf)).toBeLessThan(1.0);       // no clipping
  });

  const melodic = PRESETS.filter((p) => isMelodic(p.name));
  it.each(melodic.map((p) => [p.name, p] as const))('%s plays in tune (±1 semitone)', (_name, preset) => {
    // Measure a steady window after the attack.
    const full = render(bagOf(preset), MIDI, 0.6);
    const win = full.subarray(Math.floor(SR * 0.15), Math.floor(SR * 0.4));
    const f = detectPitchHz(win, SR, midiToHz(MIDI));
    const cents = Math.abs(1200 * Math.log2(f / midiToHz(MIDI)));
    expect(cents).toBeLessThan(100);
  });
});

// The presets ported from mpump (AGPL-3.0, see public/presets/ATTRIBUTION.md).
// Listed by name on purpose: this is the machine-readable half of the provenance
// note — it fails if a ported preset is dropped or silently renamed, and every
// name here is checked by the schema + audibility suites above.
const PORTED_FROM_MPUMP = ['BELL Digital', 'BELL Ring', 'EP Lo-Fi Rhodes', 'BASS Sub Pluck'];

describe('presets ported from mpump', () => {
  it('are all present', () => {
    const names = new Set(PRESETS.map((p) => p.name));
    expect(PORTED_FROM_MPUMP.filter((n) => !names.has(n))).toEqual([]);
  });

  // mpump's FM is 2-operator: one carrier, one modulator, a constant index. Loom's
  // is four operators with a per-op envelope each, so the port holds the index
  // constant by giving every modulator sustain 1 — mpump's index does not decay.
  // Let a modulator's sustain drop and the patch keeps its name while the timbre
  // collapses to a sine as the note holds: nothing throws, it just stops being FM.
  it.each(PORTED_FROM_MPUMP)('%s holds its FM index for the whole note (modulator sustain 1)', (name) => {
    const p = PRESETS.find((x) => x.name === name)!;
    const bag = bagOf(p);
    const mods = [2, 3, 4].filter((n) => (bag[`op${n}.level`] as number) > 0
      && !(name === 'BASS Sub Pluck' && n === 3));      // op3 there is the sub CARRIER, not a modulator
    expect(mods.length, 'a 2-op port needs at least one live modulator').toBeGreaterThan(0);
    for (const n of mods) expect(bag[`op${n}.sustain`], `op${n} is a modulator: its level is the FM index`).toBe(1);
  });

  // BELL Ring is the one port that cannot be said with a single modulator: mpump
  // asks for index 8 and one operator tops out at 3 (level 1 x FM_DEPTH 3), so it
  // stacks three modulators at the SAME ratio on algorithm 1 — identical
  // oscillators sum, and the index sums with them: 3 x 3 = 9 is the engine's ceiling.
  // Zero two of them and the index silently falls to 8/3: the bell stops ringing.
  it('BELL Ring stacks three modulators at one ratio to reach mpump\'s index 8', () => {
    const p = PRESETS.find((x) => x.name === 'BELL Ring')!;
    expect(p.params['algorithm'], 'algorithm 1 = parallel mods -> op1').toBe(1);
    for (const n of [3, 4]) {
      expect(p.params[`op${n}.ratio`], `op${n} must share op2's ratio or it is a different modulator`)
        .toBe(p.params['op2.ratio']);
      expect(p.params[`op${n}.level`]).toBe(p.params['op2.level']);
    }
    // 3 x 0.889 x FM_DEPTH(3) = 8.0 — the index mpump asks for.
    expect(3 * (p.params['op2.level'] as number) * 3).toBeCloseTo(8, 1);
    // ...and the stack is audible, not bookkeeping: one modulator is far duller.
    const full = render(bagOf(p), MIDI, 0.3);
    const single = render({ ...bagOf(p), 'op3.level': 0, 'op4.level': 0 }, MIDI, 0.3);
    expect(brightness(full)).toBeGreaterThan(brightness(single) * 1.5);
  });

  // mpump's FM Bass is FM + a sine one octave down at subLevel 0.5. Loom's FM has
  // no sub-osc, but algorithm 2 has a second carrier: op3 at ratio 0.5, unmodulated
  // (op4.level 0), is that sine exactly. Drop it and the bass loses its bottom.
  it('BASS Sub Pluck carries mpump\'s sub-osc as an unmodulated ratio-0.5 carrier', () => {
    const p = PRESETS.find((x) => x.name === 'BASS Sub Pluck')!;
    expect(p.params['algorithm'], 'algorithm 2 = two pairs, so op1 AND op3 are carriers').toBe(2);
    expect(p.params['op3.ratio'], 'one octave below the carrier').toBe(0.5);
    expect(p.params['op4.level'], 'op4 modulates op3; the sub must stay a pure sine').toBe(0);
    // The sub is half the carrier's mix level, as mpump's subLevel 0.5 is.
    expect((p.params['op3.level'] as number) / (p.params['op1.level'] as number)).toBeCloseTo(0.5, 1);
    // Removing it costs real low-end energy, at the bass register it is written for.
    const withSub = render(bagOf(p), 40, 0.3);
    const without = render({ ...bagOf(p), 'op3.level': 0 }, 40, 0.3);
    expect(rms(withSub)).toBeGreaterThan(rms(without) * 1.15);
  });
});
