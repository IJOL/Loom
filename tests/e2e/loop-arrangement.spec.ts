import { test, expect } from '@playwright/test';

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('Copy to Performance populates the arrangement and switches view', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('#copy-to-performance').click();
  await expect(page.locator('#performance-view-root')).toBeVisible();
  await expect(page.locator('#performance-view-root .perf-clip').first()).toBeVisible();
});

test('enabling Loop shows the A–B brace on the ruler', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('#copy-to-performance').click();
  await page.locator('.perf-loop-toggle').click();
  await expect(page.locator('.perf-loop-brace')).toBeVisible();
});
