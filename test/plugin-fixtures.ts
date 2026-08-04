// Registering a plugin engine inside a unit test, through the REAL manifest.
//
// Before the migration a test wrote `import '../engines/subtractive'` and the
// module registered itself as a side effect. A plugin has no such module in
// src/, so this reads plugins/<id>/plugin.json from disk and pushes it through
// the same door production uses: adoptComponents, the one path a component
// enters by. Reading the real file is the point — a hand-written stub would
// keep passing while the manifest it stands in for was broken.
//
// Synchronous on purpose, so a test can call it at module scope exactly where
// it used to write `import '../engines/tb303'`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptComponents } from '../src/plugin-host/loom-api';
import type { ComponentManifest } from '@loom/plugin-sdk';

// The repo is ESM ("type": "module"), so there is no __dirname to lean on.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins');

export function registerPluginEngine(id: string): void {
  const path = join(ROOT, id, 'plugin.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`registerPluginEngine: no manifest at ${path} for plugin '${id}'`);
  }
  const manifest = JSON.parse(raw) as { components: ComponentManifest[] };
  adoptComponents(manifest.components);
}
