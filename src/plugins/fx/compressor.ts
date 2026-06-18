import type { FxInstance, PluginFactory } from '../types';

export const compressorPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'compressor',
    name: 'Compressor',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'threshold', label: 'Thr',   kind: 'continuous', min: -60,    max: 0,  default: -24, unit: 'dB' },
      { id: 'ratio',     label: 'Ratio', kind: 'continuous', min: 1,      max: 20, default: 4 },
      { id: 'attack',    label: 'Atk',   kind: 'continuous', min: 0.001,  max: 1,  default: 0.003, unit: 's' },
      { id: 'release',   label: 'Rel',   kind: 'continuous', min: 0.001,  max: 1,  default: 0.25,  unit: 's' },
      { id: 'knee',      label: 'Knee',  kind: 'continuous', min: 0,      max: 40, default: 30, unit: 'dB' },
      { id: 'makeup',    label: 'Mkup',  kind: 'continuous', min: 0,      max: 4,  default: 1 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const comp   = ctx.createDynamicsCompressor();
    const makeup = ctx.createGain();
    const output = ctx.createGain();
    comp.threshold.value = -24;
    comp.ratio.value     = 4;
    comp.attack.value    = 0.003;
    comp.release.value   = 0.25;
    comp.knee.value      = 30;
    makeup.gain.value    = 1;
    input.connect(comp).connect(makeup).connect(output);

    const params = new Map<string, AudioParam>([
      ['threshold', comp.threshold],
      ['ratio',     comp.ratio],
      ['attack',    comp.attack],
      ['release',   comp.release],
      ['knee',      comp.knee],
      ['makeup',    makeup.gain],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => params.get(id)?.value ?? 0,
      setBaseValue: (id, v) => { const p = params.get(id); if (p) p.value = v; },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); comp.disconnect(); makeup.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
