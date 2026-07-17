// src/plugins/fx/modulated-delay.ts
// The shared engine behind chorus and flanger: a delay line whose time an LFO
// wobbles, mixed back with the dry signal. Native Web Audio (DelayNode +
// OscillatorNode), not a worklet — the same choice reverb and delay make.
//
//   chorus  — a longer base delay (~18 ms), no feedback: many slightly-detuned
//             copies, a thickening. The name is the sound of a small ensemble.
//   flanger — a very short base delay (~2 ms) WITH feedback: the comb notches
//             sweep, and the feedback sharpens them into the metallic jet.
import type { FxInstance, PluginFactory } from '../types';

export interface ModDelaySpec {
  id: string;
  name: string;
  baseDelaySec: number;   // centre of the LFO sweep
  sweepSec: number;       // how far depth 1 moves the delay time
  maxFeedback: number;    // 0 for chorus; the flanger's resonance ceiling
}

export function makeModulatedDelayPlugin(spec: ModDelaySpec): PluginFactory {
  return {
    kind: 'fx',
    manifest: {
      id: spec.id,
      name: spec.name,
      kind: 'fx',
      version: '1.0.0',
      params: [
        { id: 'rate',  label: 'Rate',  kind: 'continuous', min: 0.05, max: 8, default: 0.8, unit: 'Hz' },
        { id: 'depth', label: 'Depth', kind: 'continuous', min: 0,    max: 1, default: 0.6 },
        ...(spec.maxFeedback > 0
          ? [{ id: 'feedback', label: 'Fbk', kind: 'continuous' as const, min: 0, max: 1, default: 0.4 }]
          : []),
        { id: 'mix',   label: 'Mix',   kind: 'continuous', min: 0,    max: 1, default: 0.5 },
      ],
      presets: [],
    },
    create(ctx): FxInstance {
      const input  = ctx.createGain();
      const output = ctx.createGain();
      const delay  = ctx.createDelay(1);
      delay.delayTime.value = spec.baseDelaySec;

      // LFO → sweep the delay time around its base. Audio-rate source summed onto
      // the delayTime AudioParam.
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.8;
      const sweep = ctx.createGain();
      sweep.gain.value = spec.sweepSec * 0.6;
      lfo.connect(sweep).connect(delay.delayTime);
      lfo.start();

      const fb = ctx.createGain();
      fb.gain.value = spec.maxFeedback > 0 ? 0.4 * spec.maxFeedback : 0;

      const dry = ctx.createGain(); dry.gain.value = 0.5;
      const wet = ctx.createGain(); wet.gain.value = 0.5;

      // Graph: input → dry → out ; input → delay → wet → out ; delay → fb → delay.
      input.connect(dry).connect(output);
      input.connect(delay);
      delay.connect(wet).connect(output);
      if (spec.maxFeedback > 0) delay.connect(fb).connect(delay);

      let rate = 0.8, depth = 0.6, feedback = 0.4, mix = 0.5;
      const applyDepth = () => { sweep.gain.value = spec.sweepSec * depth * 0.6; };
      const applyMix   = () => { wet.gain.value = mix; dry.gain.value = 1 - mix; };

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
          if (id === 'depth')    { depth = v; applyDepth(); }
          if (id === 'feedback' && spec.maxFeedback > 0) { feedback = v; fb.gain.value = v * spec.maxFeedback; }
          if (id === 'mix')      { mix = v; applyMix(); }
        },
        applyPreset: () => {},
        dispose: () => {
          try { lfo.stop(); } catch { /* already stopped */ }
          for (const n of [input, output, delay, lfo, sweep, fb, dry, wet]) {
            try { n.disconnect(); } catch { /* ok */ }
          }
        },
      };
    },
  };
}
