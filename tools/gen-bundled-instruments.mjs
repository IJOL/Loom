// tools/gen-bundled-instruments.mjs
// Generates the CC0 synthetic melodic sample WAVs that back the bundled Sampler
// instrument presets (public/instruments/sweep-pad/* and synth-bass/*). The audio
// is wholly synthesised here (no third-party samples), so it is public-domain /
// CC0 and self-contained — lightweight enough to ship in the repo for the e2e and
// browser smoke of front D. Run once with `node tools/gen-bundled-instruments.mjs`;
// the WAVs are committed afterwards, so this is a one-shot regeneration helper.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'instruments');
const SR = 22050; // half-rate keeps the bundled assets tiny; plenty for pad/bass

// midi → Hz (A4 = 69 = 440 Hz)
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Channel-major Float32 → 16-bit PCM mono WAV bytes (mirrors wav-encoder.ts). */
function encodeWavMono(samples, sampleRate) {
  const numFrames = samples.length;
  const blockAlign = 2;
  const dataSize = numFrames * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    const s = v < 0 ? v * 32768 : v * 32767;
    buf.writeInt16LE(Math.round(s), off);
    off += 2;
  }
  return buf;
}

/** Warm, evolving pad: a few detuned saw partials with a slow amplitude swell
 *  and a gentle tremolo, so it reads as a "sweep pad". */
function renderPad(rootMidi, durSec) {
  const n = Math.floor(durSec * SR);
  const out = new Float32Array(n);
  const f = hz(rootMidi);
  const detunes = [0, 0.04, -0.05, 0.012]; // cents-ish spread (Hz fraction)
  const partials = 7; // band-limited saw via summed harmonics
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // slow swell in, long release out
    const attack = Math.min(1, t / 0.6);
    const release = Math.min(1, (durSec - t) / 0.5);
    const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.9 * t);
    let s = 0;
    for (const d of detunes) {
      const ff = f * (1 + d);
      for (let h = 1; h <= partials; h++) {
        s += (1 / h) * Math.sin(2 * Math.PI * ff * h * t);
      }
    }
    s /= detunes.length * partials;
    out[i] = s * attack * release * trem * 0.7;
  }
  return out;
}

/** Punchy synth bass: a sine fundamental + a quickly-decaying FM-ish overtone,
 *  short amp decay. */
function renderBass(rootMidi, durSec) {
  const n = Math.floor(durSec * SR);
  const out = new Float32Array(n);
  const f = hz(rootMidi);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const amp = Math.exp(-t * 6) * Math.min(1, t / 0.005); // fast attack, decay
    const fmEnv = Math.exp(-t * 12);
    const mod = fmEnv * 3 * Math.sin(2 * Math.PI * f * 2 * t);
    const s = Math.sin(2 * Math.PI * f * t + mod) * 0.5 +
      0.25 * Math.sin(2 * Math.PI * f * t) * fmEnv;
    out[i] = s * amp * 0.9;
  }
  return out;
}

function write(rel, samples) {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWavMono(samples, SR));
  console.log(`wrote ${rel} (${samples.length} frames)`);
}

// Sweep Pad: 3 zones across the keyboard (low / mid / high root notes).
write('sweep-pad/low.wav', renderPad(36, 1.4));   // C2
write('sweep-pad/mid.wav', renderPad(60, 1.4));   // C4
write('sweep-pad/high.wav', renderPad(84, 1.2));  // C6

// Synth Bass: 2 zones (sub + mid bass).
write('synth-bass/low.wav', renderBass(24, 0.7)); // C1
write('synth-bass/mid.wav', renderBass(48, 0.6)); // C3

console.log('done');
