// tools/param-read-bench.ts
// How long the REAL kernel takes to render, with a knob in flight.
//
// This is the number the params-by-index work has to improve. It is deliberately
// NOT tools/param-access-bench.mjs: that one times bare property reads and
// exists only to hold the refuted "pre-shape the bag" hypothesis. This one runs
// the shipping renderers through the shipping registry.
//
// A param MUST be moving while it measures. With a still bag the compiler can
// hoist every read out of the loop and you end up timing their absence — which
// is exactly what produced the impossible "39x" (0.08 ns per read, less than one
// clock cycle) that got thrown away. So each sample writes one param first.

import { createRenderer } from '../src/audio-dsp/renderer-registry';
import { referenceFor, defaultParams, NOTE, SR } from './gen-engine-reference';
import type { ParamBag, VoiceRenderer } from '../src/audio-dsp/types';

const SECONDS = 10;
const VOICES = 8;
const RUNS = 5;

/** The continuous param each engine will have "in flight" during the run. Every
 *  engine declares one, and it is the one a hand actually holds. */
const MOVING: Record<string, string> = {
  tb303:       'filter.cutoff',
  subtractive: 'filter.cutoff',
  fm:          'amp.mix',
  wavetable:   'filter.cutoff',
  westcoast:   'lpg.cutoff',
  karplus:     'string.damping',
};

function once(engineId: string, params: ParamBag): number {
  // ONE shared bag, handed to every voice — the same object the ParamSmoother
  // mutates in place in production.
  const live: ParamBag = { ...params };
  const voices: VoiceRenderer[] = [];
  for (let v = 0; v < VOICES; v++) {
    const r = createRenderer(engineId, NOTE, params, SR);
    r.setLiveParams?.(live);
    voices.push(r);
  }

  const moving = MOVING[engineId];
  const base = live[moving] ?? 0.5;
  const n = SR * SECONDS;

  const t0 = process.hrtime.bigint();
  let sink = 0;
  for (let i = 0; i < n; i++) {
    // The knob under a hand: one param changes every sample, so no read of it
    // can be hoisted out of the loop.
    live[moving] = base * (1 + 0.001 * (i & 255));
    const t = i / SR;
    for (let v = 0; v < VOICES; v++) sink += voices[v].renderSample(t);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!Number.isFinite(sink)) throw new Error(`${engineId} rendered a non-finite sum`);
  return ms;
}

function median(xs: number[]): number {
  return [...xs].sort((a, b) => a - b)[xs.length >> 1];
}

const engineId = process.argv[2];
if (!engineId) {
  console.error('usage: npx tsx tools/param-read-bench.ts <engineId>');
  process.exit(2);
}
if (!(engineId in MOVING)) {
  console.error(`no moving param declared for '${engineId}' — add one to MOVING`);
  process.exit(2);
}

// Touch the reference path so the engine (and, for a plugin, its DSP) is loaded
// through exactly the same door the parity test uses.
await referenceFor(engineId);
const params = defaultParams(engineId);

const times: number[] = [];
for (let r = 0; r < RUNS; r++) times.push(once(engineId, params));
console.log(
  `${engineId.padEnd(12)} median ${median(times).toFixed(1)} ms   ` +
  `(${times.map((t) => t.toFixed(0)).join(', ')})   ` +
  `${SECONDS}s x ${VOICES} voices @ ${SR}`,
);
