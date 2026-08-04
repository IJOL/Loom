// A stand-in insert for host tests.
//
// Eight test files needed "a real fx with knobs" to exercise automation
// targets, the modulation binder, the XY pad and the insert chain. They used
// the multifilter, which was the nearest real one — and then broke the day it
// left the tree for `plugins/multifilter/`.
//
// None of them is about the multifilter. They are about the HOST: does a
// destination appear, does a binder reach an AudioParam, does a slot rehydrate.
// So they get a fixture instead, and the eleven effects can keep migrating
// without dragging host tests behind them.
//
// It deliberately keeps the id and the param shape the real filter had, so the
// swap was a one-line import change in each file rather than a rewrite of
// assertions that name 'freq' or 'multifilter'.
import type { PluginFactory } from '../src/plugins/types';

export const testFilterPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'multifilter',
    name: 'Filter',
    kind: 'fx',
    version: '1.0.0',
    color: '#ffa726',
    params: [
      { id: 'freq', label: 'Freq', kind: 'continuous', min: 20, max: 20000, default: 1000, curve: 'exponential', unit: 'Hz' },
      { id: 'q',    label: 'Q',    kind: 'continuous', min: 0.1, max: 24,   default: 1,    curve: 'exponential' },
      { id: 'type', label: 'Type', kind: 'discrete',   min: 0,   max: 3,    default: 0,
        options: [
          { value: 'lowpass',  label: 'LP' },
          { value: 'highpass', label: 'HP' },
          { value: 'bandpass', label: 'BP' },
          { value: 'notch',    label: 'Notch' },
        ] },
    ],
    presets: [],
  },
  create(ctx) {
    const input  = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const output = ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;
    input.connect(filter).connect(output);

    let typeIdx = 0;
    const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
    // Same as the real one: modulation rides .detune (cents) so a bipolar LFO
    // sweeps the cutoff proportionally. Several of these tests assert on
    // exactly that, so the fixture has to honour it.
    const params = new Map<string, AudioParam>([
      ['freq', filter.detune],
      ['q', filter.Q],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getAudioParamRange: (id) => {
        if (id === 'freq') return { min: 0, max: 1200 * Math.log2(20000 / 20) };
        if (id === 'q')    return { min: 0, max: 24 };
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
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); filter.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
