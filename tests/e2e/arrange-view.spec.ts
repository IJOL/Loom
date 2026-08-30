// The Arrange round's user paths, one test each. Audio truths (a muted band is
// silent; a drop SOUNDS) are measured at the master tap; pure editing
// semantics (clamp vs ripple, offset math, solo gating) are pinned at the unit
// layer, so the gesture tests here assert the WIRING — the DOM moved the way
// the pointer said.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitForBoot, installMasterTap, waitForAudible, measureMaster } from './helpers';

// Playwright runs specs from the repo root (ESM scope — no __dirname).
const FIXTURE = join(
  process.cwd(), 'test', 'fixtures', 'loops', 'drum',
  'Amen_Break_135_BPM_cw_amen10_135bpm_1.wav',
);

async function gotoArrange(page: Page): Promise<void> {
  await waitForBoot(page);
  await page.locator('#mode-toggle [data-mode="performance"]').click();
}

async function dropLoop(page: Page, clientX = 260): Promise<void> {
  const b64 = readFileSync(FIXTURE).toString('base64');
  await page.evaluate(async ({ b64: data, x }) => {
    const res = await fetch(`data:audio/wav;base64,${data}`);
    const file = new File([await res.blob()], 'amen.wav', { type: 'audio/wav' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const host = document.getElementById('performance-view-root')!;
    host.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: x, clientY: 200 }));
  }, { b64, x: clientX });
  // Ingest is async (decode + store) — the band appearing is the settled signal.
  await page.waitForSelector('.perf-clip[data-band-id]', { timeout: 10_000 });
}

test('dropping a wav creates an Audio lane and it SOUNDS', async ({ page }) => {
  await installMasterTap(page);
  await page.goto('/');
  await gotoArrange(page);
  await dropLoop(page);
  await expect(page.locator('.perf-clip[data-band-id]')).toHaveCount(1);
  await expect(page.locator('.perf-clip-canvas')).toHaveCount(1); // the waveform band
  await page.locator('#play').click(); // trusted click = the audio gesture
  await waitForAudible(page);
  const on = await measureMaster(page, 800);
  expect(on.avgRms).toBeGreaterThan(0.005); // relative floor: audible vs the tap's silence
});

test('ruler click seeks — the playhead jumps ahead of its own drift', async ({ page }) => {
  await installMasterTap(page);
  await page.goto('/');
  await gotoArrange(page);
  await dropLoop(page);
  await page.locator('#play').click();
  await waitForAudible(page);
  const leftOf = () => page.locator('#perf-playhead').evaluate((el) => parseFloat((el as HTMLElement).style.left || '0'));
  const before = await leftOf();
  // Synthetic click with a real clientX: the sticky ruler row confuses
  // Playwright's actionability hit-test, and a seek needs no trusted gesture
  // (the AudioContext is already running from the Play click above).
  await page.evaluate(() => {
    const track = document.querySelector('.perf-ruler .perf-track') as HTMLElement;
    const r = track.getBoundingClientRect();
    track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 300 }));
  });
  await page.waitForTimeout(150);
  const after = await leftOf();
  // The jump dwarfs natural drift (150ms of playback is a few px at 80px/bar).
  expect(after - before).toBeGreaterThan(60);
});

test('launch-solo drives only the soloed lane (header wiring)', async ({ page }) => {
  await page.goto('/');
  await gotoArrange(page);
  await dropLoop(page, 200);
  await dropLoop(page, 200);
  await expect(page.locator('.perf-clip[data-band-id]')).toHaveCount(2);
  const solos = page.locator('.perf-lane-btn.launch-solo');
  await solos.first().click();
  await expect(solos.first()).toHaveClass(/active/);
  await expect(solos.nth(1)).not.toHaveClass(/active/);
  await solos.first().click(); // un-solo — reversible
  await expect(solos.first()).not.toHaveClass(/active/);
});

test('left-trim moves the band start without moving its end', async ({ page }) => {
  await page.goto('/');
  await gotoArrange(page);
  await dropLoop(page);
  const band = page.locator('.perf-clip[data-band-id]');
  const box0 = (await band.boundingBox())!;
  const handle = band.locator('.perf-clip-handle.l');
  await band.hover();
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(box0.x + 90, box0.y + 10, { steps: 4 });
  await page.mouse.up();
  const box1 = (await band.boundingBox())!;
  expect(box1.x).toBeGreaterThan(box0.x + 40);                       // start moved right
  expect(Math.abs((box1.x + box1.width) - (box0.x + box0.width))).toBeLessThan(8); // end held
});

test('a muted band is silent at the master', async ({ page }) => {
  await installMasterTap(page);
  await page.goto('/');
  await gotoArrange(page);
  await dropLoop(page);
  await page.locator('#play').click();
  await waitForAudible(page);
  const loud = await measureMaster(page, 700);
  await page.locator('.perf-clip[data-band-id]').click({ button: 'right' });
  await page.locator('.perf-context-item', { hasText: 'Mute' }).click();
  // The gate is at the scheduler; the sounding clip leaves at its stop — give
  // it a bar plus reverb/delay tail time, then measure. /3 rather than /5
  // because the send tails decay slowly and are themselves part of the master.
  await page.waitForTimeout(3500);
  const quiet = await measureMaster(page, 700);
  expect(quiet.avgRms).toBeLessThan(loud.avgRms / 3);
});
