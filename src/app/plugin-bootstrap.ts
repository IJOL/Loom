// src/app/plugin-bootstrap.ts
//
// Plugin file convention:
//   - Synth engines:   src/engines/<name>.ts          (may also export a legacy SynthEngine)
//   - FX plugins:      src/plugins/fx/<name>.ts
//   - Modulator plugs: src/plugins/modulators/<name>.ts
//   - New standalone:  src/plugins/synths/<name>.plugin.ts
//
// Every plugin module must export AT LEAST ONE value that satisfies the
// PluginFactory shape: { kind, manifest, create }.  This file uses
// import.meta.glob (Vite build-time scan) so adding a new file in the
// directories above is the ONLY step required — no imports here needed.

import { registerPlugin } from '../plugins/registry';
import type { PluginFactory } from '../plugins/types';

// Eagerly import every module in the engine + plugin directories.
// Vite resolves the glob at build time; tree-shaking keeps only what's used.
// Test files are explicitly excluded so they don't pollute the plugin registry.
const _engineModules = import.meta.glob<Record<string, unknown>>(
  ['../engines/*.ts', '!../engines/*.test.ts'],
  { eager: true },
);
const _pluginModules = import.meta.glob<Record<string, unknown>>(
  ['../plugins/**/*.ts', '!../plugins/**/*.test.ts'],
  { eager: true },
);

function isPluginFactory(v: unknown): v is PluginFactory {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    (o['kind'] === 'synth' || o['kind'] === 'fx' || o['kind'] === 'modulator') &&
    typeof o['manifest'] === 'object' && o['manifest'] !== null &&
    typeof (o['manifest'] as Record<string, unknown>)['id'] === 'string' &&
    typeof o['create'] === 'function'
  );
}

/** Collect all PluginFactory values exported from the scanned modules. */
function collectFactories(modules: Record<string, Record<string, unknown>>): PluginFactory[] {
  const out: PluginFactory[] = [];
  for (const mod of Object.values(modules)) {
    for (const val of Object.values(mod)) {
      if (isPluginFactory(val)) out.push(val);
    }
  }
  return out;
}

const BUILTIN: PluginFactory[] = [
  ...collectFactories(_engineModules),
  ...collectFactories(_pluginModules),
];

/** Register every built-in plugin. Call once at app start, BEFORE
 *  `createAudioGraph()` (because some downstream code resolves plugins
 *  during graph construction). The `extras` parameter is unused today —
 *  it's the seam where phase 2 (runtime-loaded plugins) hooks in. */
export function bootstrapPlugins(extras: PluginFactory[] = []): void {
  for (const p of [...BUILTIN, ...extras]) registerPlugin(p);
}
