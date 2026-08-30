// tools/engine-levels.mts — "how loud is each engine, really?", measured.
//
//   npx tsx tools/engine-levels.mts
//
// Renders every melodic engine through its real renderer — so the number already
// includes ENGINE_TRIM × CATEGORY_GAIN.synth — and prints RMS and peak over a
// whole note at three velocities, accent off and on. Run it, change the code,
// run it again: the RATIO between the two runs is what a re-trim has to bring
// back to 1 at full velocity.
//
// Predates the revived golden-WAV route: test/preset-render.dsp.test.ts now
// writes test/output/ again (three presets per engine through renderKernelLane),
// so npm run test:wav-diff has something to diff. This tool still earns its
// keep for LEVEL questions — it measures RMS ratios directly instead of asking
// a human to listen to WAV deltas.
import { note, makeRenderer, MELODIC_IDS, SR } from '../test/engine-fixtures';
import type { VoiceRenderer } from '../src/audio-dsp/types';

const WINDOW_SEC = 1.0;   // the fixture note is 0.4 s; this covers its whole tail

function measure(v: VoiceRenderer, n: number): { rms: number; peak: number } {
  let acc = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const s = v.renderSample(i / SR);
    acc += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(acc / n), peak };
}

const N = Math.floor(SR * WINDOW_SEC);
const VELOCITIES = [0.3, 0.8, 1];

console.log('engine           velocity accent      rms      peak');
for (const id of MELODIC_IDS) {
  for (const velocity of VELOCITIES) {
    for (const accent of [false, true]) {
      const m = measure(makeRenderer(id, note({ velocity, accent })), N);
      console.log(
        id.padEnd(16),
        String(velocity).padStart(8),
        (accent ? 'on' : 'off').padStart(6),
        m.rms.toFixed(6).padStart(9),
        m.peak.toFixed(6).padStart(9),
      );
    }
  }
}
