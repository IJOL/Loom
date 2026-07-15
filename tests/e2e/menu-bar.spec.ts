import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('menu bar shows the five top-level menus', async ({ page }) => {
  const tops = page.locator('#menu-bar .menubar-top');
  await expect(tops).toHaveText(['File', 'Edit', 'View', 'Tools', 'Help']);
});

test('File ▸ Import MIDI… opens the Import MIDI dialog; the old <details> is gone', async ({ page }) => {
  await expect(page.locator('details.midi-panel')).toHaveCount(0);
  await page.locator('#menu-bar .menubar-top', { hasText: 'File' }).click();
  await page.locator('.menubar-item', { hasText: 'Import MIDI' }).click();
  await expect(page.locator('#midi-import-dialog')).toBeVisible();
  await expect(page.locator('#midi-import-dialog #poly-midi-file')).toBeVisible();
});

test('Tools ▸ MIDI Controller… opens the dialog; the old <details> is gone', async ({ page }) => {
  await expect(page.locator('details.midi-control-panel')).toHaveCount(0);
  await page.locator('#menu-bar .menubar-top', { hasText: 'Tools' }).click();
  await page.locator('.menubar-item', { hasText: 'MIDI Controller' }).click();
  await expect(page.locator('#midi-control-dialog')).toBeVisible();
  await expect(page.locator('#midi-control-dialog #midi-control-enable')).toBeVisible();
});

test('the musicality chip opens Project Options and shows the project name', async ({ page }) => {
  await expect(page.locator('#musicality-bar')).toHaveCount(0);
  await page.locator('#toolbar-status-chips .status-chip').first().click();
  await expect(page.locator('#project-options-dialog')).toBeVisible();
  await expect(page.locator('#project-options-body input[data-po="name"]')).toBeVisible();
});

test('File ▸ Project Options… → rename persists in-session (reopen shows the new name)', async ({ page }) => {
  await page.locator('#menu-bar .menubar-top', { hasText: 'File' }).click();
  await page.locator('.menubar-item', { hasText: 'Project Options' }).click();
  const name = page.locator('#project-options-body input[data-po="name"]');
  await name.fill('E2E Project');
  await name.dispatchEvent('change');
  await page.locator('#project-options-dialog [data-dialog-close]').first().click();
  // Reopen and confirm it stuck in-session.
  await page.locator('#toolbar-status-chips .status-chip').first().click();
  await expect(page.locator('#project-options-body input[data-po="name"]')).toHaveValue('E2E Project');
});

test('File ▸ Preferences… is present but disabled (Part 2)', async ({ page }) => {
  await page.locator('#menu-bar .menubar-top', { hasText: 'File' }).click();
  await expect(page.locator('.menubar-item.is-disabled', { hasText: 'Preferences' })).toBeVisible();
});

test('Help ▸ About Loom shows the story with the build-time version and commit count', async ({ page }) => {
  await page.locator('#menu-bar .menubar-top', { hasText: 'Help' }).click();
  await page.locator('.menubar-item', { hasText: 'About' }).click();
  await expect(page.locator('#about-dialog')).toBeVisible();
  // Both are injected by vite `define`; an empty one means the build lost them.
  await expect(page.locator('#about-version')).toHaveText(/^v\d/);
  await expect(page.locator('#about-commits')).toHaveText(/commits$/);
});

test('the About easter egg stays hidden until the last line is clicked, and re-hides', async ({ page }) => {
  await page.locator('#menu-bar .menubar-top', { hasText: 'Help' }).click();
  await page.locator('.menubar-item', { hasText: 'About' }).click();

  const tell = page.locator('#about-tell');
  const truth = page.locator('#about-truth');

  // Assert VISIBILITY, not the `hidden` attribute: `.about-truth`'s own
  // `display: flex` outranks the UA's `[hidden] { display: none }`, so the
  // attribute can read "hidden" while the egg is spoiled on screen. That
  // shipped once — this is the assertion that would have caught it.
  await expect(truth).toBeHidden();

  await tell.click();
  await expect(truth).toBeVisible();
  await expect(tell).toHaveAttribute('aria-expanded', 'true');

  await tell.click();
  await expect(truth).toBeHidden();
});

// --- Visual-parity screenshots (for human review against the approved mockup) ---
test('visual-parity screenshots: menu open, toolbar chips, Project Options dialog', async ({ page }) => {
  // 1. File menu open, showing the menu bar + dropdown. The dropdown is
  // `position: absolute` and overflows `#menu-bar`'s own box, so a plain
  // element screenshot would crop it off — clip a page screenshot to the
  // union of the menu bar and the open dropdown instead.
  await page.locator('#menu-bar .menubar-top', { hasText: 'File' }).click();
  await expect(page.locator('.menubar-item', { hasText: 'Project Options' })).toBeVisible();
  const barBox = (await page.locator('#menu-bar').boundingBox())!;
  const dropdownBox = (await page.locator('#menu-bar .menubar-dropdown').boundingBox())!;
  const x = Math.min(barBox.x, dropdownBox.x);
  const y = Math.min(barBox.y, dropdownBox.y);
  const right = Math.max(barBox.x + barBox.width, dropdownBox.x + dropdownBox.width);
  const bottom = Math.max(barBox.y + barBox.height, dropdownBox.y + dropdownBox.height);
  await page.screenshot({
    path: '.superpowers/sdd/shot-menu-file-open.png',
    clip: { x, y, width: right - x, height: bottom - y },
  });
  await page.keyboard.press('Escape');

  // 2. Transport toolbar row with the two status chips.
  await page.locator('#toolbar-status-chips .status-chip').first().waitFor({ state: 'visible' });
  await page.locator('.row.transport').screenshot({ path: '.superpowers/sdd/shot-toolbar-chips.png' });

  // 3. Project Options dialog, opened via the musicality chip.
  await page.locator('#toolbar-status-chips .status-chip').first().click();
  await expect(page.locator('#project-options-dialog')).toBeVisible();
  await page.locator('#project-options-dialog').screenshot({ path: '.superpowers/sdd/shot-project-options.png' });
});
