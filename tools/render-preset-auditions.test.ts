// tools/render-preset-auditions.test.ts
// AUDITION renderer — not part of the regular suite (gated on AUDITION=1).
//
// Renders EVERY preset of the engines named in AUDITION_ENGINES (default
// fm,westcoast) through the same kernel path the golden-WAV loop uses
// (`renderKernelLane`), 4 s each — three plain notes (root, fifth, octave) —
// and writes test/output/auditions/: one WAV per preset plus an index.html
// listening page with per-render metrics and a rating UI whose JSON export
// feeds the noise/tuning triage.
//
// Run: AUDITION=1 NO_COLOR=1 npx vitest run tools/render-preset-auditions.test.ts
import { describe, it, expect, afterAll } from 'vitest';

import '../test/plugin-dsp';
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
import { makeMasterSoftClipCurve } from '../src/app/audio-graph';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';
import { writeWav } from '../test/wav';
import { auditionPageHtml, type AuditionEntry } from './preset-audition-page';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RUN = process.env.AUDITION === '1';
const WANTED = (process.env.AUDITION_ENGINES ?? 'fm,westcoast').split(',').map(s => s.trim());

const SR = 44100;
const OUT_DIR = resolve(process.cwd(), 'test', 'output', 'auditions');

interface Preset { name: string; params: Record<string, number> }
interface Manifest {
  components: {
    params: { id: string; default: number }[];
    capabilities?: { outputTrim?: number };
  }[];
}

const listOf = (file: unknown): Preset[] => (file as { presets: Preset[] }).presets;

const ALL: { id: string; manifest: Manifest; presets: Preset[] }[] = [
  { id: 'tb303', manifest: tb303Manifest as Manifest, presets: listOf(tb303Presets) },
  { id: 'subtractive', manifest: subtractiveManifest as Manifest, presets: listOf(subtractivePresets) },
  { id: 'fm', manifest: fmManifest as Manifest, presets: listOf(fmPresets) },
  { id: 'wavetable', manifest: wavetableManifest as Manifest, presets: listOf(wavetablePresets) },
  { id: 'karplus', manifest: karplusManifest as Manifest, presets: listOf(karplusPresets) },
  { id: 'westcoast', manifest: westcoastManifest as Manifest, presets: listOf(westcoastPresets) },
];
const ENGINES = ALL.filter(e => WANTED.includes(e.id));

// Same construction as the golden loop's bagFor: every declared param at its
// default, the preset on top, output.trim seeded the way the host does.
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

const note = (beginSec: number, durationSec: number, midi: number, velocity = 0.9, accent = false): NoteSpec =>
  ({ midi, beginSec, durationSec, velocity, accent, slide: false });

// Four ways to press the same preset. `std` is the benign floor: single mid
// notes, soft velocity, no accent. The other three are the conditions the app
// actually plays presets under — accented notes (any clip velocity >= 100),
// several voices summing, and a long low note — because a preset that renders
// clean under `std` and ugly under one of these has named its trigger.
const VARIANTS: { key: string; notes: NoteSpec[] }[] = [
  { key: 'std', notes: [note(0, 1.0, 48), note(1.1, 1.0, 55), note(2.2, 1.3, 60)] },
  { key: 'accent', notes: [note(0, 1.0, 48, 1, true), note(1.1, 1.0, 55, 1, true), note(2.2, 1.3, 60, 1, true)] },
  { key: 'chord', notes: [note(0, 3.2, 48), note(0, 3.2, 52), note(0, 3.2, 55), note(0, 3.2, 60)] },
  { key: 'low', notes: [note(0, 3.4, 36)] },
];
const FRAMES = Math.ceil(4.0 * SR);
const TAIL_FRAMES = Math.ceil(0.4 * SR);

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** The numbers that flag a calculation running away: hard clipping, a
 *  noise-like spectrum (hf → 2 for white noise, ~0 for a low sine), and a tail
 *  that refuses to decay after the last release. */
function measure(buf: Float32Array): Omit<AuditionEntry, 'engine' | 'name' | 'file' | 'variant'> {
  let peak = 0, sum = 0, diffSum = 0, clipped = 0, tailSum = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const a = Math.abs(x);
    if (a > peak) peak = a;
    if (a > 1) clipped++;
    sum += x * x;
    if (i > 0) { const d = x - buf[i - 1]; diffSum += d * d; }
    if (i >= buf.length - TAIL_FRAMES) tailSum += x * x;
  }
  const rms = Math.sqrt(sum / buf.length);
  const tailRms = Math.sqrt(tailSum / TAIL_FRAMES);
  return {
    peak, rms, clipped,
    hf: sum > 0 ? diffSum / sum : 0,
    tailRatio: rms > 0 ? tailRms / rms : 0,
  };
}

const entries: AuditionEntry[] = [];

/** Replay a kernel render through the LIVE master tail — air shelf → limiter
 *  (threshold −2 dB, ratio 20, the audio-graph numbers) → the real soft-clip
 *  curve. This is what the app does to a lane and the raw WAVs skip; a preset
 *  that renders clean raw and ugly here is being mangled by the master, not by
 *  its own DSP. Strip EQ / inserts / sends are left out: a fresh lane has none. */
async function throughMaster(buf: Float32Array, sr: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, buf.length, sr);
  const ab = ctx.createBuffer(1, buf.length, sr);
  // Fresh copies at the two DOM boundaries: lib.dom's copyToChannel/curve want
  // Float32Array<ArrayBuffer>, and a bare Float32Array types as ArrayBufferLike.
  ab.copyToChannel(new Float32Array(buf), 0);
  const src = ctx.createBufferSource();
  src.buffer = ab;
  const air = ctx.createBiquadFilter();
  air.type = 'highshelf'; air.frequency.value = 10000; air.gain.value = -3;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -2; comp.ratio.value = 20;
  comp.attack.value = 0.002; comp.release.value = 0.1; comp.knee.value = 0;
  const clip = ctx.createWaveShaper();
  clip.curve = new Float32Array(makeMasterSoftClipCurve());
  clip.oversample = '4x';
  src.connect(air).connect(comp).connect(clip).connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  // BORROWED buffer (see test/setup.ts) — copy before the context is collected.
  return rendered.getChannelData(0).slice();
}

describe.runIf(RUN)('preset audition renderer', () => {
  for (const { id, manifest, presets } of ENGINES) {
    // The app's applyPreset writes ONLY the params a preset names — walking the
    // dropdown top to bottom accumulates every unnamed leftover. This bag
    // replays that walk: it starts at spec defaults and takes each preset's
    // named params in dropdown order, so by preset i it holds exactly the state
    // a live lane is in when the user reaches it. The 'browse' variant renders
    // from it; A/B against 'std' (clean bag) is the leak, audible.
    const browseBag: ParamBag = {};
    for (const c of manifest.components) for (const p of c.params) browseBag[p.id] = p.default;
    browseBag['output.trim'] = 1;

    for (const [i, preset] of presets.entries()) {
      it(`${id} · ${preset.name}`, async () => {
        const rendered = new Map<string, Float32Array>();
        for (const variant of VARIANTS) {
          const spec: KernelLaneSpec = {
            engineId: id,
            params: bagFor(manifest, preset),
            maxVoices: 8,
            mods: [],
            // Live parity: the host reads the manifest's outputTrim capability
            // and hands it to the worklet — without it these renders run 2-5.6x
            // hotter than the app and every metric lies.
            outputTrim: manifest.components[0]?.capabilities?.outputTrim ?? 1,
            notes: variant.notes.map(n => ({ note: n })),
          };
          const buf = renderKernelLane(spec, FRAMES, SR);
          for (let s = 0; s < buf.length; s++) {
            if (!Number.isFinite(buf[s])) throw new Error(`non-finite sample at ${s} (${variant.key})`);
          }
          rendered.set(variant.key, buf);
        }
        // The app never plays the raw lane: A/B the two most telling pressings
        // against the same audio squeezed by the live master tail.
        rendered.set('std▸mst', await throughMaster(rendered.get('std')!, SR));
        rendered.set('chord▸mst', await throughMaster(rendered.get('chord')!, SR));

        // Dropdown-walk contamination: apply THIS preset the way the live app
        // does (named params only) onto the residue of every preset before it.
        for (const [pid, v] of Object.entries(preset.params)) {
          if (typeof v === 'number') browseBag[pid] = v;
        }
        browseBag['output.trim'] = typeof preset.params['output.trim'] === 'number'
          ? preset.params['output.trim'] : 1;
        rendered.set('browse', renderKernelLane({
          engineId: id,
          params: { ...browseBag },
          maxVoices: 8,
          mods: [],
          outputTrim: manifest.components[0]?.capabilities?.outputTrim ?? 1,
          notes: VARIANTS[0].notes.map(n => ({ note: n })),
        }, FRAMES, SR));

        const ORDER = ['std', 'browse', 'std▸mst', 'accent', 'chord', 'chord▸mst', 'low'];
        for (const key of ORDER) {
          const buf = rendered.get(key)!;
          const fileKey = key.replace('▸', '-');
          const file = `${id}__${String(i + 1).padStart(2, '0')}-${slug(preset.name)}__${fileKey}.wav`;
          writeWav(buf, join(OUT_DIR, file), SR);
          const m = measure(buf);
          entries.push({ engine: id, name: preset.name, variant: key, file, ...m });
          expect(m.rms).toBeGreaterThan(0);
        }
      });
    }
  }

  afterAll(() => {
    if (entries.length === 0) return;
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'auditions.json'), JSON.stringify(entries, null, 2));
    writeFileSync(join(OUT_DIR, 'index.html'), auditionPageHtml(entries));
  });
});
