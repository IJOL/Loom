// test/wav.ts
// Minimal 16-bit PCM WAV writer for DSP test artifacts.
// Not a general-purpose audio library — only writes mono Float32Array.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const OUTPUT_DIR = resolve(process.cwd(), 'test', 'output');

export function wavPath(name: string): string {
  return join(OUTPUT_DIR, `${name}.wav`);
}

export function writeWav(buf: Float32Array, path: string, sampleRate: number): void {
  mkdirSync(dirname(path), { recursive: true });

  const numSamples = buf.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;
  const fileSize = 36 + dataSize;

  const out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(fileSize, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);            // fmt chunk size
  out.writeUInt16LE(1, 20);             // PCM format
  out.writeUInt16LE(1, 22);             // mono
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(16, 34);            // bits per sample
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clipped = Math.max(-1, Math.min(1, buf[i]));
    const s = Math.round(clipped * 32767);
    out.writeInt16LE(s, 44 + i * 2);
  }

  writeFileSync(path, out);
}
