// The GOLDEN-WAV loop, reborn on the worklet-era render path.
//
// Division of labour with its sibling: `preset-stability.dsp.test.ts` is the
// DIVERGENCE detector — every shipped preset, one held note, finite/bounded/
// ends. THIS file is the loop the old per-engine battery fed and the worklet
// cutover orphaned: it renders a short PHRASE for a fixed slice of each
// engine's presets through `renderKernelLane` (the same per-sample
// VoiceManager the worklet runs, with per-note bags and real scheduling) and
// writes the WAVs that `npm run test:wav-diff` compares against `test/golden/`
// and `npm run test:wav-bless` re-blesses.
//
// The assertions here are only the floor — audible and finite. Judging TONE is
// the human's half of the loop: run the suite, then `test:wav-diff`, and listen
// to anything whose peak/RMS/L2 moved. Keep the slice SMALL and DETERMINISTIC:
// the first three presets of each engine, so a preset added at the top of a
// catalogue changes the goldens loudly instead of silently rotating them.
//
// KNOWN drift: the karplus rows always show a small nonzero L2 (~0.1-0.2).
// Its excitation is Math.random in production — every pluck differs, which is
// the instrument, not a regression — so read those rows for GROSS moves only.
import { describe, it, expect } from 'vitest';

// Installs the Loom global forwarding straight into the host's renderer
// registry — must sit above the plugin dsp imports (ESM evaluates in order).
import './plugin-dsp';
import '../plugins/tb303/dsp';
import '../plugins/subtractive/dsp';
import '../plugins/fm/dsp';
import '../plugins/wavetable/dsp';
import '../plugins/karplus/dsp';
import '../plugins/westcoast/dsp';

import tb303Manifest from '../plugins/tb303/plugin.json';
import subtractiveManifest from '../plugins/subtractive/plugin.json';
import fmManifest from '../plugins/fm/plugin.json';
import wavetableManifest from '../plugins/wavetable/plugin.json';
import karplusManifest from '../plugins/karplus/plugin.json';
import westcoastManifest from '../plugins/westcoast/plugin.json';

import tb303Presets from '../plugins/tb303/presets.json';
import subtractivePresets from '../plugins/subtractive/presets.json';
import fmPresets from '../plugins/fm/presets.json';
import wavetablePresets from '../plugins/wavetable/presets.json';
import karplusPresets from '../plugins/karplus/presets.json';
import westcoastPresets from '../plugins/westcoast/presets.json';

import { renderKernelLane, type KernelLaneSpec } from '../src/export/kernel-lane-render';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';
import { writeWav, wavPath } from './wav';

const SR = 44100;
const PRESETS_PER_ENGINE = 3;

interface Preset { name: string; params: Record<string, number> }
interface Manifest { components: { params: { id: string; default: number }[] }[] }

const listOf = (file: unknown): Preset[] => {
  const presets = (file as { presets?: Preset[] }).presets;
  if (!Array.isArray(presets) || presets.length === 0) {
    throw new Error('preset file has no presets array — the render loop would cover nothing');
  }
  return presets.slice(0, PRESETS_PER_ENGINE);
};

const ENGINES: { id: string; manifest: Manifest; presets: Preset[] }[] = [
  { id: 'tb303', manifest: tb303Manifest as Manifest, presets: listOf(tb303Presets) },
  { id: 'subtractive', manifest: subtractiveManifest as Manifest, presets: listOf(subtractivePresets) },
  { id: 'fm', manifest: fmManifest as Manifest, presets: listOf(fmPresets) },
  { id: 'wavetable', manifest: wavetableManifest as Manifest, presets: listOf(wavetablePresets) },
  { id: 'karplus', manifest: karplusManifest as Manifest, presets: listOf(karplusPresets) },
  { id: 'westcoast', manifest: westcoastManifest as Manifest, presets: listOf(westcoastPresets) },
];

/** Same construction as preset-stability's bagFor, for the same reason: every
 *  param the engine DECLARES at its default, the preset's values on top, and
 *  the host-seeded output.trim. Reading the manifest is the point — a param
 *  added tomorrow is covered the day it lands. */
function bagFor(m: Manifest, preset: Preset): ParamBag {
  const bag: ParamBag = {};
  for (const c of m.components) for (const p of c.params) bag[p.id] = p.default;
  for (const [id, v] of Object.entries(preset.params)) {
    if (typeof v === 'number') bag[id] = v;
  }
  bag['output.trim'] = typeof preset.params['output.trim'] === 'number'
    ? preset.params['output.trim'] : 1;
  return bag;
}

const note = (beginSec: number, durationSec: number, midi: number): NoteSpec =>
  ({ midi, beginSec, durationSec, velocity: 0.9, accent: false, slide: false });

/** Root, fifth, octave — non-overlapping so the mono 303 plays it the same as
 *  a poly pad, plus half a second of tail for the releases. */
const PHRASE = [note(0, 0.35, 48), note(0.4, 0.35, 55), note(0.8, 0.5, 60)];
const FRAMES = Math.ceil(1.8 * SR);

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

describe('preset render battery (golden-WAV loop)', () => {
  for (const { id, manifest, presets } of ENGINES) {
    for (const preset of presets) {
      it(`${id} · ${preset.name}`, () => {
        const spec: KernelLaneSpec = {
          engineId: id,
          params: bagFor(manifest, preset),
          maxVoices: 8,
          mods: [],
          notes: PHRASE.map(n => ({ note: n })),
        };
        const buf = renderKernelLane(spec, FRAMES, SR);
        let finite = true;
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          if (!Number.isFinite(buf[i])) { finite = false; break; }
          sum += buf[i] * buf[i];
        }
        expect(finite).toBe(true);
        expect(Math.sqrt(sum / buf.length)).toBeGreaterThan(1e-4);
        writeWav(buf, wavPath(`preset__${id}__${slug(preset.name)}`), SR);
      });
    }
  }
});
