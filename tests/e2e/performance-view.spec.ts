import { test, expect } from '@playwright/test';

// Exercises the Performance View: mode toggle, empty-state path, REC arming,
// and the full record→surface round-trip (arm REC → launch a scene → stop →
// switch to Performance → the recorded take renders as clip bands). The
// round-trip drives a real audio-context boundary cycle, so it uses a
// generous wait for the launched clips to promote and get captured.

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('Session is visible on boot; Performance is hidden', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  await expect(page.locator('#session-view-root')).toBeVisible();
  await expect(page.locator('#performance-view-root')).toBeHidden();
});

test('switching to Performance shows the empty-state placeholder', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  await page.locator('[data-mode="performance"]').click();

  // The performance root should now be visible.
  await expect(page.locator('#performance-view-root')).toBeVisible();
  await expect(page.locator('#session-view-root')).toBeHidden();

  // With no recording, the empty-state div is rendered.
  const emptyState = page.locator('.perf-empty');
  await expect(emptyState).toBeVisible({ timeout: 3_000 });
  await expect(emptyState).toContainText('No recording.');
  // No clip blocks should exist.
  await expect(page.locator('.perf-clip')).toHaveCount(0);
});

test('switching back to Session hides Performance and shows session grid', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Go to Performance then come back.
  await page.locator('[data-mode="performance"]').click();
  await expect(page.locator('#performance-view-root')).toBeVisible();

  await page.locator('[data-mode="session"]').click();
  await expect(page.locator('#session-view-root')).toBeVisible();
  await expect(page.locator('#performance-view-root')).toBeHidden();

  // The session grid should have at least one filled cell (boot demo loads clips).
  await expect(page.locator('.session-cell-filled').first()).toBeVisible();
});

test('arming and disarming REC toggles the .armed class on the button', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const recBtn = page.locator('#rec');

  // Initially not armed.
  await expect(recBtn).not.toHaveClass(/armed/);

  // Arm it.
  await recBtn.click();
  await expect(recBtn).toHaveClass(/armed/);

  // Disarm it.
  await recBtn.click();
  await expect(recBtn).not.toHaveClass(/armed/);
});

test('record a take → Performance surfaces the recorded clip bands', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Start the transport (a trusted click resumes the AudioContext), then arm REC.
  // Armed + already playing → recording starts immediately.
  await page.locator('#play').click();
  await page.locator('#rec').click();
  await expect(page.locator('#rec')).toHaveClass(/armed/);

  // Launch a scene so its clips get captured as they promote on the next boundary.
  await page.locator('.session-scene-launch').first().click();
  await page.waitForTimeout(3000);

  // Disarm REC — this finalizes the take (clamps open clip events, sets durationSec).
  await page.locator('#rec').click();

  // Switch to Performance: the take must now render, NOT the empty-state.
  await page.locator('[data-mode="performance"]').click();
  await expect(page.locator('#performance-view-root')).toBeVisible();
  await expect(page.locator('.perf-empty')).toHaveCount(0);
  await expect(page.locator('.perf-clip').first()).toBeVisible({ timeout: 3_000 });
  expect(await page.locator('.perf-clip').count()).toBeGreaterThan(0);
});

test('set length → add an automation lane → draw → it persists', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('[data-mode="performance"]').click();

  // Leave the empty-state by setting a length (no recording needed).
  const len = page.locator('.perf-length-input');
  await len.fill('4');
  await len.dispatchEvent('change');

  // Toolbar present; pick a param and add a lane.
  await expect(page.locator('.perf-toolbar')).toBeVisible();
  const sel = page.locator('.perf-auto-param-select').first();
  await sel.selectOption({ index: 0 });
  await page.locator('.perf-auto-header .rnd.primary').first().click();

  // An editable lane canvas should now exist; draw on it.
  const canvas = page.locator('.perf-auto-canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 });
  await page.mouse.up();

  // The lane survives a re-render (zoom change).
  await page.locator('.perf-zoom').fill('120');
  await page.locator('.perf-zoom').dispatchEvent('input');
  await expect(page.locator('.perf-auto-canvas').first()).toBeVisible();
});
