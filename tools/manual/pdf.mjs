import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { assembleHtml } from './assemble.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const MANUAL_DIR = join(here, '..', '..', 'docs', 'manual');
const CSS_PATH = join(here, 'manual.css');
const OUT = join(MANUAL_DIR, 'Loom-Manual.pdf');

export async function buildPdf() {
  const css = readFileSync(CSS_PATH, 'utf8');
  const html = assembleHtml(MANUAL_DIR, css);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // setContent + networkidle so file:// images finish loading before printing.
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: OUT,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await browser.close();
  }
  console.log(`wrote ${OUT}`);
}
