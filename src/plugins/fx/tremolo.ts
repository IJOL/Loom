// src/plugins/fx/tremolo.ts
// Tremolo — an LFO chopping the amplitude. The simplest of the modulation FX and
// the template for the rest: like reverb/delay, it is built from native Web Audio
// nodes (an OscillatorNode driving a GainNode's gain), NOT an AudioWorklet. The
// worklet is where the ENGINES synthesise; an insert effect wants the browser's
// compiled nodes, which are faster and cleaner than hand-rolled JS could be.
import type { FxInstance, PluginFactory } from '../types';

export const tremoloPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'tremolo',
    name: 'Trem',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'rate',  label: 'Rate',  kind: 'continuous', min: 0.1, max: 12, default: 5, unit: 'Hz' },
      { id: 'depth', label: 'Depth', kind: 'continuous', min: 0,   max: 1,  default: 0.6 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const output = ctx.createGain();
    // The VCA the LFO opens and closes. Its base gain is (1 - depth/2) so the
    // modulation swings symmetrically around unity-ish and never clips above 1.
    const vca = ctx.createGain();

    // The LFO. A sine from -1..1 is scaled by depth/2 and added to the VCA's base
    // gain, so at depth 1 the gain sweeps 0..1 (full chop) and at depth 0 it sits
    // flat. Runs continuously; connecting an audio-rate source to an AudioParam
    // is summed on top of the param's own value.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;                 // depth/2 at the default depth 0.6
    lfo.connect(lfoDepth).connect(vca.gain);
    lfo.start();

    input.connect(vca).connect(output);

    let rate = 5;
    let depth = 0.6;
    const applyDepth = () => {
      vca.gain.value = 1 - depth / 2;          // base level
      lfoDepth.gain.value = depth / 2;         // swing
    };
    applyDepth();

    return {
      input, output,
      getAudioParams: () => new Map<string, AudioParam>([
        ['rate', lfo.frequency],
      ]),
      getBaseValue: (id) => id === 'rate' ? rate : id === 'depth' ? depth : 0,
      setBaseValue: (id, v) => {
        if (id === 'rate')  { rate = v; lfo.frequency.value = v; }
        if (id === 'depth') { depth = v; applyDepth(); }
      },
      applyPreset: () => {},
      dispose: () => {
        try { lfo.stop(); } catch { /* already stopped */ }
        for (const n of [input, output, vca, lfo, lfoDepth]) { try { n.disconnect(); } catch { /* ok */ } }
      },
    };
  },
};
