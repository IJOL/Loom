// tools/fetch-brokencut-samples.mjs
// ONE-SHOT. Downloads what "broken cut 1" plays and renders the break's slices.
//
// The break is `s("breaks165:1/2").fit().chop(4)`, which superdough turns into
// begin/end fractions of the buffer plus `unit:'c'`, where
//   playbackRate = speed * buffer.duration            (sampler.mjs:49)
//   offset       = begin * buffer.duration            (sampler.mjs:73)
// The extraction resolves every trigger to one of only EIGHT distinct
// (begin, end, speed) combinations — four chops by two speeds, the second from
// `sometimes(mul(speed 1.05))` — so each is rendered once, offline, exactly the
// way superdough would have played it.
//
//   node tools/fetch-brokencut-samples.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OfflineAudioContext } from 'node-web-audio-api';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '..', 'public');
const DIRT = 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/';
const SR = 44100;
const TARGET_PEAK = 0.89;

const fetchBytes = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

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

const decode = async (bytes) => {
  const ctx = new OfflineAudioContext(1, SR, SR);
  return ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

const normalise = (pcm) => {
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) { const g = TARGET_PEAK / peak; for (let i = 0; i < pcm.length; i++) pcm[i] *= g; }
  return pcm;
};

mkdirSync(join(PUB, 'drumkits', 'brokencut'), { recursive: true });

// ── The one-shots: the kick, and the two freesound sounds the patch names.
// `slap` is declared in the patch and never triggered, so it is not fetched.
const ONESHOTS = [
  ['kick', 36, DIRT + 'bd/BT0A0A7.wav'],
  ['whirl', 37, 'https://cdn.freesound.org/previews/495/495313_10350281-lq.mp3'],
  ['attack', 38, 'https://cdn.freesound.org/previews/494/494947_10350281-lq.mp3'],
];
const samples = [];
for (const [voice, note, url] of ONESHOTS) {
  const buf = await decode(await fetchBytes(url));
  const pcm = normalise(Float32Array.from(buf.getChannelData(0)));
  const file = `brokencut/${voice}.wav`;
  writeFileSync(join(PUB, 'drumkits', file), encodeWavMono(pcm, SR));
  samples.push({ voice, note, file });
  console.log(`  ${file}  ${(pcm.length / SR).toFixed(2)}s`);
}

// ── The break, cut the way superdough would cut it.
const haps = JSON.parse(await readFile(join(HERE, 'data', 'broken-cut-haps.json'), 'utf8'));
const slices = [...new Map(haps.events
  .filter((e) => e.value.s === 'breaks165')
  .map((e) => [`${e.value.begin}|${e.value.end}|${e.value.speed}`, e.value])).values()]
  .sort((a, b) => a.speed - b.speed || a.begin - b.begin);

const breakBuf = await decode(await fetchBytes(DIRT + 'breaks165/000_RAWCLN.WAV'));
console.log(`\nbreaks165: ${breakBuf.duration.toFixed(3)}s, ${slices.length} distinct slices`);

// Pads start above the three one-shots. 60+ keeps them clear of the GM drum
// range so the grid labels them by note rather than mislabelling them as toms.
let note = 60;
for (const v of slices) {
  const rate = v.speed * breakBuf.duration;     // unit:'c'
  const startFrame = Math.floor(v.begin * breakBuf.length);
  const endFrame = Math.ceil(v.end * breakBuf.length);
  const outFrames = Math.max(1, Math.ceil((endFrame - startFrame) / rate));

  const ctx = new OfflineAudioContext(1, outFrames, SR);
  const src = ctx.createBufferSource();
  src.buffer = breakBuf;
  src.playbackRate.value = rate;
  src.connect(ctx.destination);
  src.start(0, startFrame / SR, (endFrame - startFrame) / SR);
  const pcm = normalise(Float32Array.from((await ctx.startRendering()).getChannelData(0)));

  const voice = `brk${String(v.begin).replace('0.', '')}_${String(v.speed).replace('.', '')}`;
  const file = `brokencut/${voice}.wav`;
  writeFileSync(join(PUB, 'drumkits', file), encodeWavMono(pcm, SR));
  samples.push({ voice, note, file, begin: v.begin, speed: v.speed });
  console.log(`  ${file}  begin ${v.begin} end ${v.end} speed ${v.speed} -> rate ${rate.toFixed(3)}, ${(pcm.length / SR).toFixed(3)}s  note ${note}`);
  note++;
}

writeFileSync(
  join(PUB, 'drumkits', 'brokencut.json'),
  JSON.stringify({ id: 'brokencut', name: 'Broken Cut', samples }, null, 2) + '\n',
);

const idxPath = join(PUB, 'drumkits', 'index.json');
const idx = JSON.parse(await readFile(idxPath, 'utf8'));
if (!idx.some((k) => k.id === 'brokencut')) idx.push({ id: 'brokencut', name: 'Broken Cut' });
writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');

const presPath = join(PUB, 'presets', 'drum-kits.json');
const pres = JSON.parse(await readFile(presPath, 'utf8'));
if (!pres.presets.some((p) => p.drumkitId === 'brokencut')) {
  pres.presets.push({ name: 'Broken Cut', group: 'Samples', kind: 'sample', drumkitId: 'brokencut' });
}
writeFileSync(presPath, JSON.stringify(pres, null, 2) + '\n');

console.log(`\nregistered kit 'brokencut' with ${samples.length} pads`);
