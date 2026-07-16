// src/presets/wavetable-presets.test.ts
//
// Guards public/presets/wavetable.json against the engine's own param schema and
// against silence — the sibling of subtractive-presets.test.ts. JSON is the source
// of truth for presets, which means a typo'd param id is silently ignored by
// `param(bag, id, default)` and an out-of-range value is silently clamped (or not)
// — neither throws, both just sound wrong. This test is the thing that notices.
//
// Deliberately NOT re-tested here (preset-sanity.test.ts already covers it for
// every engine): the file parses, names are unique, gm entries are valid ints.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../engines/wavetable';               // registers the wavetable descriptor engine
import { getEngine } from '../engines/registry';
import { WavetableRenderer } from '../audio-dsp/wavetable-renderer';
import type { ParamBag } from '../audio-dsp/types';

interface Preset { name: string; gm?: number[]; params: Record<string, number> }
const PRESETS: Preset[] = JSON.parse(
  readFileSync(resolve('public/presets/wavetable.json'), 'utf8'),
).presets;

// The engine's own schema, via the registry — i.e. exactly what the UI can reach.
const SPECS = getEngine('wavetable')!.params;
const SPEC_BY_ID = new Map(SPECS.map((s) => [s.id, s]));

// NOTE — there is deliberately NO `output.trim` exception here, unlike the
// subtractive and FM guards. That param is a per-renderer opt-in (gain-staging.ts:
// "read at voice spawn by each renderer"), and WavetableRenderer never reads it.
// In this engine's JSON it would be a param that does nothing at all — which is
// precisely what this suite exists to catch. Don't copy the exception across.
const DEFAULT_BAG: ParamBag = Object.fromEntries(SPECS.map((s) => [s.id, s.default]));

const SR = 48000;
const MIDI = 60;   // C4 — the register the leads, pads and strings alike are written for

function render(preset: Preset, seconds: number, midi = MIDI): Float32Array {
  const bag: ParamBag = { ...DEFAULT_BAG, ...preset.params };
  return renderBag(bag, seconds, midi);
}
function renderBag(bag: ParamBag, seconds: number, midi = MIDI): Float32Array {
  const v = new WavetableRenderer(
    { midi, beginSec: 0, durationSec: seconds * 0.6, velocity: 0.8, accent: false, slide: false },
    bag, SR,
  );
  const buf = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < buf.length; i++) buf[i] = v.renderSample(i / SR);
  return buf;
}
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('wavetable presets — every param is one the engine actually has', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s uses only declared params', (_name, preset) => {
    for (const id of Object.keys(preset.params)) {
      expect(SPEC_BY_ID.has(id), `unknown param "${id}" — not in the Wavetable engine's param spec`).toBe(true);
    }
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))('%s keeps every value inside its spec range', (_name, preset) => {
    for (const [id, value] of Object.entries(preset.params)) {
      expect(Number.isFinite(value), `"${id}" is not a finite number`).toBe(true);
      const spec = SPEC_BY_ID.get(id);
      if (!spec) continue;   // reported by the test above
      expect(value, `"${id}" below min ${spec.min}`).toBeGreaterThanOrEqual(spec.min);
      expect(value, `"${id}" above max ${spec.max}`).toBeLessThanOrEqual(spec.max);
    }
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))('%s gives discrete params whole numbers', (_name, preset) => {
    // osc.waveA/waveB index the table list (0=Sine .. 7=Vocal) and amp.builtinEnv
    // is off/on. 1.5 is not a table: the renderer rounds it, so a fractional wave
    // is a preset that does not play what it says.
    for (const [id, value] of Object.entries(preset.params)) {
      if (SPEC_BY_ID.get(id)?.kind !== 'discrete') continue;
      expect(Number.isInteger(value), `discrete "${id}" = ${value} is not an integer`).toBe(true);
    }
  });
});

// Both thresholds are absolute, which the house rule calls a brittleness smell —
// justified here because both facts ARE absolute rather than comparative, and both
// numbers were measured on THIS renderer. Neither transfers from another engine:
// the FM guard's `peak < 1.0` would fail 4 presets already in this pack.
//
// SILENT: measured against silence, not against another preset. 0.01 sits ~5.7x
//   below the quietest preset in the pack (FX Atmosphere, rms 0.057 at C2), so it
//   catches a preset that makes no sound — a closed filter, a zeroed table — and
//   still lets a pad be quiet on purpose.
// BLOW_UP: NOT a 0 dBFS clip test. A wavetable voice is not the output: it runs
//   into the lane fader and the master soft-clip, and its SVF legitimately rings
//   above unity (measured on a square: peak 0.81 at resonance 0, 1.54 at 0.2, 8.24
//   at 1.0). But unlike the subtractive and the FM, THIS renderer never reads
//   `output.trim` — there is no per-preset lever to pull a hot patch back, so a
//   preset's own resonance is the only thing standing between it and arriving 4x
//   hotter than its neighbours. 3.0 is ~1.6x the loudest preset in the pack (LEAD
//   Saw Classic, 1.92 at C5) and well under the 8.24 the filter alone can reach.
const SILENT = 0.01;
const BLOW_UP = 3.0;

describe('wavetable presets — every preset makes a sound', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s is audible and stays bounded', (_name, preset) => {
    for (const midi of [36, 60, 84]) {   // the filter cutoff is absolute, so brightness is key-dependent
      const buf = render(preset, 0.5, midi);
      expect(rms(buf), `silent at midi ${midi}`).toBeGreaterThan(SILENT);
      expect(peak(buf), `blew up at midi ${midi}`).toBeLessThan(BLOW_UP);
    }
  });
});

// The presets ported from mpump (AGPL-3.0, see public/presets/ATTRIBUTION.md).
// Listed by name on purpose: this is the machine-readable half of the provenance
// note — it fails if a ported preset is dropped or silently renamed, and every
// name here is checked by the schema + audibility suites above.
const PORTED_FROM_MPUMP = ['PAD Downtempo', 'LEAD Organ House'];

describe('presets ported from mpump', () => {
  it('are all present', () => {
    const names = new Set(PRESETS.map((p) => p.name));
    expect(PORTED_FROM_MPUMP.filter((n) => !names.has(n))).toEqual([]);
  });

  // mpump's `unison: 2` is two copies of the SAME table detuned to ∓spread cents.
  // Loom's osc.detune IS that — it splits A and B to ∓detune — but only while A and
  // B are the same table; point them at different tables and the same number stops
  // being a unison and becomes two different waves pulled apart. So the port sets
  // waveA === waveB, and the detune is the patch, not a garnish: at 0 the two
  // oscillators collapse into one wave at double amplitude and the beating dies.
  const UNISON_PORTS = ['PAD Downtempo'];

  it.each(UNISON_PORTS)('%s is a unison, not one wave (waveA === waveB, detune bites)', (name) => {
    const preset = PRESETS.find((p) => p.name === name)!;
    expect(preset.params['osc.waveA'], 'a unison needs both oscillators on one table')
      .toBe(preset.params['osc.waveB']);
    expect(preset.params['osc.detune']).toBeGreaterThan(0);
    const bag: ParamBag = { ...DEFAULT_BAG, ...preset.params };
    const a = render(preset, 0.5);
    const b = renderBag({ ...bag, 'osc.detune': 0 }, 0.5);
    // Mean absolute difference, relative to the preset's own level — so this is a
    // ratio, not a magnitude, and survives any future re-voicing of the patch.
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d / a.length / Math.max(1e-9, rms(a))).toBeGreaterThan(0.1);
  });
});
