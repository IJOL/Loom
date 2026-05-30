// src/plugins/fx/multifilter.ts
import type { FxInstance, PluginFactory } from '../types';

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

    const params = new Map<string, AudioParam>([
      ['freq', filter.frequency],
      ['q', filter.Q],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
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
