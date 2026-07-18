// src/plugins/fx/tremolo.ts
// Tremolo / trance gate — an LFO chopping the amplitude. Built from native Web
// Audio nodes (an OscillatorNode driving a GainNode's gain), NOT an AudioWorklet:
// the worklet is where the ENGINES synthesise; an insert effect wants the
// browser's compiled nodes.
//
// This is one effect, not two. A trance gate is a tremolo with three things
// added — a tempo-SYNCED rate, a SQUARE shape, and SMOOTHing on the edges — so
// rather than ship a near-duplicate `gate` plugin, those three are params here.
// Square + 1/16 + a little smooth IS the gate; sine + free Hz is the tremolo.
// (mpump keeps a separate per-channel trance gate. Loom's inserts already mount
// on any lane, send or master, so it need not be a per-channel special case.)
import type { FxInstance, PluginFactory } from '../types';

/** Sync division → beats per LFO cycle. Index 0 is Free (manual Hz).
 *  Mirrors the delay's table so the two read the same way. */
const SYNC_BEATS = [0, 1, 0.5, 0.75, 1 / 3, 0.25, 1 / 6];

const SHAPES: OscillatorType[] = ['sine', 'square', 'triangle', 'sawtooth'];

export const tremoloPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'tremolo',
    name: 'Trem/Gate',
    kind: 'fx',
    version: '1.1.0',
    params: [
      { id: 'rate',  label: 'Rate',  kind: 'continuous', min: 0.1, max: 12, default: 5, unit: 'Hz' },
      { id: 'depth', label: 'Depth', kind: 'continuous', min: 0,   max: 1,  default: 0.6 },
      // Square edges click. This lowpasses the LFO itself, so the gate opens and
      // closes over a few ms instead of instantaneously.
      { id: 'smooth', label: 'Smth', kind: 'continuous', min: 0.2, max: 50, default: 2, unit: 'ms' },
      { id: 'shape', label: 'Shape', kind: 'discrete', min: 0, max: 3, default: 0,
        options: [
          { value: 'sine',     label: 'SIN' },
          { value: 'square',   label: 'SQR' },
          { value: 'triangle', label: 'TRI' },
          { value: 'sawtooth', label: 'SAW' },
        ] },
      { id: 'sync', label: 'Sync', kind: 'discrete', min: 0, max: 6, default: 0,
        options: [
          { value: 'free',  label: 'Free' },
          { value: '1/4',   label: '1/4' },
          { value: '1/8',   label: '1/8' },
          { value: '1/8.',  label: '1/8.' },
          { value: '1/8t',  label: '1/8t' },
          { value: '1/16',  label: '1/16' },
          { value: '1/16t', label: '1/16t' },
        ] },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const output = ctx.createGain();
    // The VCA the LFO opens and closes. Its base gain is (1 - depth/2) so the
    // modulation swings symmetrically around unity-ish and never clips above 1.
    const vca = ctx.createGain();

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5;
    // Edge smoothing: a lowpass ON THE LFO, not on the audio. A square wave
    // straight into a gain param steps instantly, and that step clicks.
    const smoother = ctx.createBiquadFilter();
    smoother.type = 'lowpass';
    smoother.Q.value = 0.7;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;                 // depth/2 at the default depth 0.6
    lfo.connect(smoother).connect(lfoDepth).connect(vca.gain);
    lfo.start();

    input.connect(vca).connect(output);

    let rate = 5, depth = 0.6, smoothMs = 2, shapeIdx = 0, syncIdx = 0;
    let currentBpm = 120;
    /** Shadow of the EFFECTIVE rate — a synced value does not live on the knob. */
    let shadowRate = 5;

    const applyDepth = () => {
      vca.gain.value = 1 - depth / 2;          // base level
      lfoDepth.gain.value = depth / 2;         // swing
    };
    const applySmooth = () => {
      // Time constant → cutoff. Shorter smooth = higher cutoff = sharper edges.
      smoother.frequency.value = Math.min(20000, 1000 / (2 * Math.PI * smoothMs));
    };
    const applyRate = () => {
      const beats = SYNC_BEATS[syncIdx];
      shadowRate = beats > 0 ? (currentBpm / 60) / beats : rate;
      lfo.frequency.value = shadowRate;
    };
    applyDepth();
    applySmooth();
    applyRate();

    return {
      input, output,
      getAudioParams: () => new Map<string, AudioParam>([
        ['rate', lfo.frequency],
      ]),
      getBaseValue: (id) =>
        id === 'rate' ? shadowRate : id === 'depth' ? depth
        : id === 'smooth' ? smoothMs : id === 'shape' ? shapeIdx
        : id === 'sync' ? syncIdx : 0,
      setBaseValue: (id, v) => {
        if (id === 'rate')   { rate = v; applyRate(); }
        if (id === 'depth')  { depth = v; applyDepth(); }
        if (id === 'smooth') { smoothMs = v; applySmooth(); }
        if (id === 'shape')  { shapeIdx = v | 0; lfo.type = SHAPES[shapeIdx] ?? 'sine'; }
        if (id === 'sync')   { syncIdx = v | 0; applyRate(); }
      },
      setBpm: (b) => { currentBpm = b; applyRate(); },
      applyPreset: () => {},
      dispose: () => {
        try { lfo.stop(); } catch { /* already stopped */ }
        for (const n of [input, output, vca, lfo, smoother, lfoDepth]) { try { n.disconnect(); } catch { /* ok */ } }
      },
    };
  },
};
