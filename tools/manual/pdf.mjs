import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { assembleHtml } from './assemble.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const MANUAL_DIR = join(here, '..', '..', 'docs', 'manual');
const CSS_PATH = join(here, 'manual.css');
const OUT = join(MANUAL_DIR, 'Loom-Manual.pdf');

export async function buildPdf() {
  const css = readFileSync(CSS_PATH, 'utf8');
  const html = assembleHtml(MANUAL_DIR, css); // images as absolute file:// URLs
  // The page is written to a file and opened, rather than pushed in with
  // setContent, because setContent leaves the document on the about:blank
  // origin and Chromium will not load a file:// image into a page that did not
  // come from file:// itself. Every screenshot failed to load that way, and the
  // manual printed 71 pages of broken-image icons.
  const dir = mkdtempSync(join(tmpdir(), 'loom-manual-'));
  const src = join(dir, 'manual.html');
  writeFileSync(src, html);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const failed = [];
    page.on('requestfailed', (req) => failed.push(req.url()));
    await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle' });
    const broken = await page.evaluate(
      () => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length,
    );
    if (broken || failed.length) {
      throw new Error(
        `manual PDF: ${broken} image(s) did not render, ${failed.length} request(s) failed:\n` +
          failed.join('\n'),
      );
    }
    await page.pdf({
      path: OUT,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`wrote ${OUT}`);
}
