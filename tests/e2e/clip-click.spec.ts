import { test, expect } from '@playwright/test';

// Verifies the session-cell click semantics:
//   - clicking the cell body opens the inspector and does NOT start playback
//   - clicking the ▶ icon launches the clip (and toggles to ⏸ once playing)
//   - clicking ⏸ stops the lane and toggles back to ▶
//   - launching with the transport stopped starts immediately (sync fix)

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('clicking the cell body opens the inspector without launching', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Pick the first filled cell.
  const cell = page.locator('.session-cell-filled').first();
  await expect(cell).toBeVisible();
  await cell.click();

  // Inspector becomes visible.
  const panel = page.locator('#session-inspector');
  await expect(panel).toBeVisible();

  // No playback should have started. Wait a beat (>1s) to ensure no queued
  // clip has fired before asserting.
  await page.waitForTimeout(1100);
  await expect(page.locator('.session-cell-playing')).toHaveCount(0);
});

test('clicking ▶ launches the clip; the icon toggles to ⏸', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const playIcon = page.locator('.session-cell-filled .session-cell-play').first();
  await expect(playIcon).toHaveText('▶');

  // First click: launch. With transport stopped, the launch is immediate
  // (queuedBoundary = now), so playing state should land within ~1s.
  await playIcon.click();
  await expect(page.locator('.session-cell-playing').first()).toBeVisible({ timeout: 2000 });

  // The clicked cell's play icon should now read ⏸.
  const playingIcon = page.locator('.session-cell-playing .session-cell-play').first();
  await expect(playingIcon).toHaveText('⏸');
});

test('clicking ⏸ stops the lane', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const playIcon = page.locator('.session-cell-filled .session-cell-play').first();
  await playIcon.click();
  await expect(page.locator('.session-cell-playing').first()).toBeVisible({ timeout: 2000 });

  // Click the now-pause icon.
  await page.locator('.session-cell-playing .session-cell-play').first().click();

  // No cell should remain in the playing state.
  await expect(page.locator('.session-cell-playing')).toHaveCount(0, { timeout: 2000 });
});
