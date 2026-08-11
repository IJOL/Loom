// tools/render-soundfont-instruments.mjs
// ONE-SHOT. Renders the exact notes the coastline patch plays from the same
// webaudiofont presets Strudel loads, into bundled Sampler instruments.
//
// A webaudiofont preset is a JS file declaring `_tone_<name> = { zones: [...] }`
// where each zone's `file` is base64 MP3. We decode with node-web-audio-api
// (already a dev dependency), repitch each zone to the notes we need, and write
// one WAV per note — 12 files, not a whole soundfont.
//
// Preset ids are the ones Strudel itself resolves: `gm_epiano1:1` is index 1 of
// its gm.mjs list, and a bare `gm_acoustic_bass` is index 0.
//
//   node tools/render-soundfont-instruments.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OfflineAudioContext } from 'node-web-audio-api';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '..', 'public', 'instruments');
const CDN = 'https://felixroos.github.io/webaudiofontdata/sound';
const SR = 44100;
// Every zone is normalised to this peak. Two bass zones rendered at exactly
// 1.000 — i.e. clipped — before this existed.
const TARGET_PEAK = 0.89;
// Seconds of tail added past the longest note, so a held note never ends on a
// hard cut.
const TAIL = 0.4;

// Each instrument names the extraction it takes its note list from, so the
// render can never drift from what the demo actually plays.
const INSTRUMENTS = [
  { id: 'gm-acoustic-bass', name: 'GM Acoustic Bass', preset: '0320_JCLive_sf2_file', tune: 'coastline', source: 'gm_acoustic_bass' },
  { id: 'gm-epiano1', name: 'GM Electric Piano', preset: '0040_FluidR3_GM_sf2_file', tune: 'coastline', source: 'gm_epiano1' },
  // Blippy Rhodes' own samples were hosted on loophole-letters, which is gone —
  // every URL there 404s now. FluidR3's electric piano 1 IS a Rhodes, and it is
  // the closest thing that still exists; this is the one substitution in the
  // whole port, and it is forced.
  { id: 'strudel-rhodes', name: 'Rhodes', preset: '0040_FluidR3_GM_sf2_file', tune: 'blippy-rhodes', source: 'rhodes' },
];

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

async function loadPreset(name) {
  const src = await fetch(`${CDN}/${name}.js`).then((r) => r.text());
  // The file is `var _tone_X={...};` plus a console.log. Evaluate it in a
  // throwaway scope and pick the object back out.
  const fn = new Function('console', `${src}; return _tone_${name};`);
  return fn({ log() {} });
}

const base64ToBuffer = (b64) =>
  Buffer.from(b64.replace(/^data:audio\/[a-z0-9-]+;base64,/, ''), 'base64');

/** The zone whose key range covers `midi`, else the nearest by originalPitch. */
function pickZone(zones, midi) {
  const covering = zones.filter((z) => midi >= (z.keyRangeLow ?? 0) && midi <= (z.keyRangeHigh ?? 127));
  const pool = covering.length ? covering : zones;
  return pool.reduce((best, z) =>
    Math.abs((z.originalPitch ?? 6000) / 100 - midi) < Math.abs((best.originalPitch ?? 6000) / 100 - midi) ? z : best);
}

function encodeWavMono(samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

// The note lists come from the extraction so the two can never drift apart.
const hapsCache = {};
const hapsOf = async (tune) =>
  (hapsCache[tune] ??= JSON.parse(await readFile(join(HERE, 'data', `${tune}-haps.json`), 'utf8')));
const eventsFor = (haps, source) =>
  haps.events.filter((e) => e.value.s === source && e.value.note !== undefined);
const notesFor = (haps, source) =>
  [...new Set(eventsFor(haps, source).map((e) => Math.round(e.value.note)))].sort((a, b) => a - b);
/** How long the instrument's LONGEST note is, in seconds, at cps .75. A zone
 *  shorter than that would cut a held note short — which is exactly what the
 *  first render did to the bass. */
const longestNoteSec = (haps, source) =>
  Math.max(...eventsFor(haps, source).map((e) => e.end - e.begin)) / haps.cps + TAIL;

for (const inst of INSTRUMENTS) {
  const preset = await loadPreset(inst.preset);
  mkdirSync(join(PUB, inst.id), { recursive: true });
  const haps = await hapsOf(inst.tune);
  const seconds = longestNoteSec(haps, inst.source);
  const frames = Math.ceil(seconds * SR);
  const zones = [];
  for (const midi of notesFor(haps, inst.source)) {
    const z = pickZone(preset.zones, midi);
    const decodeCtx = new OfflineAudioContext(1, SR, SR);
    const bytes = base64ToBuffer(z.file);
    const src = await decodeCtx.decodeAudioData(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    // Repitch from the zone's own root to the note we want.
    const rate = hz(midi) / hz((z.originalPitch ?? midi * 100) / 100);

    const ctx = new OfflineAudioContext(1, frames, SR);
    const node = ctx.createBufferSource();
    node.buffer = src;
    node.playbackRate.value = rate;
    // These are soundfont samples: a short attack plus a tiny sustain LOOP the
    // player repeats for as long as the note is held. The bass zones are 4 KB —
    // rendering them without the loop gave 0.2 s of attack and nothing else.
    const loopStartSec = (z.loopStart ?? 0) / (z.sampleRate ?? SR);
    const loopEndSec = (z.loopEnd ?? 0) / (z.sampleRate ?? SR);
    const looped = loopEndSec > loopStartSec;
    if (looped) { node.loop = true; node.loopStart = loopStartSec; node.loopEnd = loopEndSec; }
    node.connect(ctx.destination);
    node.start(0);
    const rendered = await ctx.startRendering();

    const pcm = Float32Array.from(rendered.getChannelData(0));
    // Decay only the ARTIFICIAL part. Everything up to loopEnd is the sample's
    // own sound and is left alone; past it we are repeating 14 ms of sustain
    // forever, which without a fade reads as a held synth tone rather than a
    // plucked string.
    if (looped) {
      const from = Math.min(pcm.length, Math.ceil((loopEndSec / rate) * SR));
      const span = Math.max(1, pcm.length - from);
      for (let i = from; i < pcm.length; i++) pcm[i] *= Math.exp(-6 * ((i - from) / span));
    }
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    if (peak > 0) { const g = TARGET_PEAK / peak; for (let i = 0; i < pcm.length; i++) pcm[i] *= g; }

    const file = `${inst.id}/${midi}.wav`;
    writeFileSync(join(PUB, file), encodeWavMono(pcm, SR));
    zones.push({ file, rootNote: midi, loNote: midi, hiNote: midi });
    console.log(`  ${file}  ${seconds.toFixed(2)}s  rate ${rate.toFixed(3)}  ${looped ? 'looped' : 'one-shot'}`);
  }
  writeFileSync(
    join(PUB, `${inst.id}.json`),
    JSON.stringify({ id: inst.id, name: inst.name, family: 'melodic', zones }, null, 2) + '\n',
  );
}

const idxPath = join(PUB, 'index.json');
const idx = JSON.parse(await readFile(idxPath, 'utf8'));
for (const inst of INSTRUMENTS) {
  if (!idx.some((e) => e.id === inst.id)) idx.push({ id: inst.id, name: inst.name, family: 'melodic' });
}
writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');
console.log('done.');
