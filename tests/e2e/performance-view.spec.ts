import { test, expect } from '@playwright/test';

// Exercises the Performance View mode toggle and the empty-state path.
// The full record-and-play loop (arm REC → launch clips → switch to Performance
// → assert .perf-clip) is a stretch goal: it requires the audio context to
// complete a real-time boundary cycle in headless Chromium, which is too brittle
// for a smoke suite. The tests here prove:
//   1. The app loads and Session is the default view.
//   2. The mode toggle shows the Performance empty-state when no take exists.
//   3. Returning to Session hides the empty-state and shows the session grid.
//   4. Arming REC toggles the button class; disarming removes it.

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('Session is visible on boot; Performance is hidden', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  await expect(page.locator('#session-view-root')).toBeVisible();
  await expect(page.locator('#performance-view-root')).toBeHidden();
});

test('switching to Performance shows the empty-state placeholder', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  await page.locator('[data-mode="performance"]').click();

  // The performance root should now be visible.
  await expect(page.locator('#performance-view-root')).toBeVisible();
  await expect(page.locator('#session-view-root')).toBeHidden();

  // With no recording, the empty-state div is rendered.
  const emptyState = page.locator('.perf-empty');
  await expect(emptyState).toBeVisible({ timeout: 3_000 });
  await expect(emptyState).toContainText('Sin grabación.');
  // No clip blocks should exist.
  await expect(page.locator('.perf-clip')).toHaveCount(0);
});

test('switching back to Session hides Performance and shows session grid', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Go to Performance then come back.
  await page.locator('[data-mode="performance"]').click();
  await expect(page.locator('#performance-view-root')).toBeVisible();

  await page.locator('[data-mode="session"]').click();
  await expect(page.locator('#session-view-root')).toBeVisible();
  await expect(page.locator('#performance-view-root')).toBeHidden();

  // The session grid should have at least one filled cell (boot demo loads clips).
  await expect(page.locator('.session-cell-filled').first()).toBeVisible();
});

test('arming and disarming REC toggles the .armed class on the button', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const recBtn = page.locator('#rec');

  // Initially not armed.
  await expect(recBtn).not.toHaveClass(/armed/);

  // Arm it.
  await recBtn.click();
  await expect(recBtn).toHaveClass(/armed/);

  // Disarm it.
  await recBtn.click();
  await expect(recBtn).not.toHaveClass(/armed/);
});
