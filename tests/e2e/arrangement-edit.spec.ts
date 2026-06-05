import { test, expect, type Page } from '@playwright/test';

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('.session-cell-filled').length > 0, { timeout: 10_000 });
}
async function openPerf(page: Page): Promise<void> {
  await page.goto('/'); await waitForBoot(page);
  await page.locator('#copy-to-performance').click();
  await expect(page.locator('#performance-view-root .perf-clip').first()).toBeVisible();
}
const firstBand = (page: Page) => page.locator('#performance-view-root .perf-clip').first();

test('dragging a band moves it right', async ({ page }) => {
  await openPerf(page);
  const before = await firstBand(page).boundingBox();
  const box = before!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = await firstBand(page).boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x + 20);
});

test('the × button deletes a band', async ({ page }) => {
  await openPerf(page);
  const count0 = await page.locator('#performance-view-root .perf-clip').count();
  await firstBand(page).hover();
  await firstBand(page).locator('.perf-clip-del').click();
  const count1 = await page.locator('#performance-view-root .perf-clip').count();
  expect(count1).toBe(count0 - 1);
});

test('Ctrl+Z restores a deleted band', async ({ page }) => {
  await openPerf(page);
  const count0 = await page.locator('#performance-view-root .perf-clip').count();
  await firstBand(page).hover();
  await firstBand(page).locator('.perf-clip-del').click();
  expect(await page.locator('#performance-view-root .perf-clip').count()).toBe(count0 - 1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#performance-view-root .perf-clip')).toHaveCount(count0);
});
