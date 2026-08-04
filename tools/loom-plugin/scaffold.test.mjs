import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldPlugin } from './scaffold.mjs';
import { buildPlugin } from './build.mjs';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'loom-scaffold-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('loom-plugin new', () => {
  it('emits a dsp source (TypeScript by default, JavaScript on request) and no main-thread file', () => {
    const ts = join(root, 'ts-probe');
    scaffoldPlugin({ dir: ts, id: 'ts-probe', lang: 'ts' });
    expect(existsSync(join(ts, 'dsp.ts'))).toBe(true);
    expect(existsSync(join(ts, 'main.ts'))).toBe(false);
    expect(existsSync(join(ts, 'main.js'))).toBe(false);

    const js = join(root, 'js-probe');
    scaffoldPlugin({ dir: js, id: 'js-probe', lang: 'js' });
    expect(existsSync(join(js, 'dsp.js'))).toBe(true);
    expect(existsSync(join(js, 'main.js'))).toBe(false);
    expect(existsSync(join(js, 'main.ts'))).toBe(false);
  });

  it('names the manifest after the directory, so `new` needs no extra argument', () => {
    const dir = join(root, 'my-synth');
    scaffoldPlugin({ dir, id: 'my-synth', lang: 'js' });
    const m = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'));
    expect(m.id).toBe('my-synth');
    expect(m.components[0].id).toBe('my-synth');
    expect(m.loomApi).toBe(1);
  });

  // The template is worthless if it does not survive the packager: a new author
  // who cannot build the thing `new` just wrote has no way in.
  it('produces a plugin the packager accepts, in both languages', async () => {
    for (const lang of ['ts', 'js']) {
      const dir = join(root, `probe-${lang}`);
      scaffoldPlugin({ dir, id: `probe-${lang}`, lang });
      const res = await buildPlugin({ srcDir: dir, outDir: join(root, 'out') });
      expect(res.id).toBe(`probe-${lang}`);
      const dsp = readFileSync(join(root, 'out', `probe-${lang}`, 'dsp.js'), 'utf8');
      // `Loom` must survive as a FREE global — the whole handshake depends on the
      // bundler not trying to resolve it into an import.
      expect(dsp).toContain(`Loom.registerRenderer("probe-${lang}"`);
      expect(dsp).not.toContain('@loom/plugin-sdk');
    }
  });
});
