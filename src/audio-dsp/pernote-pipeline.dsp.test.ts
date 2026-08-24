// The per-note modulator against REAL audio, through the whole path:
// ModulationRuntime → VoiceManager → the shipped subtractive renderer. The
// kernel's maths and the counter's bookkeeping are tested elsewhere; what is
// proved here is the only thing that matters to a listener — that consecutive
// notes come out DIFFERENT, and that they do so by the modulator's doing.
import { describe, it, expect } from 'vitest';
import '../../test/plugin-dsp';
import '../../plugins/subtractive/dsp';
import '../../plugins/pernote/dsp';
import { ModulationRuntime, type ModLite } from './modulation-runtime';
import { VoiceManager } from './voice-manager';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;
const NOTE_SEC = 0.25;

const PATCH: ParamBag = {
  'osc1.wave': 1, 'osc1.level': 0.6, 'osc1.pw': 0.5,
  'osc2.wave': 1, 'osc2.level': 0.45, 'osc2.detune': 6,
  'filter.cutoff': 0.5, 'filter.resonance': 0.3, 'filter.envAmount': 0.2,
  'amp.attack': 0.005, 'amp.decay': 0.15, 'amp.sustain': 0.6, 'amp.release': 0.1,
};

const note = (n: number): NoteSpec => ({
  midi: 57, beginSec: n * NOTE_SEC, durationSec: NOTE_SEC * 0.5,
  velocity: 0.9, accent: false, slide: false,
});

/** Play `count` identical notes in a row and return each one's rendered samples.
 *  Identical notes on purpose: any difference between them can only have come
 *  from the modulator, not from the material. */
function notesInARow(count: number, pattern: number | null): number[][] {
  const runtime = new ModulationRuntime(SR);
  const target = { 'filter.cutoff': 1 };
  if (pattern !== null) {
    const m: ModLite = {
      id: 'pn', kind: 'pernote', enabled: true, rateHz: 1, waveform: 'sine',
      driver: 'trigger', depthByParam: target,
      params: { pattern, skew: 0, bipolar: 1 },
    };
    runtime.setMods([m]);
  }
  const declared = [...Object.keys(PATCH), ...Object.keys(target)];
  const vm = new VoiceManager(SR, 'subtractive', PATCH, 8, declared);
  vm.setModulation(runtime);

  const per: number[][] = [];
  for (let n = 0; n < count; n++) {
    vm.spawn(note(n));
    const buf: number[] = [];
    const from = Math.floor(n * NOTE_SEC * SR);
    const to = Math.floor((n + 1) * NOTE_SEC * SR);
    for (let i = from; i < to; i++) buf.push(vm.renderSample(i / SR));
    per.push(buf);
  }
  return per;
}

const rms = (b: number[]) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / Math.max(1, b.length));
/** Brightness: first-difference energy over level. A cutoff change moves it. */
const bright = (b: number[]) => {
  let d = 0;
  for (let i = 1; i < b.length; i++) { const x = b[i] - b[i - 1]; d += x * x; }
  return Math.sqrt(d / Math.max(1, b.length - 1)) / Math.max(1e-9, rms(b));
};

/** The widest gap between any two of these notes. */
const spread = (b: number[]) => {
  let w = 0;
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    w = Math.max(w, Math.abs(b[i] - b[j]));
  }
  return w;
};

describe('per-note modulation reaches the sound', () => {
  it('opens the notes apart far wider than the material drifts on its own', () => {
    // Four identical notes are NOT sample-identical even unmodulated: the
    // previous release overlaps and the oscillators free-run, so each note
    // starts on its own phase. That floor is real, so it is what the modulator
    // is measured against rather than assumed away.
    const floor = spread(notesInARow(4, null).map(bright));
    const opened = spread(notesInARow(4, 0.6180339887498949).map(bright));
    expect(floor).toBeGreaterThan(0);                 // the floor is real
    expect(opened).toBeGreaterThan(floor * 5);        // and the modulator dwarfs it
  });

  it('repeats exactly on a second pass — it is variation, not randomness', () => {
    const a = notesInARow(3, 0.6180339887498949).map(bright);
    const c = notesInARow(3, 0.6180339887498949).map(bright);
    for (let i = 0; i < a.length; i++) expect(c[i]).toBe(a[i]);
  });

  it('cycles every two notes at Pattern 0.5, which is what makes it a control', () => {
    const b = notesInARow(4, 0.5).map(bright);
    // Relative, because of the same drift floor: notes two apart must be far
    // closer to each other than neighbours are. Exact equality is not available
    // and asserting it would only be measuring the oscillator's phase.
    const alike = Math.abs(b[2] - b[0]);
    const apart = Math.abs(b[1] - b[0]);
    expect(apart).toBeGreaterThan(alike * 5);
  });
});
