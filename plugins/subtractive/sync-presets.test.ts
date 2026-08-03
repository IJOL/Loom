// The three mpump presets built on hard sync — Sync Lead, Sync Sweep, Sync Bass.
// Blocked in the harvest because Loom had no sync oscillator; unblocked now that
// the Sync wave exists. Each must select the Sync wave (index 4) and set a real
// ratio, or it is not the patch.

import { describe, it, expect, vi } from 'vitest';
// `dsp.ts` calls Loom.registerRenderer at module scope — that is the ABI — so
// the global must exist before the import graph is evaluated.
vi.hoisted(() => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1, registerRenderer: () => {},
  };
});

import { validatePresetEntry } from '../../src/presets/preset-loader';
import { SubtractiveVoiceRenderer } from './dsp';
import manifest from './plugin.json';
import { CATEGORY_GAIN } from '../../src/audio-dsp/gain-staging';
import presetFile from './presets.json';
import type { ParamBag, NoteSpec } from '@loom/plugin-sdk';

const presets = presetFile.presets as unknown as
  Array<{ name: string; params: Record<string, number>; modulators?: unknown[] }>;
const find = (needle: string) => presets.find((p) => p.name.includes(needle));

const SR = 48000;

/** What the HOST multiplies this plugin's voice by, which the renderer no longer
 *  does itself: the manifest's outputTrim times the synth category gain. The
 *  absolute peak ceilings below were calibrated where the listener meets the
 *  voice, so they are compared against a level with it applied. */
const HOST_TRIM = manifest.components[0].capabilities.outputTrim * CATEGORY_GAIN.synth;

const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const note = (o: Partial<NoteSpec> = {}): NoteSpec =>
  ({ midi: 45, beginSec: 0, durationSec: 0.3, velocity: 0.85, accent: false, slide: false, ...o });
const DEFAULTS: ParamBag = {
  'master.tune': 0, 'osc1.wave': 0, 'osc1.level': 0.6, 'osc1.detune': 0,
  'osc2.wave': 1, 'osc2.level': 0.4, 'osc2.detune': 7, 'sub.level': 0.3, 'noise.level': 0, 'noise.color': 0.6,
  'filter.cutoff': 0.55, 'filter.resonance': 0.25, 'filter.envAmount': 0.45,
  'filter.drive': 0, 'filter.keyTrack': 0, 'filter.builtinEnv': 1,
  'filter.attack': 0.01, 'filter.decay': 0.3, 'filter.sustain': 0.4, 'filter.release': 0.35,
  'amp.builtinEnv': 1, 'amp.attack': 0.01, 'amp.decay': 0.2, 'amp.sustain': 0.7, 'amp.release': 0.3,
};

describe('the three sync presets use the hard-sync oscillator', () => {
  for (const needle of ['LEAD Sync', 'LEAD Sync Sweep', 'BASS Sync']) {
    it(`${needle} selects the Sync wave and sets a ratio, and is audible`, () => {
      const p = find(needle);
      expect(p, `${needle} missing`).toBeDefined();
      expect(validatePresetEntry(p)).toBe(true);
      // Sync wave = index 4; a ratio in the osc's sync param.
      expect(p!.params['osc1.wave'], `${needle} is not on the Sync wave`).toBe(4);
      expect(p!.params['osc1.sync'], `${needle} has no sync ratio`).toBeGreaterThan(1);

      const v = new SubtractiveVoiceRenderer(note(), { ...DEFAULTS, ...p!.params }, SR);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.15; i++) b.push(v.renderSample(i / SR));
      expect(rms(b) * HOST_TRIM, `${needle} is silent`).toBeGreaterThan(0.01);
      expect(Math.max(...b.map(Math.abs)) * HOST_TRIM, `${needle} blew up`).toBeLessThan(4);
    });
  }

  it('Sync Sweep carries an LFO on the cutoff (the sweep)', () => {
    const p = find('LEAD Sync Sweep')!;
    const lfo = (p.modulators as Array<{ kind: string; connections: Array<{ paramId: string }> }> | undefined)
      ?.find((m) => m.kind === 'lfo');
    expect(lfo, 'Sync Sweep has no LFO').toBeDefined();
    expect(lfo!.connections.some((c) => c.paramId === 'filter.cutoff')).toBe(true);
  });
});
