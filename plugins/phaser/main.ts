// plugins/phaser/main.ts — a chain of all-pass filters whose corner
// frequencies an LFO sweeps. What it IS lives in plugin.json.
//
// Each all-pass shifts phase without touching amplitude; summed back with the
// dry signal, the phase differences cancel at a set of frequencies, and those
// notches slide as the corners move — the whoosh. Feedback deepens them.
import type { FxInstance } from '@loom/plugin-sdk';

const STAGES = 4;              // 4 all-pass stages → 2 moving notches, the classic
const CENTRE = 800;            // Hz, centre of the LFO sweep
const SPAN = 1600;             // Hz, how far depth 1 moves the corners

Loom.registerFx('phaser', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const output = ctx.createGain();

  // The all-pass chain.
  const stages: BiquadFilterNode[] = [];
  for (let i = 0; i < STAGES; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = CENTRE;
    ap.Q.value = 0.7;
    stages.push(ap);
  }
  for (let i = 0; i < STAGES - 1; i++) stages[i].connect(stages[i + 1]);
  const first = stages[0], last = stages[STAGES - 1];

  // LFO → every stage's frequency, so the corners move together. Base value on
  // each param stays at CENTRE; the audio-rate LFO is summed on top.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.5;
  const sweep = ctx.createGain();
  sweep.gain.value = SPAN * 0.5 * 0.7;         // SPAN/2 * depth
  for (const ap of stages) lfo.connect(sweep).connect(ap.frequency);
  lfo.start();

  // Feedback from the chain's tail back to its head deepens the notches.
  const fb = ctx.createGain();
  fb.gain.value = 0.3 * 0.5;                     // scaled so max feedback stays stable
  last.connect(fb).connect(first);

  const dry = ctx.createGain(); dry.gain.value = 0.5;
  const wet = ctx.createGain(); wet.gain.value = 0.5;

  // input → dry → out ; input → chain → wet → out.
  input.connect(dry).connect(output);
  input.connect(first);
  last.connect(wet).connect(output);

  let rate = 0.5, depth = 0.7, feedback = 0.3, mix = 0.5;

  return {
    input, output,
    getAudioParams: () => new Map<string, AudioParam>([
      ['rate', lfo.frequency],
      ['mix', wet.gain],
    ]),
    getBaseValue: (id) =>
      id === 'rate' ? rate : id === 'depth' ? depth
      : id === 'feedback' ? feedback : id === 'mix' ? mix : 0,
    setBaseValue: (id, v) => {
      if (id === 'rate')     { rate = v; lfo.frequency.value = v; }
      if (id === 'depth')    { depth = v; sweep.gain.value = SPAN * 0.5 * v; }
      if (id === 'feedback') { feedback = v; fb.gain.value = v * 0.5; }
      if (id === 'mix')      { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
    },
    applyPreset: () => {},
    dispose: () => {
      try { lfo.stop(); } catch { /* already stopped */ }
      for (const n of [input, output, lfo, sweep, fb, dry, wet, ...stages]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
});
