// tests/e2e/scene-export.spec.ts
import { test, expect } from '@playwright/test';
import { statSync } from 'node:fs';

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('exports the current scene to a .wav download', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Launch one clip so a scene is sounding (the click also resumes audio).
  await page.locator('.session-cell-filled .session-cell-play').first().click();
  await expect(page.locator('.session-cell-playing').first()).toBeVisible({ timeout: 2000 });

  // Export. The download fires after the real-time capture window completes
  // (one clip pass + 2s tail), so allow generous time.
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#export-scene').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^loom-scene-.*\.wav$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  expect(statSync(filePath!).size).toBeGreaterThan(44); // header + some PCM
});
