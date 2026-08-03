// plugins/tb303/main.ts — main-thread half: metadata only.
// Plain JSON import, NOT `with { type: 'json' }`: esbuild 0.21 bundles JSON
// natively, and the import-attribute syntax is newer than the toolchain here.
import manifest from './plugin.json';

Loom.registerComponent(manifest.components[0] as never);
