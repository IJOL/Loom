// src/presets/subtractive-presets.test.ts
//
// Guards public/presets/subtractive.json against the engine's own param schema
// and against silence. JSON is the source of truth for presets, which means a
// typo'd param id is silently ignored by `param(bag, id, default)` and an
// out-of-range value is silently clamped (or not) — neither throws, both just
// sound wrong. This test is the thing that notices.
//
// Deliberately NOT re-tested here (preset-sanity.test.ts already covers it for
// every engine): the file parses, names are unique, gm entries are valid ints.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUB_PARAM_SPECS } from '../engines/subtractive-params';
import { SubtractiveVoiceRenderer } from '../audio-dsp/subtractive-renderer';
import type { ParamBag } from '../audio-dsp/types';

interface Preset { name: string; gm?: number[]; params: Record<string, number> }
const PRESETS: Preset[] = JSON.parse(
  readFileSync(resolve('public/presets/subtractive.json'), 'utf8'),
).presets;

const SPEC_BY_ID = new Map(SUB_PARAM_SPECS.map((s) => [s.id, s]));

// The one param a preset may carry that is NOT in SUB_PARAM_SPECS: the per-preset
// gain-staging lever documented in audio-dsp/gain-staging.ts and read by the
// renderer as `param(p, 'output.trim', 1)`. It has no knob by design — it balances
// a preset against its neighbours rather than being played. Anything else absent
// from the schema is a typo: the renderer would ignore it and the UI could not
// reach it (a hidden param).
const OUTPUT_TRIM = 'output.trim';
const TRIM_MIN = 0.1, TRIM_MAX = 4;   // a trim outside this is a gain-staging bug, not a choice

// A full bag of schema defaults; each preset's params override it. Built FROM the
// schema so it tracks the contract instead of duplicating it.
const DEFAULT_BAG: ParamBag = Object.fromEntries(SUB_PARAM_SPECS.map((s) => [s.id, s.default]));

const SR = 48000;
const MIDI = 48;   // C3 — common ground for the bass, lead and pad presets alike

function render(preset: Preset, seconds: number): Float32Array {
  const bag: ParamBag = { ...DEFAULT_BAG, ...preset.params };
  const v = new SubtractiveVoiceRenderer(
    { midi: MIDI, beginSec: 0, durationSec: seconds * 0.6, velocity: 0.8, accent: false, slide: false },
    bag, SR,
  );
  const buf = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < buf.length; i++) buf[i] = v.renderSample(i / SR);
  return buf;
}
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('subtractive presets — every param is one the engine actually has', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s uses only declared params', (_name, preset) => {
    for (const id of Object.keys(preset.params)) {
      if (id === OUTPUT_TRIM) continue;
      expect(SPEC_BY_ID.has(id), `unknown param "${id}" — not in SUB_PARAM_SPECS`).toBe(true);
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
    // A discrete param indexes a list (wave 0..3, builtinEnv off/on). 1.5 is not a
    // wave — the renderer's switch would silently fall through to saw.
    for (const [id, value] of Object.entries(preset.params)) {
      if (SPEC_BY_ID.get(id)?.kind !== 'discrete') continue;
      expect(Number.isInteger(value), `discrete "${id}" = ${value} is not an integer`).toBe(true);
    }
  });
});

// Both thresholds are absolute, which the house rule calls a brittleness smell —
// justified here because both facts ARE absolute rather than comparative:
//
// SILENT: measured against silence, not against another preset. 0.01 sits 4.5x
//   below the quietest preset in the pack (PAD Sweep / PAD Choir, rms ~0.045), so
//   it catches a preset that makes no sound — a closed filter, a zeroed osc — and
//   still lets a pad be quiet on purpose.
// BLOW_UP: NOT a 0 dBFS clip test. A subtractive voice is not the output: it runs
//   into the lane fader and the master soft-clip, and a resonant SVF legitimately
//   rings above unity (the pack peaks at ~2.5 on the acid presets). The real
//   contract is the renderer's own resonance bound — subtractive-renderer.test.ts
//   asserts peak < 4.0 at max resonance. Above that is an undamped-filter bug.
const SILENT = 0.01;
const BLOW_UP = 4.0;

describe('subtractive presets — every preset makes a sound', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s is audible and stays bounded', (_name, preset) => {
    const buf = render(preset, 0.5);
    expect(rms(buf)).toBeGreaterThan(SILENT);
    expect(peak(buf)).toBeLessThan(BLOW_UP);
  });
});

// The presets ported from mpump (AGPL-3.0, see public/presets/ATTRIBUTION.md).
// Listed by name on purpose: this is the machine-readable half of the provenance
// note — it fails if a ported preset is dropped or silently renamed, and every
// name here is checked by the schema + audibility suites above.
const PORTED_FROM_MPUMP = [
  'LEAD Classic Saw', 'LEAD Acid Squelch', 'LEAD Screamer', 'LEAD Gritty Pulse', 'LEAD Sub',
  'PLUCK Stab', 'PLUCK House Stab', 'PLUCK Trance Arp', 'PLUCK EDM',
  'PAD Dark Drone', 'PAD Dub Chord', 'PAD Pulse',
  'BASS Deep Sub', 'BASS Square', 'BASS Warm', 'BASS Distorted', 'BASS Reese Deep',
  'BASS Foghorn', 'BASS Zapper', 'BASS House Pump', 'BASS Garage', 'BASS UK Sub',
  'BASS Pulse', 'BASS Jungle', 'BASS Dub', 'BASS Arp', 'BASS Techno Stab',
  'BASS Tape Sub', 'BASS Psy',
];

describe('presets ported from mpump', () => {
  it('are all present', () => {
    const names = new Set(PRESETS.map((p) => p.name));
    expect(PORTED_FROM_MPUMP.filter((n) => !names.has(n))).toEqual([]);
  });

  // mpump's `pwm` oscillator is a pulse whose width is swept by a built-in LFO.
  // Loom's square IS the same saw-minus-shifted-saw pulse, but a preset can only
  // carry param values — not a modulator — so these ports are a STATIC pulse and
  // are named "Pulse", never "PWM". The one thing the name still promises is that
  // they are a pulse and not a plain square, which is exactly what osc1.pw buys.
  // Drop the width and they become squares silently: nothing throws, they just
  // stop being the patch they claim to be.
  const PULSE_PORTS = ['PAD Pulse', 'BASS Pulse', 'LEAD Gritty Pulse', 'BASS Jungle'];

  it.each(PULSE_PORTS)('%s is a pulse, not a square', (name) => {
    const preset = PRESETS.find((p) => p.name === name)!;
    expect(preset.params['osc1.wave'], 'a width only bites on a square').toBe(1);
    const asSquare: Preset = {
      ...preset,
      params: { ...preset.params, 'osc1.pw': 0.5, 'osc2.pw': 0.5 },
    };
    const a = render(preset, 0.25), b = render(asSquare, 0.25);
    // Mean absolute difference, relative to the preset's own level — so this is a
    // ratio, not a magnitude, and survives any future re-voicing of the patch.
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d / a.length / Math.max(1e-9, rms(a))).toBeGreaterThan(0.1);
  });
});
