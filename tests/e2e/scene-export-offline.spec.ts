// tests/e2e/scene-export-offline.spec.ts
//
// Offline export renders the current scene against an OfflineAudioContext at the
// EXACT bar-aligned musical length (no reverb tail) and then routes the result
// through the destination dialog: download a WAV, or drop it straight into a
// new — grid-locked — audio channel.
//
// The trigger is the unified REC group: pick the ⚡ offline mode, then press the
// REC button (the old standalone "↓ WAV" / #export-scene menu is gone). Offline
// runs immediately (no Play needed) and surfaces the destination dialog.
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

async function runOfflineExport(page: import('@playwright/test').Page): Promise<void> {
  // Select the ⚡ offline REC mode, then press REC → renders immediately.
  await page.locator('[data-recmode="offline"]').click();
  await page.locator('#rec').click();
}

test('offline export → dialog → "Download WAV" downloads a .wav', async ({ page }) => {
  await launchAScene(page);
  await runOfflineExport(page);

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

test('offline export → dialog → "New audio channel" creates a grid-locked audio channel', async ({ page }) => {
  await launchAScene(page);
  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  const lanesBefore = await page.locator('.session-lane-header').count();

  await runOfflineExport(page);
  await expect(page.locator('#take-dialog')).toBeVisible({ timeout: 30_000 });

  await page.locator('#take-dest-audio').click();
  await expect(page.locator('#take-dialog')).toBeHidden({ timeout: 5_000 });

  // A NEW 'audio' engine lane appears holding the render as a clip.
  await expect(page.locator('.lane-engine-audio')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.session-lane-header')).toHaveCount(lanesBefore + 1, { timeout: 5_000 });
});
