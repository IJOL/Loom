import { test, expect, type Page } from '@playwright/test';
import { installMasterTap, measureMaster, waitForAudible, waitForBoot } from './helpers';

// Does the app actually make sound? Every other spec asserts DOM; this one taps
// the master bus and measures the signal, which is the only way to catch a UI
// change that quietly stops reaching the audio graph. Since synthesis moved
// into the AudioWorklet there are no per-note source nodes left to count, so
// node-counting cannot answer this question at all.
//
// Thresholds are deliberately coarse — audible-vs-silent and clipping-vs-not,
// not a fixed level, which would break the moment a preset is retuned.

test('launching a scene produces continuous, unclipped audio on master', async ({ page }) => {
  await installMasterTap(page);
  await page.goto('/');
  await waitForBoot(page);

  // A trusted click is what resumes the AudioContext; a synthetic one does not.
  await page.locator('.session-scene-launch').first().click();
  // The launch is quantized to the next bar, so measure from the first sound
  // rather than from a fixed clock — a flat wait shorter than the bar counts the
  // pre-roll as dropouts. See `waitForAudible`.
  await waitForAudible(page);

  const levels = await measureMaster(page, 3000);

  expect(levels.frames).toBeGreaterThan(30);
  expect(levels.peak).toBeGreaterThan(0.01);          // it sounds
  expect(levels.peak).toBeLessThanOrEqual(1);         // and does not clip
  expect(levels.avgRms).toBeGreaterThan(0);
  // Dropouts read as inaudible frames mid-playback. A handful can straddle a
  // loop seam; a run of them is the "cortes" failure this guards against.
  expect(levels.nearSilent).toBeLessThan(levels.frames * 0.1);
});

test('the transport Stop button silences the master', async ({ page }) => {
  await installMasterTap(page);
  await page.goto('/');
  await waitForBoot(page);

  await page.locator('.session-scene-launch').first().click();
  // Same quantized-launch hazard as above: at 130 BPM the old flat 1200ms wait
  // ended BEFORE the bar boundary at 1846ms, so this measured mostly pre-roll
  // and passed only on the tail of its own window.
  await waitForAudible(page);
  const playing = await measureMaster(page, 800);
  expect(playing.peak).toBeGreaterThan(0.01);

  await page.locator('#stop').click();
  await page.waitForTimeout(600);    // let release tails finish
  const stopped = await measureMaster(page, 800);
  // Relative, per the project's assertion rule: silence is orders of magnitude
  // below what was playing, rather than an absolute floor.
  expect(stopped.peak).toBeLessThan(playing.peak * 0.1);
});
