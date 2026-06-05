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

test('dragging a loop handle keeps the brace well-formed on the ruler (no detach)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('#copy-to-performance').click();
  await page.locator('.perf-loop-toggle').click();
  const brace = page.locator('.perf-loop-brace');
  await expect(brace).toBeVisible();
  const track = page.locator('.perf-ruler .perf-track');
  const handle = page.locator('.perf-loop-handle.l');
  const hb = await handle.boundingBox();
  if (!hb) throw new Error('handle not found');
  // Drag the left handle right a little, in steps (exercises pointermove).
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 50, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  const bb = await brace.boundingBox();
  const tb = await track.boundingBox();
  if (!bb || !tb) throw new Error('box not found');
  // After the drag the brace is still a sane rectangle sitting on the ruler.
  // With the mid-drag re-render bug the measured track detached (rect 0,0), so
  // the brace jumped off the ruler / collapsed — these bounds would fail.
  expect(bb.width).toBeGreaterThan(0);
  expect(bb.x).toBeGreaterThanOrEqual(tb.x - 2);
  expect(bb.x + bb.width).toBeLessThanOrEqual(tb.x + tb.width + 2);
});
