import { test, expect } from '@playwright/test';

// Regression for the "click Save → no dialog, nothing happens, Load shows
// nothing" report. Save used a native `window.prompt`, which Chrome can
// silently suppress (after a "prevent additional dialogs" dismissal) — the
// click then no-ops with zero feedback and nothing is persisted. Save must
// instead use an in-app dialog (consistent with Load) so it is always visible,
// never silently fails, and is testable without native dialog handling.
test.describe('save manager — in-app save', () => {
  test('Save opens the in-app modal and persists a named save without a native prompt', async ({ page }) => {
    let nativeDialog = false;
    page.on('dialog', (d) => { nativeDialog = true; void d.dismiss().catch(() => {}); });

    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');

    // Wait for full session boot so the toolbar Save button is wired.
    await page.waitForSelector('button.session-lane-tab[data-lane-id]', { timeout: 15_000 });

    // Click the toolbar Save button.
    await page.locator('#save').click();

    // It must open the in-app save manager modal — not a native prompt.
    await expect(page.locator('#save-manager-modal')).toBeVisible({ timeout: 3_000 });

    // Type a name and confirm via the in-app control.
    const NAME = 'E2E In-App Save';
    await page.locator('#save-manager-name').fill(NAME);
    await page.locator('#save-manager-save').click();

    // The new save must be persisted and listed in the modal.
    await expect(page.locator('#save-manager-list')).toContainText(NAME, { timeout: 3_000 });
    const names = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('tb303-saves') || '[]').map((e: { name: string }) => e.name),
    );
    expect(names).toContain(NAME);

    // And it must never have used a native dialog.
    expect(nativeDialog, 'Save must not rely on a native window.prompt').toBe(false);
  });
});
