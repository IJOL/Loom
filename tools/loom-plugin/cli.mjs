#!/usr/bin/env node
// loom-plugin — build a Loom plugin directory, or scaffold a new one.
//
//   node tools/loom-plugin/cli.mjs build plugins/*        → public/plugins/
//   node tools/loom-plugin/cli.mjs new plugins/my-synth --js
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin, writePluginIndex, listPluginDirs } from './build.mjs';
import { scaffoldPlugin } from './scaffold.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = resolve(REPO_ROOT, 'public', 'plugins');

function expand(pattern) {
  // Only the trailing `*` form is supported — enough for `plugins/*`, and a real
  // glob dependency for one shape would be silly. A plugin marked `private` in
  // its own manifest is skipped here — the sweep is not how you build one, see
  // `listPluginDirs`; ask for it by name instead.
  if (!pattern.endsWith('*')) return [resolve(REPO_ROOT, pattern)];
  const parent = resolve(REPO_ROOT, pattern.slice(0, -1));
  if (!existsSync(parent)) return [];
  return listPluginDirs(parent);
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'build') {
  const dirs = rest.filter((a) => !a.startsWith('-')).flatMap(expand);
  if (dirs.length === 0) { console.error('loom-plugin build: nothing to build'); process.exit(1); }
  mkdirSync(DEFAULT_OUT, { recursive: true });
  for (const dir of dirs) {
    const { id, files } = await buildPlugin({ srcDir: dir, outDir: DEFAULT_OUT });
    console.log(`built ${id}: ${files.join(', ')}`);
  }
  const ids = await writePluginIndex(DEFAULT_OUT);
  console.log(`index: ${ids.join(', ')}`);
} else if (cmd === 'new') {
  const dir = resolve(REPO_ROOT, rest.find((a) => !a.startsWith('-')) ?? '');
  scaffoldPlugin({ dir, id: basename(dir), lang: rest.includes('--js') ? 'js' : 'ts' });
  console.log(`scaffolded ${dir}`);
} else {
  console.error('usage: loom-plugin build <dir…> | new <dir> [--js]');
  process.exit(1);
}
