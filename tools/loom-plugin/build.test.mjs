import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildPlugin, writePluginIndex, listPluginDirs } from './build.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'loom-plugin-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function writePlugin(dir, extra = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    id: 'probe', name: 'Probe', version: '1.0.0', loomApi: 1,
    main: 'main.js', dsp: 'dsp.js',
    components: [{
      kind: 'engine', id: 'probe', name: 'Probe', polyphony: 'poly',
      params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
      capabilities: { clipContent: 'notes', shortLabel: 'probe', outputTrim: 0.5 },
    }],
    ...extra,
  }));
  writeFileSync(join(dir, 'main.ts'), `Loom.registerEngine(${JSON.stringify({ id: 'probe' })});\n`);
  writeFileSync(join(dir, 'dsp.ts'), `Loom.registerRenderer('probe', () => ({ renderSample: () => 0, noteOff() {}, done: false }));\n`);
}

describe('loom-plugin build', () => {
  it('emits plugin.json, main.js and dsp.js into the output directory', async () => {
    const src = join(root, 'src', 'probe');
    writePlugin(src);
    const out = join(root, 'out');
    const res = await buildPlugin({ srcDir: src, outDir: out });
    expect(res.id).toBe('probe');
    for (const f of ['plugin.json', 'main.js', 'dsp.js']) {
      expect(existsSync(join(out, 'probe', f))).toBe(true);
    }
  });

  it('rejects a manifest the host would refuse', async () => {
    const src = join(root, 'src', 'probe');
    writePlugin(src, { loomApi: 99 });
    await expect(buildPlugin({ srcDir: src, outDir: join(root, 'out') })).rejects.toThrow(/loomApi/);
  });

  it('rejects a manifest with no components — the dead v1 `engines` shape included', async () => {
    const src = join(root, 'src', 'probe');
    // Simulates a plugin author still on the old v1 shape: `engines` instead of
    // `components`. Before this fix, `m.engines ?? []` walked zero entries and
    // the build sailed through silently — the exact lie this validator exists
    // to end.
    writePlugin(src, {
      components: undefined,
      engines: [{ id: 'probe', name: 'Probe', polyphony: 'poly', clipEditor: 'piano-roll', outputTrim: 0.5, shortLabel: 'probe', params: [] }],
    });
    await expect(buildPlugin({ srcDir: src, outDir: join(root, 'out') })).rejects.toThrow(/components/);
  });

  it('rejects a component with no capabilities', async () => {
    const src = join(root, 'src', 'probe');
    writePlugin(src, {
      components: [{ kind: 'engine', id: 'probe', name: 'Probe', polyphony: 'poly', params: [] }],
    });
    await expect(buildPlugin({ srcDir: src, outDir: join(root, 'out') })).rejects.toThrow(/capabilities/);
  });

  it('refuses a bundle that reaches into the host source tree', async () => {
    const src = join(root, 'src', 'probe');
    writePlugin(src);
    // The path has to be computed, not written by hand: this fixture lives in a
    // temp directory, so a hand-written '../../../src/…' resolves to nothing and
    // esbuild would fail with "could not resolve" — which is NOT the guard we
    // are testing. This reaches the REAL host source, so the metafile records it
    // and the guard is the thing that rejects the build.
    const hostModule = relative(src, join(REPO_ROOT, 'src', 'core', 'velocity-gain')).replaceAll('\\', '/');
    writeFileSync(join(src, 'dsp.ts'),
      `import { velGain01 } from '${hostModule}';\nLoom.registerRenderer('probe', () => ({ renderSample: () => velGain01(1, false), noteOff() {}, done: false }));\n`);
    await expect(buildPlugin({ srcDir: src, outDir: join(root, 'out') })).rejects.toThrow(/host source/i);
  });

  it('writes an index listing every built plugin', async () => {
    const out = join(root, 'out');
    for (const id of ['probe', 'other']) {
      const src = join(root, 'src', id);
      writePlugin(src);
      writeFileSync(join(src, 'plugin.json'), readFileSync(join(root, 'src', 'probe', 'plugin.json'), 'utf8').replaceAll('probe', id));
      await buildPlugin({ srcDir: src, outDir: out });
    }
    const ids = await writePluginIndex(out);
    expect(ids.sort()).toEqual(['other', 'probe']);
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).plugins.sort()).toEqual(['other', 'probe']);
  });

  // The `private` field (PluginManifestFile.private): a plugin that exists only
  // to exercise the host — the fixture the audio-channel e2e builds — must never
  // reach a real user via the `plugins/*` sweep or the index, but must still be
  // buildable when a caller (a test) asks for it by name.
  describe('private plugins', () => {
    it('a `plugins/*` sweep of two directories, one private, builds and indexes only the normal one', async () => {
      const parent = join(root, 'src');
      writePlugin(join(parent, 'normal'));
      writeFileSync(join(parent, 'normal', 'plugin.json'),
        readFileSync(join(parent, 'normal', 'plugin.json'), 'utf8').replaceAll('probe', 'normal'));
      writePlugin(join(parent, 'hidden'));
      writeFileSync(join(parent, 'hidden', 'plugin.json'), JSON.stringify({
        ...JSON.parse(readFileSync(join(parent, 'hidden', 'plugin.json'), 'utf8').replaceAll('probe', 'hidden')),
        private: true,
      }));

      // This is the sweep itself: what `cli.mjs`'s `expand('plugins/*')` walks.
      const dirs = listPluginDirs(parent);
      expect(dirs.map((d) => basename(d)).sort()).toEqual(['normal']);

      const out = join(root, 'out');
      for (const dir of dirs) await buildPlugin({ srcDir: dir, outDir: out });
      const ids = await writePluginIndex(out);
      expect(ids).toEqual(['normal']);
      expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).plugins).toEqual(['normal']);
    });

    it('a private plugin still builds when asked for by name, the way the e2e fixture needs', async () => {
      const src = join(root, 'src', 'hidden');
      writePlugin(src);
      writeFileSync(join(src, 'plugin.json'), JSON.stringify({
        ...JSON.parse(readFileSync(join(src, 'plugin.json'), 'utf8')),
        private: true,
      }));

      const out = join(root, 'out');
      const res = await buildPlugin({ srcDir: src, outDir: out });
      expect(res.id).toBe('probe');
      for (const f of ['plugin.json', 'main.js', 'dsp.js']) {
        expect(existsSync(join(out, 'probe', f))).toBe(true);
      }

      // Even built into the same outDir the real index lives in, it must not
      // be listed — building by name is not the same as shipping.
      const ids = await writePluginIndex(out);
      expect(ids).toEqual([]);
    });
  });
});
