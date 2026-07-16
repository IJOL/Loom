// src/audio-dsp/modulation-pipeline.test.ts
// OBJECTIVE end-to-end modulation test (recovers the old .wiring.test.ts coverage
// that the worklet rewrite dropped). It drives the FULL in-engine modulation path —
// ModulationRuntime → VoiceManager → renderer — and renders the REAL audio of each
// engine with an LFO modulating a continuous param, asserting the sound actually
// changes. No browser, no worklet message transport (that postMessage is trivial and
// covered by worklet-node-dispose.test); everything else here is the real pipeline.
//
// The check is relative + robust: with the LFO at full depth on a target param the
// per-window RMS envelope must differ MEASURABLY from the unmodulated render. That
// proves the modulation reaches the sound — for every engine — without ear-checking.
import { describe, it, expect } from 'vitest';
import { ModulationRuntime, type ModLite } from './modulation-runtime';
import { VoiceManager } from './voice-manager';
import type { NoteSpec, ParamBag } from './types';
// Side-effect imports: register every renderer so createRenderer(engineId, …) works.
import './subtractive-renderer';
import './wavetable-renderer';
import './fm-renderer';
import './karplus-renderer';
import './tb303-renderer';
import './westcoast-renderer';

const SR = 48000;
const note = (o: Partial<NoteSpec> = {}): NoteSpec =>
  ({ midi: 57, beginSec: 0, durationSec: 0.4, velocity: 0.9, accent: false, slide: false, ...o });

/** Render an engine for `seconds` with an optional single LFO modulating one param.
 *  Drives the real ModulationRuntime + VoiceManager + renderer path. */
function render(engineId: string, params: ParamBag, depthByParam: Record<string, number> | null, seconds: number): number[] {
  const runtime = new ModulationRuntime(SR);
  if (depthByParam) {
    const lfo: ModLite = { id: 'l', kind: 'lfo', enabled: true, rateHz: 6, waveform: 'sine', depthByParam };
    runtime.setMods([lfo]);
  }
  const vm = new VoiceManager(SR, engineId, params);
  vm.setModulation(runtime);
  vm.spawn(note({ durationSec: seconds }));
  const out: number[] = [];
  for (let i = 0; i < Math.floor(SR * seconds); i++) out.push(vm.renderSample(i / SR));
  return out;
}

/** Per-window (5 ms) RMS envelope — captures the time-varying shape an LFO imparts. */
function rmsEnvelope(buf: number[]): number[] {
  const w = Math.floor(SR * 0.005);
  const env: number[] = [];
  for (let i = 0; i + w <= buf.length; i += w) {
    let s = 0;
    for (let j = i; j < i + w; j++) s += buf[j] * buf[j];
    env.push(Math.sqrt(s / w));
  }
  return env;
}

/** Mean absolute difference between two RMS envelopes (relative measure). */
function envDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let d = 0, e = 0;
  for (let i = 0; i < n; i++) { d += Math.abs(a[i] - b[i]); e += a[i]; }
  return e > 1e-9 ? d / e : 0;   // normalised by the unmodulated energy
}

// Each engine: a continuous param the renderer reads per sample. depthByParam uses
// the key the engine's modOffsets are keyed by (SubParams field for subtractive,
// param dot-id for the others). Base params nudge the target so the sweep is audible.
const CASES: Array<{ id: string; params: ParamBag; mod: Record<string, number>; }> = [
  { id: 'subtractive', params: { 'filter.cutoff': 0.3, 'filter.resonance': 0.2, 'amp.builtinEnv': 1 }, mod: { filterCutoff: 0.6 } },
  { id: 'wavetable',   params: { 'filter.cutoff': 0.3, 'osc.waveA': 3, 'osc.waveB': 3 }, mod: { 'filter.cutoff': 0.6 } },
  { id: 'fm',          params: { algorithm: 0, 'op1.level': 0.6, 'op2.level': 0.4 }, mod: { 'op2.level': 0.7 } },
  { id: 'karplus',     params: {}, mod: { 'amp.level': 0.6 } },
  // env.amount 0 switches OFF the 303's own filter envelope, leaving the LFO as the
  // only thing driving the cutoff — this test is about the LFO reaching the DSP, and
  // Env Mod is a second modulator writing to that same cutoff. At its 0.5 default it
  // adds a decaying +3000 Hz on top of the knob, flooring the sweep at ~1722 Hz: an
  // octave above this note's 220 Hz fundamental, so the filter never closes onto the
  // harmonics and the LOUDNESS measured here moves ~4%. (It is not masking: a ladder's
  // level is flat once its passband already holds all the energy. The Svf this replaced
  // sloped ~43% across that same span — an artifact, and the only reason the old params
  // passed.) With Env Mod at 0 the LFO sweeps 80..5048 Hz, across the fundamental,
  // and the filter audibly chokes the note: envDiff ≈ 1.0 against the 0.05 bar.
  { id: 'tb303',       params: { 'filter.cutoff': 0.3, 'env.amount': 0 }, mod: { 'filter.cutoff': 0.6 } },
  { id: 'westcoast',   params: { 'lpg.cutoff': 0.3, 'lpg.mode': 2 }, mod: { 'lpg.cutoff': 0.6 } },
];

describe('modulation pipeline (objective, per engine)', () => {
  for (const c of CASES) {
    it(`${c.id}: an LFO on a continuous param measurably changes the rendered sound`, () => {
      const dry = rmsEnvelope(render(c.id, c.params, null, 0.4));
      const wet = rmsEnvelope(render(c.id, c.params, c.mod, 0.4));
      // The LFO sweep must reshape the loudness envelope by a clear margin.
      expect(envDiff(wet, dry)).toBeGreaterThan(0.05);
    });
  }

  // Control / falsifier: routing an LFO at a NON-continuous param (the 303's saw/square
  // switch, read once at trigger) must leave the sound untouched. This proves the
  // positive tests above measure the real modulation, not render noise — the render is
  // deterministic, so "no effect" means an envDiff of essentially zero.
  // Same patch as the tb303 case above, so the ONLY variable is which param the LFO
  // targets: continuous → envDiff ≈ 1.0, non-continuous → 0.
  it('control: an LFO on a non-continuous param (303 waveform switch) does NOT change the sound', () => {
    const patch = { 'filter.cutoff': 0.3, 'env.amount': 0 };
    const dry = rmsEnvelope(render('tb303', patch, null, 0.4));
    const wet = rmsEnvelope(render('tb303', patch, { 'osc.wave': 0.9 }, 0.4));
    expect(envDiff(wet, dry)).toBeLessThan(0.01);
  });
});
