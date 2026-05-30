import { test, expect } from '@playwright/test';

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

// Helper: drag-and-drop using raw pointer events (Playwright's locator.dragTo
// uses HTML5 DnD which doesn't fire on our pointer-based handler).
async function dragCell(
  page: import('@playwright/test').Page,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator,
  ctrlKey = false,
): Promise<void> {
  const sBox = (await source.boundingBox())!;
  const tBox = (await target.boundingBox())!;
  const sX = sBox.x + sBox.width / 2;
  const sY = sBox.y + sBox.height / 2;
  const tX = tBox.x + tBox.width / 2;
  const tY = tBox.y + tBox.height / 2;
  if (ctrlKey) await page.keyboard.down('Control');
  await page.mouse.move(sX, sY);
  await page.mouse.down();
  // Several intermediate moves so the threshold is crossed and elementFromPoint
  // updates have time to register.
  await page.mouse.move(sX + 10, sY + 10, { steps: 4 });
  await page.mouse.move(tX, tY, { steps: 6 });
  await page.mouse.up();
  if (ctrlKey) await page.keyboard.up('Control');
}

/**
 * Find a lane that has at least one filled cell AND at least one empty cell.
 * Returns { laneId, filledClipIdx, emptyClipIdx } or null if none found.
 */
async function findLaneWithMixedCells(page: import('@playwright/test').Page): Promise<{
  laneId: string;
  filledClipIdx: string;
  emptyClipIdx: string;
} | null> {
  return page.evaluate(() => {
    const allCells = Array.from(document.querySelectorAll<HTMLElement>('.session-cell'));
    const laneMap = new Map<string, { filled: string[]; empty: string[] }>();
    for (const cell of allCells) {
      const laneId = cell.dataset.laneId;
      const clipIdx = cell.dataset.clipIdx;
      if (!laneId || clipIdx === undefined) continue;
      if (!laneMap.has(laneId)) laneMap.set(laneId, { filled: [], empty: [] });
      const entry = laneMap.get(laneId)!;
      if (cell.classList.contains('session-cell-filled')) {
        entry.filled.push(clipIdx);
      } else if (cell.classList.contains('session-cell-empty')) {
        entry.empty.push(clipIdx);
      }
    }
    for (const [laneId, { filled, empty }] of laneMap) {
      if (filled.length > 0 && empty.length > 0) {
        return { laneId, filledClipIdx: filled[0], emptyClipIdx: empty[0] };
      }
    }
    return null;
  });
}

test('drag moves a clip to an empty cell', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const mixed = await findLaneWithMixedCells(page);
  if (!mixed) test.skip(true, 'no lane has both filled and empty cells in demo');

  const { laneId, filledClipIdx, emptyClipIdx } = mixed!;

  const source = page.locator(`.session-cell-filled[data-lane-id="${laneId}"][data-clip-idx="${filledClipIdx}"]`);
  await expect(source).toBeVisible();
  const sourceColor = await source.evaluate((el) => (el as HTMLElement).style.backgroundColor);

  const target = page.locator(`.session-cell-empty[data-lane-id="${laneId}"][data-clip-idx="${emptyClipIdx}"]`);
  await expect(target).toBeVisible();

  await dragCell(page, source, target);

  // After move the cell is re-rendered as filled; re-query without the empty class.
  const targetAfter = page.locator(`.session-cell[data-lane-id="${laneId}"][data-clip-idx="${emptyClipIdx}"]`);
  await expect(targetAfter).toHaveClass(/session-cell-filled/);
  const movedColor = await targetAfter.evaluate((el) => (el as HTMLElement).style.backgroundColor);
  expect(movedColor).toBe(sourceColor);
});

test('Ctrl+drag copies the clip; copy shares the source color', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const mixed = await findLaneWithMixedCells(page);
  if (!mixed) test.skip(true, 'no lane has both filled and empty cells in demo');

  const { laneId, filledClipIdx, emptyClipIdx } = mixed!;

  const source = page.locator(`.session-cell-filled[data-lane-id="${laneId}"][data-clip-idx="${filledClipIdx}"]`);
  const sourceColor = await source.evaluate((el) => (el as HTMLElement).style.backgroundColor);
  const filledBefore = await page.locator(`.session-cell-filled[data-lane-id="${laneId}"]`).count();

  const target = page.locator(`.session-cell-empty[data-lane-id="${laneId}"][data-clip-idx="${emptyClipIdx}"]`);
  await dragCell(page, source, target, /* ctrlKey */ true);

  const filledAfter = await page.locator(`.session-cell-filled[data-lane-id="${laneId}"]`).count();
  expect(filledAfter).toBe(filledBefore + 1);

  const colors = await page.locator(`.session-cell-filled[data-lane-id="${laneId}"]`)
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.backgroundColor));
  expect(colors.filter((c) => c === sourceColor).length).toBeGreaterThanOrEqual(2);
});

test('drag onto occupied cell is rejected (no mutation)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const cells = page.locator('.session-cell-filled');
  if (await cells.count() < 2) test.skip(true, 'demo needs two filled cells');

  const source = cells.nth(0);
  const target = cells.nth(1);
  const sourceColorBefore = await source.evaluate((el) => (el as HTMLElement).style.backgroundColor);
  const targetColorBefore = await target.evaluate((el) => (el as HTMLElement).style.backgroundColor);

  await dragCell(page, source, target);

  const sourceColorAfter = await source.evaluate((el) => (el as HTMLElement).style.backgroundColor);
  const targetColorAfter = await target.evaluate((el) => (el as HTMLElement).style.backgroundColor);
  expect(sourceColorAfter).toBe(sourceColorBefore);
  expect(targetColorAfter).toBe(targetColorBefore);
});

test('move + Ctrl+Z restores the original slot', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const mixed = await findLaneWithMixedCells(page);
  if (!mixed) test.skip(true, 'no lane has both filled and empty cells in demo');

  const { laneId, filledClipIdx, emptyClipIdx } = mixed!;

  const source = page.locator(`.session-cell-filled[data-lane-id="${laneId}"][data-clip-idx="${filledClipIdx}"]`);
  const sourceColor = await source.evaluate((el) => (el as HTMLElement).style.backgroundColor);

  const target = page.locator(`.session-cell-empty[data-lane-id="${laneId}"][data-clip-idx="${emptyClipIdx}"]`);
  await dragCell(page, source, target);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');

  const restored = page.locator(`.session-cell[data-lane-id="${laneId}"][data-clip-idx="${filledClipIdx}"]`);
  await expect(restored).toHaveClass(/session-cell-filled/);
  const restoredColor = await restored.evaluate((el) => (el as HTMLElement).style.backgroundColor);
  expect(restoredColor).toBe(sourceColor);
});
