import { test, expect, type Page } from '@playwright/test';

// Front A · session management e2e. Each case codifies a behaviour the front
// introduced: ✕ delete crosses (clip/lane/scene), confirm-only-when-content,
// "lane born empty", the ▶-always-present guarantee, context menus, and undo of
// a lane delete. The confirmation is Loom's own <dialog> facility (#app-dialog),
// NOT a native window.confirm — so we drive it by clicking #app-dialog-ok, never
// page.on('dialog').

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

async function laneIds(page: Page): Promise<string[]> {
  return page.locator('.session-lane-header').evaluateAll(
    (els) => els.map((e) => (e as HTMLElement).dataset.laneId!),
  );
}

/** Add a lane via the tab-bar engine picker + '+' button; return its new id. */
async function addLane(page: Page, engineId = 'subtractive'): Promise<string> {
  const before = new Set(await laneIds(page));
  await page.locator('.session-lane-add').click();
  await page.locator(`.session-add-item[data-engine-id="${engineId}"]`).click();
  await expect(page.locator('.session-lane-header')).toHaveCount(before.size + 1);
  const created = (await laneIds(page)).find((id) => !before.has(id));
  if (!created) throw new Error('addLane: could not identify the new lane');
  return created;
}

/** Lane id of the first filled clip in the demo (a lane that has content). */
async function laneOfFirstClip(page: Page): Promise<string> {
  const id = await page.evaluate(
    () => (document.querySelector('.session-cell-filled') as HTMLElement | null)?.dataset.laneId ?? null,
  );
  if (!id) throw new Error('no filled cell at boot');
  return id;
}

test('1) the ✕ deletes a clip directly, with no confirmation', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const before = await page.locator('.session-cell-filled').count();
  const first = page.locator('.session-cell-filled').first();
  const laneId = await first.getAttribute('data-lane-id');
  const clipIdx = await first.getAttribute('data-clip-idx');

  await first.locator('.session-del-cross').click();

  await expect(page.locator('.session-cell-filled')).toHaveCount(before - 1);
  await expect(
    page.locator(`.session-cell[data-lane-id="${laneId}"][data-clip-idx="${clipIdx}"]`),
  ).toHaveClass(/session-cell-empty/);
  // A single clip is deleted directly — no confirm dialog.
  await expect(page.locator('#app-dialog[open]')).toHaveCount(0);
});

test('2) deleting a lane WITH content confirms; accepting removes it cleanly', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForBoot(page);

  const laneId = await laneOfFirstClip(page);
  const header = page.locator(`.session-lane-header[data-lane-id="${laneId}"]`);
  await header.locator('.session-del-cross').click();

  // Loom's own modal appears (it has content) — accept it.
  await expect(page.locator('#app-dialog[open]')).toHaveCount(1);
  await page.locator('#app-dialog-ok').click();

  await expect(page.locator(`.session-lane-header[data-lane-id="${laneId}"]`)).toHaveCount(0);
  // Disposing the lane must not leave dangling triggers ("no resource" / stripFor).
  expect(errors.filter((e) => /no resource|stripFor/i.test(e))).toEqual([]);
});

test('3) deleting an EMPTY lane skips the confirmation', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const newId = await addLane(page, 'subtractive'); // born empty
  const header = page.locator(`.session-lane-header[data-lane-id="${newId}"]`);
  await header.locator('.session-del-cross').click();

  // No content → no dialog; the column disappears immediately.
  await expect(page.locator(`.session-lane-header[data-lane-id="${newId}"]`)).toHaveCount(0);
  await expect(page.locator('#app-dialog[open]')).toHaveCount(0);
});

test('4) deleting a scene WITH content confirms and drops the scene count', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const before = await page.locator('.session-scene-launch').count();
  expect(before).toBeGreaterThan(1);

  // Delete the scene on the row that holds the first filled clip (so it has content).
  const row = await page.evaluate(
    () => Number((document.querySelector('.session-cell-filled') as HTMLElement).dataset.clipIdx),
  );
  await page.locator('.session-scene-cell').nth(row).locator('.session-del-cross').click();

  await expect(page.locator('#app-dialog[open]')).toHaveCount(1);
  await page.locator('#app-dialog-ok').click();

  await expect(page.locator('.session-scene-launch')).toHaveCount(before - 1);
});

test('5) a new instrument lane is born empty (no phantom clips)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const newId = await addLane(page, 'subtractive');
  await expect(page.locator(`.session-cell-filled[data-lane-id="${newId}"]`)).toHaveCount(0);
  // …yet the session still has at least one launchable scene (minimum-scene seed).
  await expect(page.locator('.session-scene-launch').first()).toBeVisible();
});

test('6) every clip row keeps a ▶ even when clips grow past the scene count', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const scenesBefore = await page.locator('.session-scene-launch').count();

  // Open a clip in the inspector, then duplicate it past the original scene count.
  const first = page.locator('.session-cell-filled').first();
  const laneId = await first.getAttribute('data-lane-id');
  await first.click(); // cell-body click opens the inspector (no launch)
  await expect(page.locator('#session-inspector')).toBeVisible();

  const dup = page.locator('#insp-duplicate');
  for (let i = 0; i < scenesBefore + 1; i++) await dup.click();

  // Each appended clip must have seeded a launchable scene: scenes grew, and the
  // grid has at least as many ▶ as the lane has clips (no orphaned, ▶-less rows).
  const clips = await page.locator(`.session-cell-filled[data-lane-id="${laneId}"]`).count();
  const scenesAfter = await page.locator('.session-scene-launch').count();
  expect(scenesAfter).toBeGreaterThan(scenesBefore);
  expect(scenesAfter).toBeGreaterThanOrEqual(clips);
});

test('7) right-click on a lane header offers "Delete track" and deletes it', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const newId = await addLane(page, 'subtractive'); // empty → delete needs no confirm
  const header = page.locator(`.session-lane-header[data-lane-id="${newId}"]`);
  await header.click({ button: 'right' });

  const menu = page.locator('.context-menu');
  await expect(menu).toBeVisible();
  const del = menu.locator('.context-menu-item.danger', { hasText: 'Delete track' });
  await expect(del).toBeVisible();
  await del.click();

  await expect(page.locator(`.session-lane-header[data-lane-id="${newId}"]`)).toHaveCount(0);
});

test('8) undo restores a deleted lane and its clip relaunches without "no resource"', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForBoot(page);

  const laneId = await laneOfFirstClip(page);
  const header = page.locator(`.session-lane-header[data-lane-id="${laneId}"]`);
  await header.locator('.session-del-cross').click();
  await expect(page.locator('#app-dialog[open]')).toHaveCount(1);
  await page.locator('#app-dialog-ok').click();
  await expect(page.locator(`.session-lane-header[data-lane-id="${laneId}"]`)).toHaveCount(0);

  // Undo (session mode). Blur first so the keydown lands on document, not an input.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await expect(page.locator(`.session-lane-header[data-lane-id="${laneId}"]`)).toHaveCount(1);

  // The restored lane must have its audio resource back — relaunching its clip plays.
  await page.locator(`.session-cell-filled[data-lane-id="${laneId}"] .session-cell-play`).first().click();
  await expect(
    page.locator(`.session-cell-playing[data-lane-id="${laneId}"]`).first(),
  ).toBeVisible({ timeout: 2000 });
  expect(errors.filter((e) => /no resource|stripFor/i.test(e))).toEqual([]);
});
