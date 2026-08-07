// WEAVE is the first Loom plugin that is a screen rather than a sound, so the
// things worth pinning in a real browser are the ones that only exist there:
// that a panel plugin becomes a view at all, that it sees the session, and that
// its held gesture restores.
import { test, expect } from '@playwright/test';
import { waitForBoot, addLane } from './helpers';

const WEAVE_TAB = '#mode-toggle .mode-btn[data-mode="weave"]';
const PANEL = '#panel-view-weave';

async function openWeave(page: import('@playwright/test').Page) {
  await page.locator(WEAVE_TAB).click();
  await expect(page.locator(`${PANEL} .weave-rack`)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
});

test('a panel plugin becomes a view beside Session and Performance', async ({ page }) => {
  // The tab is built from the panel registry, which is empty until the plugins
  // resolve. If this fails, the mount ran too early.
  await expect(page.locator(WEAVE_TAB)).toBeVisible();
});

test('the panel is hidden until its tab is chosen', async ({ page }) => {
  await expect(page.locator(PANEL)).toBeHidden();
  await openWeave(page);
});

test('the panel draws one row per lane', async ({ page }) => {
  await openWeave(page);
  const before = await page.locator(`${PANEL} .weave-lane`).count();

  await page.locator('#mode-toggle .mode-btn[data-mode="session"]').click();
  await addLane(page, 'subtractive');
  await openWeave(page);

  // Entering a panel refreshes it: a lane added while it was hidden has to
  // appear, or the panel is only ever right at boot.
  await expect(page.locator(`${PANEL} .weave-lane`)).toHaveCount(before + 1);
});

test('the panel offers the six macros', async ({ page }) => {
  await openWeave(page);
  await expect(page.locator(`${PANEL} .weave-macro`)).toHaveCount(6);
});

test('a held gesture restores exactly what was there', async ({ page }) => {
  await openWeave(page);
  const density = page.locator(`${PANEL} .weave-macro`).first().locator('.mval');
  const before = await density.textContent();

  const surge = page.locator(`${PANEL} .weave-surge`);
  await surge.hover();
  await page.mouse.down();
  await expect(surge).toHaveClass(/held/);
  await expect(density).not.toHaveText(before ?? '');

  await page.mouse.up();
  await expect(surge).not.toHaveClass(/held/);
  await expect(density).toHaveText(before ?? '');
});

test('the weave macros appear in the automation destination picker', async ({ page }) => {
  // This is the one that matters most. A session-scope id that parsed as a lane
  // would resolve to a lane that does not exist, land nowhere and throw
  // nothing — only a real page proves the round trip.
  //
  // The picker lives in the CLIP editor, so a lane alone is not enough: the
  // clip has to be open for the automation panel to exist at all.
  await page.locator('.session-cell-filled').first().dblclick();
  const picker = page.locator('.clip-auto-param-select').first();
  await expect(picker).toHaveCount(1);
  await expect(picker.locator('option[value="session.weave:density"]')).toHaveCount(1);
});
