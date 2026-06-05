import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { SHOTS } from './shot-list.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const IMG_DIR = join(here, '..', '..', 'docs', 'manual', 'images');

async function waitForBoot(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    null, { timeout: 15_000 },
  );
}

export async function buildShots(baseURL, only) {
  mkdirSync(IMG_DIR, { recursive: true });
  const shots = only ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
    });
    for (const shot of shots) {
      await page.goto(baseURL);
      await waitForBoot(page);
      if (shot.setup) await shot.setup(page);
      if (shot.selector) {
        const loc = page.locator(shot.selector).first();
        if (await page.locator(shot.selector).count() === 0)
          throw new Error(`shot "${shot.name}": selector ${shot.selector} matched nothing`);
        await loc.scrollIntoViewIfNeeded();
        await loc.screenshot({ path: join(IMG_DIR, `${shot.name}.png`) });
      } else {
        await page.screenshot({ path: join(IMG_DIR, `${shot.name}.png`), fullPage: true });
      }
      console.log(`shot ${shot.name}.png`);
    }
  } finally {
    await browser.close();
  }
  console.log(`wrote ${shots.length} screenshots`);
}
