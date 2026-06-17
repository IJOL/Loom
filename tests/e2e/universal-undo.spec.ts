import { test, expect } from '@playwright/test';

// Verifies the header #undo-btn / #redo-btn are wired end-to-end.
// These complement the keyboard-shortcut tests in undo.spec.ts — we test
// the same undo mechanism through the clickable buttons in the toolbar.
//
// Mutation chosen: Add Scene (session-add-scene) — always visible on the
// session grid without any extra navigation, deterministic, selector-friendly.
// Pattern mirrors undo.spec.ts + session-management.spec.ts (waitForBoot,
// .session-scene-launch count, .session-add-scene, addLane helpers).

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

async function laneIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('.session-lane-header').evaluateAll(
    (els) => els.map((e) => (e as HTMLElement).dataset.laneId!),
  );
}

async function addLane(
  page: import('@playwright/test').Page,
  engineId = 'subtractive',
): Promise<string> {
  const before = new Set(await laneIds(page));
  await page.locator('select.session-tabs-engine').selectOption(engineId);
  await page.locator('button.session-tabs-add-btn').click();
  await expect(page.locator('.session-lane-header')).toHaveCount(before.size + 1);
  const created = (await laneIds(page)).find((id) => !before.has(id));
  if (!created) throw new Error('addLane: could not identify the new lane');
  return created;
}

test('header #undo-btn reverts an Add Scene mutation', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Verify session grid is visible.
  await expect(page.locator('.session-grid-root').first()).toBeVisible();

  // Both buttons must exist in the DOM.
  await expect(page.locator('#undo-btn')).toBeVisible();
  await expect(page.locator('#redo-btn')).toBeVisible();

  // Capture initial scene count (4 in the minimal-techno demo).
  const beforeCount = await page.locator('.session-scene-launch').count();
  expect(beforeCount).toBeGreaterThan(0);

  // At boot, undo should be disabled (nothing to undo yet).
  await expect(page.locator('#undo-btn')).toBeDisabled();

  // Add a scene — this is the mutation.
  await page.locator('.session-add-scene').first().click();
  await expect(page.locator('.session-scene-launch')).toHaveCount(beforeCount + 1);

  // After mutation, undo button must be enabled.
  await expect(page.locator('#undo-btn')).toBeEnabled();

  // Click the header Undo button.
  await page.locator('#undo-btn').click();

  // Scene count must revert to original.
  await expect(page.locator('.session-scene-launch')).toHaveCount(beforeCount);

  // After undo, redo button must be enabled.
  await expect(page.locator('#redo-btn')).toBeEnabled();
});

test('header #redo-btn re-applies the undone Add Scene mutation', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const beforeCount = await page.locator('.session-scene-launch').count();

  // Mutate then undo via button.
  await page.locator('.session-add-scene').first().click();
  await expect(page.locator('#undo-btn')).toBeEnabled();
  await page.locator('#undo-btn').click();
  await expect(page.locator('.session-scene-launch')).toHaveCount(beforeCount);

  // Now redo — scene count goes back up.
  await expect(page.locator('#redo-btn')).toBeEnabled();
  await page.locator('#redo-btn').click();
  await expect(page.locator('.session-scene-launch')).toHaveCount(beforeCount + 1);
});

test('header #undo-btn reverts an Add Lane mutation', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const beforeCount = (await laneIds(page)).length;
  expect(beforeCount).toBeGreaterThan(0);

  // Add a lane via the tab-bar '+' button.
  await addLane(page, 'subtractive');
  await expect(page.locator('.session-lane-header')).toHaveCount(beforeCount + 1);

  // After mutation, undo button must be enabled.
  await expect(page.locator('#undo-btn')).toBeEnabled();

  // Click the header Undo button.
  await page.locator('#undo-btn').click();

  // Lane count must revert to original.
  await expect(page.locator('.session-lane-header')).toHaveCount(beforeCount);

  // After undo, redo button must be enabled.
  await expect(page.locator('#redo-btn')).toBeEnabled();
});
