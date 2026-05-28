// scripts/wav-diff.ts
// Compares every WAV under test/output/ to the same-named file under
// test/golden/. Prints a table of peak / RMS / spectral centroid deltas.
// Never exits non-zero — this is a human-inspection tool, not a CI gate.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const OUTPUT = resolve(process.cwd(), 'test', 'output');
const GOLDEN = resolve(process.cwd(), 'test', 'golden');

function readWavMono(path: string): { data: Float32Array; sr: number } {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`Not a WAV: ${path}`);
  const sr = buf.readUInt32LE(24);
  const bps = buf.readUInt16LE(34);
  if (bps !== 16) throw new Error(`Unsupported bits/sample ${bps} in ${path}`);
  const dataSize = buf.readUInt32LE(40);
  const samples = dataSize / 2;
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = buf.readInt16LE(44 + i * 2) / 32767;
  }
  return { data: out, sr };
}

function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
  return p;
}

function l2(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / n);
}

function main(): void {
  if (!existsSync(OUTPUT)) {
    console.log('test/output/ does not exist — run tests first.');
    return;
  }
  if (!existsSync(GOLDEN)) {
    console.log('test/golden/ does not exist — run `npm run test:wav-bless` to seed.');
    return;
  }
  const files = readdirSync(OUTPUT).filter(f => f.endsWith('.wav'));
  const rows: Array<{ name: string; status: string; dPeak: string; dRms: string; l2: string }> = [];
  for (const f of files) {
    const op = join(OUTPUT, f);
    const gp = join(GOLDEN, f);
    if (!existsSync(gp)) {
      rows.push({ name: f, status: 'NEW',     dPeak: '-', dRms: '-', l2: '-' });
      continue;
    }
    const a = readWavMono(op).data;
    const b = readWavMono(gp).data;
    const dPeak = (peak(a) - peak(b)).toFixed(4);
    const dRms  = (rms(a)  - rms(b)).toFixed(4);
    const l2v   = l2(a, b).toFixed(4);
    rows.push({ name: f, status: 'CMP', dPeak, dRms, l2: l2v });
  }
  rows.sort((x, y) => Math.abs(parseFloat(y.l2) || 0) - Math.abs(parseFloat(x.l2) || 0));
  const pad = (s: string, n: number) => s.padEnd(n, ' ');
  console.log(pad('FILE', 44) + pad('STATUS', 8) + pad('ΔPEAK', 10) + pad('ΔRMS', 10) + 'L2');
  for (const r of rows) {
    console.log(pad(r.name, 44) + pad(r.status, 8) + pad(r.dPeak, 10) + pad(r.dRms, 10) + r.l2);
  }
}

main();
