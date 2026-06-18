import type { FxInstance, PluginFactory } from '../types';

export const limiterPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'limiter',
    name: 'Limiter',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'ceiling', label: 'Ceil', kind: 'continuous', min: -30,   max: 0,   default: -1,   unit: 'dB' },
      { id: 'release', label: 'Rel',  kind: 'continuous', min: 0.001, max: 0.5, default: 0.05, unit: 's' },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const comp   = ctx.createDynamicsCompressor();
    const output = ctx.createGain();
    comp.threshold.value = -1;   // ceiling
    comp.ratio.value     = 20;   // brickwall
    comp.knee.value      = 0;
    comp.attack.value    = 0.001;
    comp.release.value   = 0.05;
    input.connect(comp).connect(output);

    const params = new Map<string, AudioParam>([
      ['ceiling', comp.threshold],
      ['release', comp.release],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => params.get(id)?.value ?? 0,
      setBaseValue: (id, v) => { const p = params.get(id); if (p) p.value = v; },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); comp.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
