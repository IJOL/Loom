// src/plugins/fx/multifilter.ts
import type { FxInstance, PluginFactory } from '../types';

/** Full-knob exponential sweep of the filter freq in cents (20 Hz..20 kHz =
 *  log2(1000) octaves). Freq modulation targets BiquadFilterNode.detune
 *  (cents, multiplicative) so a bipolar LFO sweeps the cutoff proportionally
 *  and audibly — instead of summing ±1 Hz (the default insert-param range). */
const FREQ_DETUNE_SPAN_CENTS = 1200 * Math.log2(20000 / 20);  // ≈ 11959 ¢

export const multifilterPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'multifilter',
    name: 'Filter',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'freq', label: 'Freq', kind: 'continuous', min: 20,  max: 20000, default: 1000, curve: 'exponential', unit: 'Hz' },
      { id: 'q',    label: 'Q',    kind: 'continuous', min: 0.1, max: 24,    default: 1,    curve: 'exponential' },
      { id: 'type', label: 'Type', kind: 'discrete',   min: 0,   max: 3,     default: 0,
        options: [
          { value: 'lowpass',  label: 'LP' },
          { value: 'highpass', label: 'HP' },
          { value: 'bandpass', label: 'BP' },
          { value: 'notch',    label: 'Notch' },
        ] },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const output = ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;
    input.connect(filter).connect(output);

    let typeIdx = 0;
    const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

    // Modulation destinations: freq → .detune (cents, exponential) so an LFO
    // sweeps the cutoff musically; q → .Q (linear). The knob/automation path
    // (get/setBaseValue) still writes filter.frequency / filter.Q directly.
    const params = new Map<string, AudioParam>([
      ['freq', filter.detune],
      ['q', filter.Q],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getAudioParamRange: (id) => {
        if (id === 'freq') return { min: 0, max: FREQ_DETUNE_SPAN_CENTS };
        if (id === 'q')    return { min: 0, max: 24 };  // native Q span (knob 0.1..24)
        return undefined;
      },
      getBaseValue: (id) => {
        if (id === 'freq') return filter.frequency.value;
        if (id === 'q')    return filter.Q.value;
        if (id === 'type') return typeIdx;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'freq') filter.frequency.value = v;
        if (id === 'q')    filter.Q.value = v;
        if (id === 'type') { typeIdx = v | 0; filter.type = types[typeIdx] ?? 'lowpass'; }
      },
      applyPreset: () => { /* no presets */ },
      dispose: () => { try { input.disconnect(); filter.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
