// plugins/compressor/main.ts — the factory, and nothing else. What this effect
// IS lives in plugin.json, which the host reads, validates and obeys.
//
// A straight DynamicsCompressor with a makeup gain after it: the browser's own
// compressor gives back a quieter signal by construction, and makeup is what
// returns it to a comparable level so A/B is honest.
import type { FxInstance } from '@loom/plugin-sdk';

Loom.registerFx('compressor', (ctx): FxInstance => {
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
});
