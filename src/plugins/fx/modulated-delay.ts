// src/plugins/fx/modulated-delay.ts
// Registry plumbing for the two effects built on the SDK's modulated delay.
//
// The GRAPH — the delay line, the LFO that wobbles it, the feedback path and
// the mix — lives in `@loom/plugin-sdk` (`createModulatedDelay`), because a
// plugin cannot import from `src/` and chorus and flanger are leaving the tree.
// What is left here is the part that is not the effect: wrapping it as a
// `PluginFactory` so the host registry can hold it. That wrapper dies when the
// two of them become plugins of their own and register through
// `Loom.registerFx` instead.
import { createModulatedDelay, MODULATED_DELAY_DEFAULTS, type ModulatedDelaySpec } from '@loom/plugin-sdk';
import type { FxInstance, PluginFactory } from '../types';

export interface ModDelaySpec extends ModulatedDelaySpec {
  id: string;
  name: string;
  color: string;          // rack accent colour — each caller declares its own
}

export function makeModulatedDelayPlugin(spec: ModDelaySpec): PluginFactory {
  const d = MODULATED_DELAY_DEFAULTS;
  return {
    kind: 'fx',
    manifest: {
      id: spec.id,
      name: spec.name,
      kind: 'fx',
      version: '1.0.0',
      color: spec.color,
      params: [
        { id: 'rate',  label: 'Rate',  kind: 'continuous', min: 0.05, max: 8, default: d.rate, unit: 'Hz' },
        { id: 'depth', label: 'Depth', kind: 'continuous', min: 0,    max: 1, default: d.depth },
        ...(spec.maxFeedback > 0
          ? [{ id: 'feedback', label: 'Fbk', kind: 'continuous' as const, min: 0, max: 1, default: d.feedback }]
          : []),
        { id: 'mix',   label: 'Mix',   kind: 'continuous', min: 0,    max: 1, default: d.mix },
      ],
      presets: [],
    },
    create: (ctx): FxInstance => createModulatedDelay(ctx, spec),
  };
}
