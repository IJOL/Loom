// src/presets/subtractive-filter-presets.test.ts
//
// The Subtractive filter grew into a stack six commits ago — two circuits'
// worth of taps, four routing modes, a Track control, plus a ring modulator
// and PWM that were never demonstrated at all — and nothing in the preset
// pack made any of it audible. This file is the coverage net: it walks
// FILTER_MODES and fails if any declared (mode, tap) pair has no preset
// demonstrating it, rather than trusting that seventeen new presets add up
// to full coverage.
//
// Rendering reuses subtractive-presets.test.ts's shape (same renderer, same
// SR, same note) so a failure here means the preset itself, not a different
// measurement.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUB_PARAM_SPECS } from '../engines/subtractive-params';
import { FILTER_MODES } from '../audio-dsp/filter-kinds';
import { SubtractiveVoiceRenderer } from '../audio-dsp/subtractive-renderer';
import type { ParamBag } from '../audio-dsp/types';

interface ModConnection { id: string; paramId: string; depth: number }
interface Modulator { id: string; kind: string; enabled: boolean; connections: ModConnection[] }
interface Preset { name: string; gm?: number[]; params: Record<string, number>; modulators?: Modulator[] }

const PRESETS: Preset[] = JSON.parse(
  readFileSync(resolve('public/presets/subtractive.json'), 'utf8'),
).presets;

const SPEC_BY_ID = new Map(SUB_PARAM_SPECS.map((s) => [s.id, s]));
const DEFAULT_BAG: ParamBag = Object.fromEntries(SUB_PARAM_SPECS.map((s) => [s.id, s.default]));

const SR = 48000;
const MIDI = 48;

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

function byName(name: string): Preset {
  const p = PRESETS.find((x) => x.name === name);
  if (!p) throw new Error(`preset "${name}" is missing`);
  return p;
}

/** True when the preset carries an ENABLED modulator of `kind` with a
 *  non-zero connection to `paramId` — the thing a picture of the modulation
 *  panel would show, not just a modulator sitting in the file unconnected. */
function connectedTo(name: string, paramId: string, kind: string): boolean {
  const p = byName(name);
  for (const m of p.modulators ?? []) {
    if (m.kind !== kind || !m.enabled) continue;
    if (m.connections.some((c) => c.paramId === paramId && c.depth !== 0)) return true;
  }
  return false;
}

// The seventeen presets this task adds, in table order (see the task brief).
const STACK_PRESETS = [
  'PAD Glass Air',
  'PAD Hollow Band',
  'LEAD Notch Vox',
  'BASS Twin Growl',
  'KEY Morph Two Ways',
  'LEAD BP Sweep',
  'BASS Acid Diode',
  'PLUCK Thin Air',
  'LEAD Formant Two',
  'BASS Hollow Sub',
  'PAD Phase Ghost',
  'LEAD Moog Cream',
  'STRINGS Comb Pluck',
  'PAD Clarinet Comb',
  'FX Metal Comb',
  'KEY Bell Ring',
  'PAD PWM Breather',
];

describe('subtractive filter-stack presets exist and are audible', () => {
  it.each(STACK_PRESETS)('%s exists in the pack', (name) => {
    expect(() => byName(name)).not.toThrow();
  });

  it.each(STACK_PRESETS)('%s is audible above the silence floor', (name) => {
    const buf = render(byName(name), 0.5);
    expect(rms(buf)).toBeGreaterThan(0.01);
  });
});

describe('subtractive filter-stack presets exercise the whole stack', () => {
  it('covers every (mode, tap) pair the table declares', () => {
    const used = new Set<string>();
    for (const name of STACK_PRESETS) {
      const p = byName(name).params;
      used.add(`${p['filter.model'] ?? 0}/${p['filter.type'] ?? 0}`);
      if ((p['filter.routing'] ?? 0) !== 0) used.add(`${p['filter2.model'] ?? 0}/${p['filter2.type'] ?? 1}`);
    }
    const missing = FILTER_MODES.flatMap((m, mi) =>
      m.taps.map((t, ti) => (used.has(`${mi}/${ti}`) ? null : `${m.label} ${t}`)),
    ).filter(Boolean);
    expect(missing, 'no preset demonstrates these').toEqual([]);
  });

  it('covers every routing mode', () => {
    const used = new Set(STACK_PRESETS.map((n) => byName(n).params['filter.routing'] ?? 0));
    expect([...used].sort()).toEqual([0, 1, 2, 3]);
  });

  it('demonstrates both ends of Track', () => {
    const t = STACK_PRESETS.map((n) => byName(n).params['filter2.track']).filter((v) => v !== undefined) as number[];
    expect(Math.min(...t)).toBe(0);
    expect(Math.max(...t)).toBe(1);
  });

  it('demonstrates the duplicate case the two slots exist to allow', () => {
    // The SAME filter in both slots at different cutoffs, subtracted.
    const p = byName('PAD Phase Ghost').params;
    expect(p['filter.model']).toBe(p['filter2.model']);
    expect(p['filter.type']).toBe(p['filter2.type']);
    expect(p['filter.routing']).toBe(3);
    expect(p['filter.cutoff']).not.toBe(p['filter2.cutoff']);
  });

  it('demonstrates the ring modulator and PWM, which had no preset at all', () => {
    expect(byName('FX Metal Comb').params['ring.level']).toBeGreaterThan(0.5);
    expect(connectedTo('KEY Bell Ring', 'ring.level', 'adsr')).toBe(true);
    expect(byName('PAD PWM Breather').params['osc1.wave'], 'width only bites on a square').toBe(1);
    expect(connectedTo('PAD PWM Breather', 'osc1.pw', 'lfo')).toBe(true);
  });

  it('ships a modulator on Blend, from an LFO and from an ADSR', () => {
    expect(connectedTo('BASS Twin Growl', 'filter.blend', 'lfo')).toBe(true);
    expect(connectedTo('KEY Morph Two Ways', 'filter.blend', 'adsr')).toBe(true);
  });
});
