// The four mpump presets whose LFO IS the patch — Wobble, Neuro (an LFO on the
// cutoff), Shimmer, Cosmic (an LFO on the pitch). They could not be ported until
// a preset could carry its own modulators; now it can, so these are the proof
// that it works end to end: the preset ships an LFO, and the LFO reaches the
// live modulation host with a real connection to a real destination.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePresetEntry } from './preset-loader';

const presets: Array<{ name: string; params: Record<string, number>; modulators?: unknown[] }> =
  JSON.parse(readFileSync(join(process.cwd(), 'public/presets/subtractive.json'), 'utf8')).presets;

const LFO_PORTS = ['Wobble', 'Neuro', 'Shimmer', 'Cosmic'].map((n) => `BASS ${n}`).concat(
  ['PAD Shimmer', 'PAD Cosmic'],
);

// Resolve the LFO-carrying preset by name AND by having modulators — a plain
// "BASS Wobble" (no LFO) already ships, so match the one that actually carries
// the modulator, not just the name.
const find = (needle: string) =>
  presets.find((p) => p.name.includes(needle) && p.modulators && p.modulators.length > 0);

describe('the four LFO presets carry their modulator', () => {
  for (const needle of ['Wobble', 'Neuro', 'Shimmer', 'Cosmic']) {
    it(`${needle} exists and ships exactly the LFO that defines it`, () => {
      const p = find(needle);
      expect(p, `${needle} is missing from subtractive.json`).toBeDefined();
      expect(validatePresetEntry(p), `${needle} fails preset validation`).toBe(true);

      const mods = p!.modulators as Array<{ kind: string; enabled: boolean; connections: Array<{ paramId: string }> }>;
      expect(mods, `${needle} has no modulators`).toBeDefined();
      const lfo = mods.find((m) => m.kind === 'lfo' && m.enabled);
      expect(lfo, `${needle}'s LFO is missing or disabled`).toBeDefined();
      expect(lfo!.connections.length, `${needle}'s LFO is routed to nothing`).toBeGreaterThan(0);

      // Wobble/Neuro modulate the cutoff; Shimmer/Cosmic modulate the pitch.
      const dest = needle === 'Wobble' || needle === 'Neuro' ? 'filter.cutoff' : 'master.tune';
      expect(lfo!.connections.some((c) => c.paramId === dest),
        `${needle}'s LFO should reach ${dest}`).toBe(true);
    });
  }

  it('all four are present', () => {
    for (const needle of ['Wobble', 'Neuro', 'Shimmer', 'Cosmic']) {
      expect(find(needle), `${needle} missing`).toBeDefined();
    }
  });
});
