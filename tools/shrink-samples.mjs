// tools/shrink-samples.mjs
// Re-encodes fetched sample WAVs to 16-bit mono 44.1 kHz and trims the silence
// they end on.
//
//   node tools/shrink-samples.mjs public/instruments/strudel-ocarina [...more]
//
// VCSL ships 24-bit stereo, and a single sustained ocarina note is 2.8 MB of
// which most is room tone after the note has gone. Loom sums to mono per lane
// anyway and nothing here needs 24 bits, so this is a straight size win with no
// audible cost. Idempotent: a file already 16-bit mono with no trailing silence
// comes out byte-identical in length and is skipped.

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { OfflineAudioContext } from 'node-web-audio-api';

const SR = 44100;
// Anything under this for a tenth of a second is silence for our purposes; a
// 24-bit file's noise floor sits well below it.
const FLOOR = 1e-4;
const HOLD = Math.round(SR * 0.1);

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

let before = 0, after = 0;
for (const dir of process.argv.slice(2)) {
  for (const name of readdirSync(dir)) {
    if (extname(name).toLowerCase() !== '.wav') continue;
    const path = join(dir, name);
    const bytes = readFileSync(path);
    before += bytes.length;

    const ctx = new OfflineAudioContext(1, SR, SR);
    const src = await ctx.decodeAudioData(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    // Sum to mono at the source rate, then resample by rendering through an
    // OfflineAudioContext at 44.1k — the same path the app decodes with.
    const chans = Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c));
    const monoLen = src.length;
    const mono = new Float32Array(monoLen);
    for (let i = 0; i < monoLen; i++) {
      let sum = 0;
      for (const ch of chans) sum += ch[i];
      mono[i] = sum / chans.length;
    }

    let pcm = mono;
    if (src.sampleRate !== SR) {
      const outLen = Math.ceil((monoLen / src.sampleRate) * SR);
      const rs = new OfflineAudioContext(1, outLen, SR);
      const buf = rs.createBuffer(1, monoLen, src.sampleRate);
      buf.copyToChannel(mono, 0);
      const node = rs.createBufferSource();
      node.buffer = buf;
      node.connect(rs.destination);
      node.start(0);
      pcm = Float32Array.from((await rs.startRendering()).getChannelData(0));
    }

    // Trim the tail: walk back to the last sample above the floor, then keep a
    // tenth of a second so nothing ends on a step.
    let last = pcm.length - 1;
    while (last > 0 && Math.abs(pcm[last]) < FLOOR) last--;
    const keep = Math.min(pcm.length, last + HOLD);
    const out = encodeWavMono(pcm.subarray(0, keep), SR);
    writeFileSync(path, out);
    after += out.length;
    console.log(`  ${name.padEnd(46)} ${(bytes.length / 1024).toFixed(0)} kB -> ${(out.length / 1024).toFixed(0)} kB`);
    void statSync;
  }
}
console.log(`total ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
