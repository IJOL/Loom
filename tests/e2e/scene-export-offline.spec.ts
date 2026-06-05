// tests/e2e/scene-export-offline.spec.ts
import { test, expect } from '@playwright/test';
import { statSync } from 'node:fs';

test('offline export downloads a .wav for the current scene', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );

  // Launch one clip so a scene is sounding (also resumes the AudioContext).
  await page.locator('.session-cell-filled .session-cell-play').first().click();
  await expect(page.locator('.session-cell-playing').first()).toBeVisible({ timeout: 2000 });

  // Open the export menu and pick Offline.
  await page.locator('#export-scene').click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#export-offline').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^loom-scene-.*\.wav$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  expect(statSync(filePath!).size).toBeGreaterThan(44);
});
