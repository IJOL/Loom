// Does any shipped preset diverge, or refuse to end?
//
// Written for a reported lock-up: "sigue respondiendo pero el sonido está
// lockeado en ruido" — the UI alive, the audio stuck as a wall of noise. That
// shape is not a dead worklet (a dead one is silent). It is either a renderer
// whose state runs away, or voices that never finish and pile up until every
// note is buried. Both are measurable here, sample by sample, with no browser.
//
// Every preset of every engine that ships DSP, held and then released. Three
// questions per preset: does it stay finite, does it stay bounded, and does the
// voice ever go away.
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';

// The plugins register their renderers at module scope through the ABI, so the
// global has to exist before their imports are evaluated — vi.hoisted is the
// only hook that runs that early. The factories are captured here and handed to
// the real registry in beforeAll, so the VoiceManager below reaches them exactly
// as the worklet does.
const { captured } = vi.hoisted(() => {
  const captured = new Map<string, unknown>();
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1,
    registerRenderer: (id: string, make: unknown) => { captured.set(id, make); },
    registerModulatorKernel: () => {},
  };
  return { captured };
});

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

import { VoiceManager } from '../src/audio-dsp/voice-manager';
import { registerRenderer } from '../src/audio-dsp/renderer-registry';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';

const SR = 48000;

interface Preset { name: string; params: Record<string, number> }
interface Manifest { components: { params: { id: string; default: number }[] }[] }

/** A preset FILE is `{ engineId, presets: [...] }` — the same shape the loader
 *  validates. Reaching for `.presets` here rather than assuming an array is
 *  what stops this sweep from silently covering nothing. */
const listOf = (file: unknown): Preset[] => {
  const presets = (file as { presets?: Preset[] }).presets;
  if (!Array.isArray(presets) || presets.length === 0) {
    throw new Error('preset file has no presets array — the sweep would cover nothing');
  }
  return presets;
};

const ENGINES: { id: string; manifest: Manifest; presets: Preset[] }[] = [
  { id: 'tb303', manifest: tb303Manifest as Manifest, presets: listOf(tb303Presets) },
  { id: 'subtractive', manifest: subtractiveManifest as Manifest, presets: listOf(subtractivePresets) },
  { id: 'fm', manifest: fmManifest as Manifest, presets: listOf(fmPresets) },
  { id: 'wavetable', manifest: wavetableManifest as Manifest, presets: listOf(wavetablePresets) },
  { id: 'karplus', manifest: karplusManifest as Manifest, presets: listOf(karplusPresets) },
  { id: 'westcoast', manifest: westcoastManifest as Manifest, presets: listOf(westcoastPresets) },
];

beforeAll(() => {
  for (const [id, make] of captured) {
    registerRenderer(id, make as Parameters<typeof registerRenderer>[1]);
  }
});

/** The bag a lane would hold on this preset: every param the engine DECLARES at
 *  its default, with the preset's own values over the top. Reading the manifest
 *  rather than hand-listing is the point — a param added tomorrow is covered. */
function bagFor(m: Manifest, preset: Preset): ParamBag {
  const bag: ParamBag = {};
  for (const c of m.components) for (const p of c.params) bag[p.id] = p.default;
  for (const [id, v] of Object.entries(preset.params)) {
    if (typeof v === 'number') bag[id] = v;
  }
  // Not declared by any engine, seeded by the host for every lane; fm and
  // karplus read it live, so a preset carrying it needs a slot to write into.
  bag['output.trim'] = typeof preset.params['output.trim'] === 'number'
    ? preset.params['output.trim'] : 1;
  return bag;
}

const note = (midi: number, durationSec: number, accent = false): NoteSpec => ({
  midi, beginSec: 0, durationSec, velocity: accent ? 1 : 0.9, accent, slide: false,
});

interface Run { peak: number; finite: boolean; tailPeak: number; endedBySec: number | null }

/** Twenty seconds, not eight. A westcoast pad on a lowpass-only LPG holds its
 *  level until its CONTOUR finishes rather than until its gate ends — the VCA
 *  is fixed at 1 in that mode — and four of them legitimately take 7.4 to 9.5
 *  seconds. At eight the test called them immortal, which is a different defect
 *  from the one it is looking for and would have hidden the real one behind
 *  four false alarms. */
const WINDOW_SEC = 20;

/** One held note, then silence. Returns the loudest sample overall, the loudest
 *  one in the last second (long after the note was released) and when the lane
 *  actually emptied. */
function hold(engineId: string, bag: ParamBag, seconds = WINDOW_SEC): Run {
  const vm = new VoiceManager(SR, engineId, bag);
  vm.spawn(note(45, 2));
  let peak = 0, tailPeak = 0, finite = true, endedBySec: number | null = null;
  for (let i = 0; i < SR * seconds; i++) {
    const t = i / SR;
    const s = vm.renderSample(t);
    if (!Number.isFinite(s)) { finite = false; break; }
    const a = Math.abs(s);
    if (a > peak) peak = a;
    if (t > seconds - 1 && a > tailPeak) tailPeak = a;
    if (endedBySec === null && t > 2 && vm.activeCount === 0) endedBySec = t;
  }
  return { peak, finite, tailPeak, endedBySec };
}

/** Set PRESET_LEVELS=1 to have the sweep print every peak it measured as JSON,
 *  for `tools/preset-levels.mjs` to summarise. The measurement stays here — one
 *  owner — and the reporting lives there. */
const REPORT = process.env.PRESET_LEVELS === '1';
const measured: Record<string, number> = {};
if (REPORT) {
  afterAll(() => { console.log(`PRESET_LEVELS_JSON ${JSON.stringify(measured)}`); });
}

describe('every shipped preset is stable', () => {
  for (const { id, manifest, presets } of ENGINES) {
    for (const preset of presets) {
      it(`${id} · ${preset.name}`, () => {
        const r = hold(id, bagFor(manifest, preset));
        if (REPORT) measured[`${id} · ${preset.name}`] = r.peak;
        // A non-finite sample is the worst case: it does not merely sound wrong,
        // it poisons every native node downstream of the worklet for the life of
        // the page.
        expect(r.finite).toBe(true);
        // Bounded. Absolute on purpose — this is a divergence detector, not a
        // loudness judgement — and the number is taken from the catalogue's own
        // measured distribution rather than picked: across all 229 presets the
        // median peak is 2.23, p75 is 3.11 and p95 is 4.83 (1.0 = full scale).
        // Eight is past p99, so anything above it is an outlier by the
        // catalogue's own standard and not merely a loud patch.
        //
        // That the median is 2.23 at all is a separate finding: these engines
        // run hot as a body, which is a mix decision for a person to make, not
        // something to quietly normalise here. `tools/preset-levels.mjs`
        // prints the distribution (`PRESET_LEVELS=1`).
        expect(r.peak).toBeLessThan(8);
        // And it ENDS. A voice that never reports done is a voice the lane keeps
        // rendering for ever; enough of them and every new note arrives on top
        // of a wall that never decays.
        expect(r.endedBySec).not.toBeNull();
        // Nothing left ringing at the end of the window.
        expect(r.tailPeak).toBeLessThan(r.peak * 0.01);
      });
    }
  }
});
