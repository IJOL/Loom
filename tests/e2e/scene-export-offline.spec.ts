// tests/e2e/scene-export-offline.spec.ts
//
// Offline export renders the current scene against an OfflineAudioContext at the
// EXACT bar-aligned musical length (no reverb tail) and then routes the result
// through the same destination dialog as the live take: download a WAV, or drop
// it straight into a new — grid-locked — audio channel.
import { test, expect } from '@playwright/test';
import { statSync } from 'node:fs';

async function launchAScene(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
  // Launch one clip so a scene is sounding (also resumes the AudioContext).
  await page.locator('.session-cell-filled .session-cell-play').first().click();
  await expect(page.locator('.session-cell-playing').first()).toBeVisible({ timeout: 2000 });
}

test('offline export → dialog → "Descargar WAV" downloads a .wav', async ({ page }) => {
  await launchAScene(page);

  await page.locator('#export-scene').click();
  await page.locator('#export-offline').click();

  // The render finishes, then the destination dialog appears.
  await expect(page.locator('#take-dialog')).toBeVisible({ timeout: 30_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
  await page.locator('#take-dest-file').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^loom-take-.*\.wav$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  expect(statSync(filePath!).size).toBeGreaterThan(44);
});

test('offline export → dialog → "Nuevo canal de audio" creates a grid-locked audio channel', async ({ page }) => {
  await launchAScene(page);
  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  const lanesBefore = await page.locator('button.session-lane-tab').count();

  await page.locator('#export-scene').click();
  await page.locator('#export-offline').click();
  await expect(page.locator('#take-dialog')).toBeVisible({ timeout: 30_000 });

  await page.locator('#take-dest-audio').click();
  await expect(page.locator('#take-dialog')).toBeHidden({ timeout: 5_000 });

  // A NEW 'audio' engine lane appears holding the render as a clip.
  await expect(page.locator('.lane-engine-audio')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore + 1, { timeout: 5_000 });
});
