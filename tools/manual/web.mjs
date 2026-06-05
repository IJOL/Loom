import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleHtml } from './assemble.mjs';

// Generates docs/manual/index.html — a single-page, web-readable build of the
// manual (relative image paths, in-page anchor cross-links). It is copied into
// dist/manual by the Vite build (see vite.config.ts) so the manual ships with
// the app and on GitHub Pages at <base>/manual/.
const here = dirname(fileURLToPath(import.meta.url));
export const MANUAL_DIR = join(here, '..', '..', 'docs', 'manual');
const CSS_PATH = join(here, 'manual.css');
const OUT = join(MANUAL_DIR, 'index.html');

export function buildWebHtml() {
  const css = readFileSync(CSS_PATH, 'utf8');
  const html = assembleHtml(MANUAL_DIR, css, { webImages: true });
  writeFileSync(OUT, html);
  console.log(`wrote ${OUT}`);
}
