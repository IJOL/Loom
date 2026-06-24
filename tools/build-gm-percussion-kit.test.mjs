import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Re-derive PADS by importing nothing executable: read the script text and the
// catalog, and assert every pad's VCSL key exists. (The generator is a top-level
// script; we validate its contract against the vendored catalog without network.)
const dir = path.dirname(fileURLToPath(import.meta.url));

describe('gm-percussion generator mapping', () => {
  it('every PADS key exists in the vendored VCSL catalog', async () => {
    const catalog = JSON.parse(await readFile(path.join(dir, 'vcsl.json'), 'utf8'));
    const src = await readFile(path.join(dir, 'build-gm-percussion-kit.mjs'), 'utf8');
    const keys = [...src.matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) expect(catalog[k], `VCSL key '${k}'`).toBeTruthy();
  });
  it('notes are unique and within 27..87', async () => {
    const src = await readFile(path.join(dir, 'build-gm-percussion-kit.mjs'), 'utf8');
    const notes = [...src.matchAll(/note:\s*(\d+)/g)].map((m) => Number(m[1]));
    const uniq = new Set(notes);
    expect(uniq.size).toBe(notes.length);
    for (const n of notes) { expect(n).toBeGreaterThanOrEqual(27); expect(n).toBeLessThanOrEqual(87); }
  });
});
