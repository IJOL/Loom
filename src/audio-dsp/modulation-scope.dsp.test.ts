// End-to-end proof that TRIG and SCOPE now reach the sound, not just the state.
// Renders the REAL VoiceManager → subtractive renderer path with an LFO on the
// filter cutoff and measures that the rendered audio actually differs.
//
// The regression this guards: toModLite used to drop `trigger` and `scope`, so
// every LFO free-ran and was shared. These renders were byte-identical.
import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
import { ModulationRuntime, type ModLite } from './modulation-runtime';
import type { NoteSpec } from './types';
import './subtractive-renderer';

const SR = 48000;
const note = (o: Partial<NoteSpec> = {}): NoteSpec =>
  ({ midi: 57, beginSec: 0, durationSec: 0.4, velocity: 0.9, accent: false, slide: false, ...o });

const lfo = (over: Partial<ModLite> = {}): ModLite => ({
  id: 'l1', kind: 'lfo', enabled: true, rateHz: 6, waveform: 'sine',
  depthByParam: { filterCutoff: 0.9 }, ...over,
});

// The LFO runs at 6 Hz, so one cycle is 1/6 s. The two notes are placed a QUARTER
// and THREE QUARTERS of a cycle in: neither coincides with the shared origin
// (t=0), and per-voice they end up in antiphase with each other. That is the
// arrangement where "each voice owns its phase" differs most from "one phase for
// the lane" — with both notes landing on t=0 the two modes would agree and the
// test would prove nothing.
const RATE_HZ = 6;
const CYCLE = 1 / RATE_HZ;
const V1_AT = CYCLE * 0.25;
const V2_AT = CYCLE * 0.75;

/** Render a two-note chord through the REAL VoiceManager → renderer path. */
function render(mods: ModLite[], secs = 0.5): Float32Array {
  const mod = new ModulationRuntime(SR);
  mod.setMods(mods);
  const vm = new VoiceManager(SR, 'subtractive', {});
  vm.setModulation(mod);
  const n = Math.floor(SR * secs);
  const out = new Float32Array(n);
  let spawnedFirst = false, spawnedSecond = false;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (!spawnedFirst && t >= V1_AT) {
      vm.spawn(note({ midi: 48, beginSec: t, durationSec: secs }));
      spawnedFirst = true;
    }
    if (!spawnedSecond && t >= V2_AT) {
      vm.spawn(note({ midi: 60, beginSec: t, durationSec: secs }));
      spawnedSecond = true;
    }
    out[i] = vm.renderSample(t);
  }
  return out;
}

const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
/** Mean absolute difference, normalised — how far apart two renders are. */
function divergence(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length / Math.max(1e-9, rms(a));
}

describe('SCOPE reaches the audio', () => {
  it('per-voice renders differently from shared', () => {
    const shared = render([lfo({ scope: 'shared', trigger: 'free' })]);
    const perVoice = render([lfo({ scope: 'voice' })]);
    expect(rms(shared)).toBeGreaterThan(0.001);       // both actually sounded
    expect(rms(perVoice)).toBeGreaterThan(0.001);
    // A control: shared vs itself is bit-identical, so any divergence below is
    // the scope setting and nothing else.
    expect(divergence(shared, render([lfo({ scope: 'shared', trigger: 'free' })]))).toBe(0);
    expect(divergence(shared, perVoice)).toBeGreaterThan(0.1);
  });
});

describe('TRIG reaches the audio', () => {
  it('note-retriggered renders differently from free-running', () => {
    const free = render([lfo({ trigger: 'free', scope: 'shared' })]);
    const note = render([lfo({ trigger: 'note', scope: 'shared' })]);
    expect(divergence(free, note)).toBeGreaterThan(0.05);
  });
});

describe('the fast path is unchanged', () => {
  it('a free+shared LFO renders exactly as it did before (no origin applied)', () => {
    // Explicit free+shared and the legacy no-fields form must be identical.
    const explicit = render([lfo({ trigger: 'free', scope: 'shared' })]);
    const legacy = render([lfo()]);
    let maxDiff = 0;
    for (let i = 0; i < explicit.length; i++) {
      const d = Math.abs(explicit[i] - legacy[i]);
      if (d > maxDiff) maxDiff = d;
    }
    expect(maxDiff).toBe(0);
  });
});
