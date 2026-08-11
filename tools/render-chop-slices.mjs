// tools/render-chop-slices.mjs
// ONE-SHOT. Renders the 128 slices "Chop" plays into a kit.
//
//   node tools/render-chop-slices.mjs
//
// `s("p").loopAt(32).chop(128)` does not repitch a sample — it plays a
// DIFFERENT eighth-of-a-second of it every step, and `jux(rev)` plays the same
// 128 slices backwards in the other ear. There is no note anywhere in the tune;
// which slice sounds is entirely in `begin`/`end`.
//
// So the slices are rendered out rather than described: each one already at the
// playback rate superdough computes (`unit:'c'` → rate = speed x duration =
// 0.015625 x 16.941 s = 0.2647), which makes every slice exactly 0.5 s — the
// tune's own step. Pads run 0..127 because the slice INDEX is the address; a
// kit is note-addressed and 128 notes is exactly the range.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OfflineAudioContext } from 'node-web-audio-api';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '..', 'public', 'drumkits');
const ID = 'strudel-chop';
const URL = 'https://cdn.freesound.org/previews/648/648433_11943129-lq.mp3';
const SLICES = 128;
const SPEED = 0.015625;   // what the extraction carries, with unit 'c'
const SR = 44100;

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

mkdirSync(join(PUB, ID), { recursive: true });
const srcPath = join(PUB, ID, 'source.mp3');
if (!existsSync(srcPath)) {
  writeFileSync(srcPath, Buffer.from(await fetch(URL).then((r) => r.arrayBuffer())));
}
const bytes = readFileSync(srcPath);
const decodeCtx = new OfflineAudioContext(1, SR, SR);
const src = await decodeCtx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

const rate = SPEED * src.duration;
const sliceSec = src.duration / SLICES;
const playedSec = sliceSec / rate;
console.log(`${src.duration.toFixed(3)}s -> rate ${rate.toFixed(4)}, ${SLICES} slices of ${playedSec.toFixed(3)}s each`);

// Mono at the source rate first, so the render only has to resample.
const chans = Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c));
const mono = new Float32Array(src.length);
for (let i = 0; i < src.length; i++) {
  let sum = 0;
  for (const ch of chans) sum += ch[i];
  mono[i] = sum / chans.length;
}

const samples = [];
const frames = Math.ceil(playedSec * SR);
// A 3 ms ramp at each end. The cuts are arbitrary points in a continuous
// recording, so without them every one of the 128 slices starts and ends on a
// click.
const RAMP = Math.round(SR * 0.003);
for (let i = 0; i < SLICES; i++) {
  const ctx = new OfflineAudioContext(1, frames, SR);
  const buf = ctx.createBuffer(1, src.length, src.sampleRate);
  buf.copyToChannel(mono, 0);
  const node = ctx.createBufferSource();
  node.buffer = buf;
  node.playbackRate.value = rate;
  node.connect(ctx.destination);
  node.start(0, i * sliceSec, sliceSec);
  const pcm = Float32Array.from((await ctx.startRendering()).getChannelData(0));
  for (let k = 0; k < RAMP && k < pcm.length; k++) {
    pcm[k] *= k / RAMP;
    pcm[pcm.length - 1 - k] *= k / RAMP;
  }
  const file = `${ID}/${i}.wav`;
  writeFileSync(join(PUB, file), encodeWavMono(pcm, SR));
  samples.push({ voice: `slice${i}`, note: i, file });
}
writeFileSync(join(PUB, `${ID}.json`), JSON.stringify({ id: ID, name: 'Chop Slices', samples }, null, 2) + '\n');
console.log(`kit ${ID}: ${samples.length} pads`);
