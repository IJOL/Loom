// src/app/plugin-bootstrap.ts
//
// Plugin file convention:
//   - Synth engines:   src/engines/<name>.ts          (register an engine descriptor)
//   - FX plugins:      src/plugins/fx/<name>.ts
//   - Modulator plugs: src/plugins/modulators/<name>.ts
//   - New standalone:  src/plugins/synths/<name>.plugin.ts
//
// FX / modulator modules export a value satisfying the PluginFactory shape
// ({ kind, manifest, create }); this file scans them via import.meta.glob.
//
// Phase 4 cutover: the synth engines no longer export a node-per-note
// PluginFactory (the legacy classes were deleted). Each engine file now
// registers a metadata DESCRIPTOR into the engine registry. bootstrapPlugins
// bridges those descriptors into the synth PLUGIN registry so the engine
// selector + preset id lists (which read listPlugins('synth')) keep working —
// without any per-engine plugin construction (create() is never called; synth
// lanes are built by the lane allocator's worklet path).

import { registerPlugin } from '../plugins/registry';
import { listEngines } from '../engines/registry';
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

/** Bridge each registered engine descriptor into a synth PluginFactory so the
 *  engine selector + preset-id enumeration (listPlugins('synth')) see every
 *  engine. create() is never invoked — synth lanes are built by the lane
 *  allocator's worklet path — so it throws to flag any unexpected use. The
 *  engine modules must be imported (side-effect) before bootstrapPlugins runs;
 *  the import.meta.glob scan above eagerly loads src/engines/*.ts, which runs
 *  each engine's registerEngine(). */
function engineDescriptorPlugins(): PluginFactory[] {
  return listEngines().map((eng): PluginFactory => ({
    kind: 'synth',
    manifest: {
      id: eng.id,
      name: eng.name,
      kind: 'synth',
      version: '1.0.0',
      params: eng.params,
      presets: [],
    },
    create() {
      throw new Error(
        `engine '${eng.id}' has no node-per-note synth instance (Phase 4 cutover): ` +
        `lanes synthesise through the worklet — build via the lane allocator, not createInstance.`,
      );
    },
  }));
}

/** Register every built-in plugin. Call once at app start, BEFORE
 *  `createAudioGraph()` (because some downstream code resolves plugins
 *  during graph construction). The `extras` parameter is the seam where
 *  runtime-loaded plugins hook in. */
export function bootstrapPlugins(extras: PluginFactory[] = []): void {
  for (const p of [...BUILTIN, ...engineDescriptorPlugins(), ...extras]) registerPlugin(p);
}
