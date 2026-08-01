// Builds a plugin source directory into a distributable one: bundle main/dsp
// with esbuild, copy the manifest and presets, and refuse anything that reaches
// back into the host source tree — the check that keeps a hidden dependency
// from turning "drop-in" into a lie.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SDK_ENTRY = join(REPO_ROOT, 'packages', 'loom-plugin-sdk', 'src', 'index.ts');
const HOST_SRC = join(REPO_ROOT, 'src');

const LOOM_API_VERSION = 1;

function assertValidManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('plugin.json is not an object');
  for (const k of ['id', 'name', 'version', 'main']) {
    if (typeof m[k] !== 'string' || !m[k]) throw new Error(`plugin.json: ${k} must be a non-empty string`);
  }
  if (m.loomApi !== LOOM_API_VERSION) {
    throw new Error(`plugin.json: loomApi ${m.loomApi} is not supported (tooling speaks ${LOOM_API_VERSION})`);
  }
  // REQUIRED, not `m.components ?? []`: with the component shape, a manifest
  // that forgot `components` (or still speaks the dead `engines` v1 shape)
  // would silently walk zero entries and pass — exactly the lie this fix
  // exists to end.
  if (!Array.isArray(m.components)) {
    throw new Error('plugin.json: components must be an array');
  }
  for (const c of m.components) {
    if (!c || typeof c !== 'object') throw new Error('plugin.json: components entries must be objects');
    if (typeof c.kind !== 'string' || !c.kind) throw new Error('plugin.json: component kind must be a non-empty string');
    if (typeof c.id !== 'string' || !c.id) throw new Error('plugin.json: component id must be a non-empty string');
    if (typeof c.name !== 'string' || !c.name) throw new Error(`plugin.json: component ${c.id ?? '?'} needs a name`);
    if (!c.capabilities || typeof c.capabilities !== 'object') {
      throw new Error(`plugin.json: component ${c.id} needs a capabilities object`);
    }
    if (c.capabilities.clipContent !== 'notes' && c.capabilities.clipContent !== 'audio') {
      throw new Error(`plugin.json: component ${c.id} capabilities.clipContent must be notes|audio`);
    }
  }
}

async function bundleEntry(entry, outFile) {
  const result = await build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    metafile: true,
    alias: { '@loom/plugin-sdk': SDK_ENTRY },
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    const abs = resolve(REPO_ROOT, input);
    if (abs.startsWith(HOST_SRC)) {
      throw new Error(
        `plugin bundle reaches into the host source tree (${input}). A plugin may only ` +
        `import @loom/plugin-sdk and its own files — otherwise it is not drop-in.`,
      );
    }
  }
}

/** Build one plugin source directory into `<outDir>/<id>/`. */
export async function buildPlugin({ srcDir, outDir }) {
  const manifest = JSON.parse(readFileSync(join(srcDir, 'plugin.json'), 'utf8'));
  assertValidManifest(manifest);

  const dest = join(outDir, manifest.id);
  mkdirSync(dest, { recursive: true });
  const files = ['plugin.json'];

  const entryFor = (name) => {
    for (const ext of ['.ts', '.js', '.mjs']) {
      const p = join(srcDir, name.replace(/\.js$/, ext));
      if (existsSync(p)) return p;
    }
    throw new Error(`plugin.json points at ${name} but no matching source file exists in ${srcDir}`);
  };

  await bundleEntry(entryFor(manifest.main), join(dest, manifest.main));
  files.push(manifest.main);
  if (manifest.dsp) {
    await bundleEntry(entryFor(manifest.dsp), join(dest, manifest.dsp));
    files.push(manifest.dsp);
  }
  if (manifest.presets && existsSync(join(srcDir, manifest.presets))) {
    copyFileSync(join(srcDir, manifest.presets), join(dest, manifest.presets));
    files.push(manifest.presets);
  }
  writeFileSync(join(dest, 'plugin.json'), JSON.stringify(manifest, null, 2));
  return { id: manifest.id, files };
}

/** Rewrite `<outRoot>/index.json` from whatever plugin directories exist. The
 *  browser cannot list a directory, so this file IS the discovery mechanism. */
export async function writePluginIndex(outRoot) {
  const ids = readdirSync(outRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(outRoot, d.name, 'plugin.json')))
    .map((d) => d.name)
    .sort();
  writeFileSync(join(outRoot, 'index.json'), JSON.stringify({ plugins: ids }, null, 2));
  return ids;
}
