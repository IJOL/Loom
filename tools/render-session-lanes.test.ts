// tools/render-session-lanes.test.ts
// SESSION-LANE renderer — not part of the regular suite (gated on REPRO=1).
//
// The audition tool (render-preset-auditions) answers "does this FACTORY
// preset render clean". This one answers "does MY lane" — it takes a saved
// session, and for each melodic lane renders that lane's EXACT saved params
// with its own busiest clip at several polyphony caps, raw and through the
// live master tail. That is the reproduction shape for "sounds fine at minimum
// polyphony and turns to noise the moment Voices rises" (2026-09-05, westcoast
// — it named the raw voice sum, which became POLY_VOICE_HEADROOM): if the
// offline kernel reproduces the noise it is DSP (voice pileup, summing); if it
// does not, it is worklet-only (CPU, scheduling).
//
// Run:
//   REPRO=1 REPRO_SAVE=/path/to/session.json NO_COLOR=1 npx vitest run tools/render-session-lanes.test.ts
// Optional:
//   REPRO_ENGINES=westcoast,fm   only lanes on these engines (default: every melodic engine)
//   REPRO_VOICES=1,8,39          the polyphony caps to render at (default shown)
// Output: test/output/session-lanes/ — one WAV per lane × cap × {raw, mastered},
// plus index.html (the audition listening page) and auditions.json.
import { describe, it, afterAll } from 'vitest';

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

import { renderKernelLane } from '../src/export/kernel-lane-render';
import { makeMasterSoftClipCurve } from '../src/app/audio-graph';
import { CATEGORY_GAIN } from '../src/audio-dsp/gain-staging';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';
import { writeWav } from '../test/wav';
import { auditionPageHtml, type AuditionEntry } from './preset-audition-page';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RUN = process.env.REPRO === '1';
const SAVE = process.env.REPRO_SAVE;
const WANTED = process.env.REPRO_ENGINES?.split(',').map((s) => s.trim()).filter(Boolean);
const VOICES = (process.env.REPRO_VOICES ?? '1,8,39').split(',').map(Number);

const SR = 44100;
const OUT_DIR = resolve(process.cwd(), 'test', 'output', 'session-lanes');
/** A lane renders its clip plus a second of tail, capped so a long pad clip
 *  does not turn one run into minutes. */
const MAX_SEC = 12;
const TICKS_PER_STEP = 24;

interface Manifest {
  components: {
    params: { id: string; default: number }[];
    capabilities?: { outputTrim?: number };
  }[];
}
const MANIFESTS: Record<string, Manifest> = {
  tb303: tb303Manifest as Manifest,
  subtractive: subtractiveManifest as Manifest,
  fm: fmManifest as Manifest,
  wavetable: wavetableManifest as Manifest,
  karplus: karplusManifest as Manifest,
  westcoast: westcoastManifest as Manifest,
};

interface SavedNote { start: number; duration: number; midi: number; velocity: number }
interface SavedClip { id: string; notes?: SavedNote[] }
interface SavedLane {
  id: string; engineId: string;
  engineState?: { params?: Record<string, number> };
  clips: (SavedClip | null)[];
}
interface SavedSession { bpm?: number; sessionState: { lanes: SavedLane[] } }

function noteSpecs(notes: SavedNote[], bpm: number): NoteSpec[] {
  const tickSec = (60 / bpm / 4) / TICKS_PER_STEP;
  return notes.map((n) => ({
    midi: n.midi,
    beginSec: n.start * tickSec,
    durationSec: n.duration * tickSec,
    velocity: n.velocity / 127,
    accent: n.velocity >= 100,
    slide: false,
  }));
}

/** The saved lane's engine params over the manifest defaults — bus.* excluded,
 *  they are the desk. Mirrors what the live host holds for the lane. */
function bagFrom(m: Manifest, saved: Record<string, number>): ParamBag {
  const bag: ParamBag = {};
  for (const c of m.components) for (const p of c.params) bag[p.id] = p.default;
  for (const [id, v] of Object.entries(saved)) {
    if (typeof v === 'number' && !id.startsWith('bus.')) bag[id] = v;
  }
  if (typeof bag['output.trim'] !== 'number') bag['output.trim'] = 1;
  return bag;
}

/** Replay a kernel render through the LIVE master tail — air shelf → limiter
 *  (threshold −2 dB, ratio 20, the audio-graph numbers) → the real soft-clip
 *  curve. Strip EQ / inserts / sends are left out: they are per lane and the
 *  question here is the voice sum, not the desk. */
async function throughMaster(buf: Float32Array, sr: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, buf.length, sr);
  const ab = ctx.createBuffer(1, buf.length, sr);
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
  return new Float32Array(rendered.getChannelData(0));   // BORROWED — copy
}

function measure(buf: Float32Array): Omit<AuditionEntry, 'engine' | 'name' | 'file' | 'variant'> {
  let peak = 0, sum = 0, diffSum = 0, clipped = 0, tailSum = 0;
  const tailFrames = Math.ceil(0.4 * SR);
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const a = Math.abs(x);
    if (a > peak) peak = a;
    if (a > 1) clipped++;
    sum += x * x;
    if (i > 0) { const d = x - buf[i - 1]; diffSum += d * d; }
    if (i >= buf.length - tailFrames) tailSum += x * x;
  }
  const rms = Math.sqrt(sum / buf.length);
  return {
    peak, rms, clipped,
    hf: sum > 0 ? diffSum / sum : 0,
    tailRatio: rms > 0 ? Math.sqrt(tailSum / tailFrames) / rms : 0,
  };
}

const entries: AuditionEntry[] = [];

if (RUN) {
  if (!SAVE) throw new Error('REPRO_SAVE must point at a saved Loom session (.json)');
  const save = JSON.parse(readFileSync(SAVE, 'utf8')) as SavedSession;
  const bpm = save.bpm ?? 120;
  const lanes = save.sessionState.lanes.filter((l) =>
    l.engineId in MANIFESTS && (WANTED === undefined || WANTED.includes(l.engineId)));

  describe(`session lanes from ${SAVE}`, () => {
    for (const lane of lanes) {
      // The busiest clip is the stress case the user actually plays.
      const clips = lane.clips.filter((c): c is SavedClip =>
        !!c && Array.isArray(c.notes) && c.notes.length > 0);
      if (clips.length === 0) continue;
      const busiest = clips.reduce((a, b) => (b.notes!.length > a.notes!.length ? b : a));
      const notes = noteSpecs(busiest.notes!, bpm);
      const endSec = Math.max(...notes.map((n) => n.beginSec + n.durationSec));
      const frames = Math.ceil(Math.min(endSec + 1.0, MAX_SEC) * SR);
      const manifest = MANIFESTS[lane.engineId];
      // Live parity: the host multiplies a plugin engine's voices by its
      // manifest outputTrim AND the synth category gain (capabilities.pluginSynthTrim).
      const outputTrim = (manifest.components[0]?.capabilities?.outputTrim ?? 1) * CATEGORY_GAIN.synth;

      it(`${lane.id} (${lane.engineId}) · ${busiest.id} (${notes.length} notes)`, async () => {
        for (const voices of VOICES) {
          const buf = renderKernelLane({
            engineId: lane.engineId,
            params: bagFrom(manifest, lane.engineState?.params ?? {}),
            maxVoices: voices,
            mods: [],
            outputTrim,
            notes: notes.map((n) => ({ note: n })),
          }, frames, SR);
          for (let s = 0; s < buf.length; s++) {
            if (!Number.isFinite(buf[s])) throw new Error(`non-finite sample at ${s} (v${voices})`);
          }
          const mastered = await throughMaster(buf, SR);
          for (const [variant, data] of [[`v${voices}`, buf], [`v${voices}▸mst`, mastered]] as const) {
            const file = `${lane.id}__${variant.replace('▸', '-')}.wav`;
            writeWav(data, join(OUT_DIR, file), SR);
            entries.push({ engine: lane.engineId, name: `${lane.id} · ${busiest.id}`, variant, file, ...measure(data) });
          }
        }
      });
    }

    afterAll(() => {
      if (entries.length === 0) return;
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, 'auditions.json'), JSON.stringify(entries, null, 2));
      writeFileSync(join(OUT_DIR, 'index.html'), auditionPageHtml(entries));
    });
  });
} else {
  describe.skip('session lanes (REPRO not set)', () => {});
}
