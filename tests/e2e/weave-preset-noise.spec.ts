// Reported: picking a preset in a WEAVE row left the output "lockeado en
// ruido" — the transport stopped, the lane's own mute the only thing that
// silenced it. No layers, no inserts; just the row's preset dropdown.
//
// Everything about that is measurable from here. The one thing a DOM assertion
// could never say is whether sound is coming out, so this taps the master and
// measures with the transport NEVER STARTED: whatever plays then is something
// nobody asked to play.
import { test, expect, type Page } from '@playwright/test';
import { installMasterTap, measureMaster, waitForAudible, waitForBoot } from './helpers';

const WEAVE_TAB = '#mode-toggle .mode-btn[data-mode="weave"]';
const PANEL = '#panel-view-weave';
const LANE = '303 1';

function row(page: Page) {
  return page.locator(`${PANEL} .weave-lane-wrap`)
    .filter({ has: page.locator('.weave-lane-name', { hasText: LANE }) })
    .first();
}

test('choosing an instrument and a preset in a WEAVE row makes no sound by itself', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await installMasterTap(page);
  await page.goto('/');
  await waitForBoot(page);

  await page.locator(WEAVE_TAB).click();
  await expect(page.locator(`${PANEL} .weave-rack`)).toBeVisible();

  const r = row(page);
  // The row's own two dropdowns, which is the whole of the reported sequence.
  await r.locator('select.weave-engine').selectOption('westcoast');
  await page.waitForTimeout(500);

  const preset = r.locator('select.weave-preset');
  const growl = await preset.locator('option', { hasText: 'BASS Growl FM' }).getAttribute('value');
  expect(growl).toBeTruthy();
  await preset.selectOption(growl!);
  await page.waitForTimeout(800);

  // Nothing was ever launched. Picking a sound is not playing it.
  const idle = await measureMaster(page, 2000);
  expect(idle.peak).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test('a preset chosen WHILE the weave plays still stops when the transport does', async ({ page }) => {
  // The reported sequence, in full. The lanes were launched — "todas las pistas
  // de weave verdes" — and the preset was picked with the weave running. What
  // was left afterwards did not stop for the transport and only the lane's own
  // mute would silence it.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await installMasterTap(page);
  await page.goto('/');
  await waitForBoot(page);

  // A trusted click, which also resumes the AudioContext.
  await page.locator('.session-scene-launch').first().click();
  await waitForAudible(page);

  await page.locator(WEAVE_TAB).click();
  await expect(page.locator(`${PANEL} .weave-rack`)).toBeVisible();

  const r = row(page);
  // WEAVING, which is the state the report was in: the lane ignores its clip
  // and plays the fold between two loops. Without this the lane is just
  // playing a clip, and a clip stops when the transport does by construction.
  await r.locator('select.weave-topo').selectOption('ab');
  await page.waitForTimeout(600);

  await r.locator('select.weave-engine').selectOption('westcoast');
  await page.waitForTimeout(600);
  const preset = r.locator('select.weave-preset');
  const growl = await preset.locator('option', { hasText: 'BASS Growl FM' }).getAttribute('value');
  await preset.selectOption(growl!);

  // Let it play on the new sound for a couple of bars.
  await page.waitForTimeout(2500);
  const playing = await measureMaster(page, 800);
  expect(playing.peak).toBeGreaterThan(0.01);

  // ⏹. Everything must fall silent — releases included, which is what the
  // second of slack is for.
  await page.locator('#stop').click();
  await page.waitForTimeout(1500);
  const stopped = await measureMaster(page, 1500);

  // Relative, per the project's rule: silence is orders of magnitude below what
  // was playing, not an absolute floor.
  expect(stopped.peak).toBeLessThan(playing.peak * 0.1);
  expect(errors).toEqual([]);
});
