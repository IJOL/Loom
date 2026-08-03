import { test, expect } from '@playwright/test';
import { waitForBoot } from './helpers';

// The claim this whole slice rests on: any of the six engines can be deleted
// and the app still works. Serving an index without an id is exactly what
// deleting public/plugins/<id>/ does — the browser cannot list a directory, so
// that file IS the installed set.
//
// What must hold, and what used to fail: before this work an unregistered
// engine made its lane draw, take its row and make no sound WITHOUT SAYING SO.
// Unreachable while every engine shipped in the tree; routine once a folder can
// go missing.

/** The installed set minus one id, served in place of the real index. */
async function withoutPlugin(page: import('@playwright/test').Page, drop: string): Promise<void> {
  await page.route('**/plugins/index.json', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { plugins: string[] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ plugins: body.plugins.filter((p) => p !== drop) }),
    });
  });
}

test('the app boots with the TB-303 uninstalled, and says so instead of going quiet', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await withoutPlugin(page, 'tb303');
  await page.goto('/');
  await waitForBoot(page);

  // 1. It booted at all. A missing engine must not take the session down with
  //    it — the boot session names tb303 on its first lane.
  await expect(page.locator('#session-view, .session-grid').first()).toBeVisible();

  // 2. The engine is gone from the selector, because nothing registered it.
  const options = (await page.locator('#engine-select option').allTextContents()).join('|').toLowerCase();
  expect(options).not.toContain('303');

  // 3. The lane says why it is silent, FROM THE GRID — without opening it.
  //    This is the whole point and it is where the first version fell short:
  //    the notice existed only inside the lane editor, so a user looking at
  //    their session saw a track that mysteriously did not sound. Polled
  //    because plugins load asynchronously and the grid repaints on the report.
  await expect
    .poll(async () => page.locator('.session-lane-header-missing').count(), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect(page.locator('.session-lane-header-missing').first())
    .toHaveAttribute('title', /Engine not installed: tb303/);

  // 4. And the editor states it too, for whoever does open the lane.
  await page.locator('.session-lane-header-missing').first().click();
  await expect(page.locator('.lane-missing-engine')).toContainText('tb303');

  // 5. Nothing threw. A plugin that is absent is an ordinary state, not an
  //    error path.
  expect(errors).toEqual([]);
});

test('reinstalling brings the engine back with no trace of the outage', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // No interception: the real index, i.e. the plugin folder put back.
  await page.goto('/');
  await waitForBoot(page);

  await expect
    .poll(async () => (await page.locator('#engine-select option').allTextContents()).join('|'))
    .toContain('303');
  expect(await page.locator('.lane-missing-engine').count()).toBe(0);
  expect(errors).toEqual([]);
});
