// tools/render-checksum.mts — "did the sound move?", answered exactly.
//
//   npx tsx tools/render-checksum.mts
//
// Renders every melodic engine at four velocities × accent on/off and prints an
// FNV-1a hash of the raw IEEE-754 bits of each render. Two runs either match to
// the bit or they do not, which is what a refactor claiming "numerically
// identical" has to prove. Capture a run, change the code, run again, diff.
//
// Predates the revived golden-WAV path: test/preset-render.dsp.test.ts now
// writes test/output/ again, so npm run test:wav-diff works. This tool still
// earns its keep as the FAST, exact check — a checksum answers "bit-identical?"
// in seconds without rendering WAVs or a human ear.
import { note, makeRenderer, MELODIC_IDS, SR } from '../test/engine-fixtures';
import type { VoiceRenderer } from '../src/audio-dsp/types';

const WINDOW_SEC = 0.2;

function checksum(v: VoiceRenderer, n: number): string {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < n; i++) {
    f[0] = v.renderSample(i / SR);
    let x = u[0];
    for (let b = 0; b < 4; b++) { h = (((h ^ (x & 0xff)) >>> 0) * 0x01000193) >>> 0; x >>>= 8; }
  }
  return h.toString(16).padStart(8, '0');
}

const N = Math.floor(SR * WINDOW_SEC);
// A non-1 output.trim on subtractive: it multiplies the velocity gain, so it is the
// case where re-associating that product could move a last bit.
const CASES: { id: string; over?: Record<string, number> }[] = [
  ...MELODIC_IDS.map((id) => ({ id })),
  { id: 'subtractive', over: { 'output.trim': 0.73 } },
];

for (const c of CASES) {
  const parts: string[] = [];
  for (const velocity of [0, 0.3, 0.8, 1]) {
    for (const accent of [false, true]) {
      const v = makeRenderer(c.id, note({ velocity, accent }), c.over ?? {});
      parts.push(`${velocity}${accent ? 'A' : '-'}:${checksum(v, N)}`);
    }
  }
  const label = c.over ? `${c.id}+trim` : c.id;
  console.log(label.padEnd(16), parts.join(' '));
}
