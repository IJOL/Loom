// plugins/subtractive/preset-levels.dsp.test.ts
//
// A PAD is played as a held chord — that is what makes it a pad — so the level
// it has to survive is four voices at once, not one. Every pad in this bank was
// voiced at one note and shipped 2–3× over the master's soft-clip knee, which
// costs the sound twice: the held part distorts, and the release does not begin
// to fade until the envelope has fallen far enough to leave the clipper, so a
// 1.8 s tail holds flat and then drops off a cliff. Reported as "PAD PWM
// Breather clipea muchísimo, tiene un final abrupto" (2026-08-29).
//
// The rule this pins: a pad, playing the chord it exists to play, reaches the
// master under the knee. Nothing here is about loudness — `output.trim` is a
// pure output gain, so a pad that passes sounds exactly as it did, minus the
// clipper.
import { describe, it, expect, vi } from 'vitest';

// dsp.ts registers itself through the ABI at module scope — the global has to
// exist before the import graph runs. Same stub as dsp.test.ts next door.
vi.hoisted(() => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1, registerRenderer: () => {},
  };
});

import { registerRenderer } from '../../src/audio-dsp/renderer-registry';
import { VoiceManager } from '../../src/audio-dsp/voice-manager';
import { CATEGORY_GAIN } from '../../src/audio-dsp/gain-staging';
import { MASTER_SOFTCLIP_KNEE } from '../../src/app/audio-graph';
import { SubtractiveVoiceRenderer } from './dsp';
import presetFile from './presets.json';
import manifest from './plugin.json';

const SR = 24000; // levels, not spectra — half rate renders the whole bank in a second
registerRenderer('subtractive', (n, p, sr) => new SubtractiveVoiceRenderer(n, p, sr));

interface Preset { name: string; params: Record<string, number> }
const PRESETS = (presetFile as unknown as { presets: Preset[] }).presets;
const COMPONENT = manifest.components[0];
/** What the HOST puts between this voice and the master: the engine's own trim
 *  times its category's. A measurement without them is not the listener's. */
const HOST_TRIM = COMPONENT.capabilities.outputTrim * CATEGORY_GAIN.synth;
const IDS = COMPONENT.params.map((p) => p.id);
const DEFAULTS: Record<string, number> = {};
for (const p of COMPONENT.params) DEFAULTS[p.id] = p.default;

/** A four-note chord — the smallest thing that is a chord rather than a note. */
const CHORD = [43, 50, 55, 59];

function peakOfChord(preset: Preset): number {
  const bag = { ...DEFAULTS, ...preset.params };
  const vm = new VoiceManager(SR, 'subtractive', bag, HOST_TRIM, IDS);
  vm.setMaxVoices(16);
  for (const midi of CHORD) {
    vm.spawn({ beginSec: 0, durationSec: 1.2, midi, velocity: 100, accent: false, slide: false });
  }
  let peak = 0;
  const n = Math.floor(2 * SR);
  for (let i = 0; i < n; i++) {
    const v = Math.abs(vm.renderSample(i / SR));
    if (v > peak) peak = v;
  }
  return peak;
}

const PADS = PRESETS.filter((p) => p.name.startsWith('PAD '));

describe('subtractive pads reach the master under the soft-clip knee', () => {
  it('there are pads to check', () => {
    expect(PADS.length).toBeGreaterThan(10);
  });

  for (const preset of PADS) {
    it(`${preset.name} holds a chord without clipping`, () => {
      expect(peakOfChord(preset)).toBeLessThanOrEqual(MASTER_SOFTCLIP_KNEE);
    });
  }

  // Levelled, not merely capped: a bank where one pad is eight times another is
  // a bank where changing preset changes the mix before it changes the sound.
  it('no pad is more than four times another', () => {
    const peaks = PADS.map(peakOfChord).filter((p) => p > 0);
    expect(Math.max(...peaks) / Math.min(...peaks)).toBeLessThan(4);
  });
});
