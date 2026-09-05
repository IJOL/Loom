// plugins/westcoast/preset-levels.dsp.test.ts
//
// Westcoast was the hot engine of the bank: 16 of its 24 presets exceeded ±1
// on a single soft mid note (audition battery, 2026-09-03), and its accent
// path drives the WAVEFOLDER — so its real material, which arrives accented,
// runs hotter still. The 2026-09-05 lane staging bounds a lane at 0.98, but
// bounded is not calibrated: a preset living inside the lane soft clip is
// still a distorted preset.
//
// The rule this pins (same contract as subtractive/preset-levels): a preset,
// played the way its family is played — every preset one ACCENTED note, the
// sustained families a held four-note chord — reaches the master under the
// soft-clip knee. `output.trim` is a pure output gain, so a preset brought
// under the knee sounds exactly as it did, minus the clipper.
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1, registerRenderer: () => {},
  };
});

import { registerRenderer } from '../../src/audio-dsp/renderer-registry';
import { VoiceManager } from '../../src/audio-dsp/voice-manager';
import { CATEGORY_GAIN } from '../../src/audio-dsp/gain-staging';
import { MASTER_SOFTCLIP_KNEE } from '../../src/app/audio-graph';
import { WestcoastRenderer } from './dsp';
import presetFile from './presets.json';
import manifest from './plugin.json';

const SR = 24000; // levels, not spectra — half rate renders the whole bank fast
registerRenderer('westcoast', (n, p, sr) => new WestcoastRenderer(n, p, sr));

interface Preset { name: string; params: Record<string, number> }
const PRESETS = (presetFile as unknown as { presets: Preset[] }).presets;
const COMPONENT = manifest.components[0];
const HOST_TRIM = COMPONENT.capabilities.outputTrim * CATEGORY_GAIN.synth;
const IDS = COMPONENT.params.map((p) => p.id);
const DEFAULTS: Record<string, number> = {};
for (const p of COMPONENT.params) DEFAULTS[p.id] = p.default;

const CHORD = [43, 50, 55, 59];

function peakOf(preset: Preset, midis: number[]): number {
  const bag = { ...DEFAULTS, ...preset.params };
  const vm = new VoiceManager(SR, 'westcoast', bag, HOST_TRIM, IDS);
  vm.setMaxVoices(16);
  for (const midi of midis) {
    // Accented on purpose: accent is this engine's folder drive, and the real
    // clips that broke (velocity 115) arrive accented throughout.
    vm.spawn({ beginSec: 0, durationSec: 1.2, midi, velocity: 0.9, accent: true, slide: false });
  }
  let peak = 0;
  const n = Math.floor(2 * SR);
  for (let i = 0; i < n; i++) {
    const v = Math.abs(vm.renderSample(i / SR));
    if (v > peak) peak = v;
  }
  return peak;
}

/** Families that are PLAYED sustained/stacked — they must survive the chord. */
const SUSTAINED = /^(PAD|DRONE|KEYS|FX) /;

describe('westcoast presets reach the master under the soft-clip knee', () => {
  it('the bank is present', () => {
    expect(PRESETS.length).toBeGreaterThan(20);
  });

  for (const preset of PRESETS) {
    it(`${preset.name} plays one accented note under the knee`, () => {
      expect(peakOf(preset, [50])).toBeLessThanOrEqual(MASTER_SOFTCLIP_KNEE);
    });
  }

  for (const preset of PRESETS.filter((p) => SUSTAINED.test(p.name))) {
    it(`${preset.name} holds a chord under the knee`, () => {
      expect(peakOf(preset, CHORD)).toBeLessThanOrEqual(MASTER_SOFTCLIP_KNEE);
    });
  }

  // Levelled, not merely capped — a bank where one preset is eight times
  // another changes the MIX before it changes the sound. Each preset is
  // measured at the material it is PLAYED at (the same metric its knee pin
  // uses): a pad calibrated for the chord is naturally quieter per note, and
  // comparing its single note against a lead's would call that a defect.
  it('no preset is more than four times another at its own material', () => {
    const peaks = PRESETS.map((p) =>
      peakOf(p, SUSTAINED.test(p.name) ? CHORD : [50])).filter((p) => p > 0);
    expect(Math.max(...peaks) / Math.min(...peaks)).toBeLessThan(4);
  });
});
