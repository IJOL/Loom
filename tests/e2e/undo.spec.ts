import { test, expect } from '@playwright/test';

// Verifies the undo/redo keyboard shortcuts are wired end-to-end.
// Mutation: Add Scene (session-add-scene button) — always visible on the session
// grid without any extra navigation. Adding a scene appends a .session-scene-launch
// button; Ctrl+Z removes it; Ctrl+Shift+Z restores it.
//
// We wait for the async demo boot (minimal-techno.json) to settle before
// interacting, matching the pattern used in lane-ui.spec.ts.

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('Ctrl+Z reverts an Add Scene mutation', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Verify the session grid is visible.
  await expect(page.locator('.session-grid-root').first()).toBeVisible();

  // Capture initial scene-launch button count (4 in the minimal-techno demo).
  const beforeCount = await page.locator('.session-scene-launch').count();
  expect(beforeCount).toBeGreaterThan(0);

  // Click the Add Scene button.
  await page.locator('.session-add-scene').first().click();

  // Scene count should have increased by 1.
  await expect(page.locator('.session-scene-launch')).toHaveCount(beforeCount + 1);

  // Press Ctrl+Z. Blur any focused element first so the keydown lands on
  // document (not inside a text input, which the handler ignores).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');

  // Scene count should revert to the original.
  await expect(page.locator('.session-scene-launch')).toHaveCount(beforeCount);
});

test('Ctrl+Shift+Z redoes the Add Scene mutation', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const beforeCount = await page.locator('.session-scene-launch').count();

  // Mutate then undo.
  await page.locator('.session-add-scene').first().click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await expect(page.locator('.session-scene-launch')).toHaveCount(beforeCount);

  // Redo — count should go back up.
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.session-scene-launch')).toHaveCount(beforeCount + 1);
});
