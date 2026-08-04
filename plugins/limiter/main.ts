// plugins/limiter/main.ts — the factory, and nothing else. What this effect IS
// — its name, its two knobs, its colour in the rack — lives in plugin.json,
// which the host reads, validates and obeys. A function cannot travel as JSON,
// so it comes through the ABI instead.
//
// A brickwall limiter: a DynamicsCompressor with a 20:1 ratio, no knee and a
// 1 ms attack. "Ceiling" is its threshold — everything above is held down.
import type { FxInstance } from '@loom/plugin-sdk';

Loom.registerFx('limiter', (ctx): FxInstance => {
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
});
