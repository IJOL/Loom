// plugins/sh/main.ts — main-thread half: metadata only.
import manifest from './plugin.json';

Loom.registerComponent(manifest.components[0] as never);
