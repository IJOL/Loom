import { test, expect, type Page } from '@playwright/test';

// Reproduction tests for the three Performance-mode bugs reported by the user:
//  1. Performance playback makes no sound (the sequencer engine never starts in
//     Performance, so tickArrangement/tickSession never run → no audio nodes).
//  2. Copy-to-Performance clip bands show raw clip ids ("clip-…") not names.
//  3. The Play button doesn't stop the playhead (seq.isPlaying() stays false in
//     Performance, so the toggle keeps re-starting instead of stopping).

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

/** Patch the AudioContext prototype to count scheduled source nodes. Must run
 *  before playback. Counts node CREATION (independent of suspended state). */
async function instrumentAudio(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __srcCount: number }).__srcCount = 0;
    const ctors = [window.AudioContext, (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext];
    for (const C of ctors) {
      if (!C) continue;
      const proto = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
      for (const m of ['createOscillator', 'createBufferSource']) {
        const orig = proto[m];
        if (typeof orig !== 'function') continue;
        proto[m] = function (this: unknown, ...args: unknown[]) {
          (window as unknown as { __srcCount: number }).__srcCount++;
          return orig.apply(this, args);
        };
      }
    }
  });
}

const srcCount = (page: Page) => page.evaluate(() => (window as unknown as { __srcCount: number }).__srcCount);
const playheadLeft = (page: Page) =>
  page.evaluate(() => {
    const el = document.getElementById('perf-playhead');
    return el ? parseFloat(el.style.left || '0') : NaN;
  });

test('Performance playback schedules audio (currently SILENT — bug 1)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await instrumentAudio(page);
  await page.locator('#copy-to-performance').click();
  await expect(page.locator('#performance-view-root .perf-clip').first()).toBeVisible();
  await page.locator('#play').click();
  await page.waitForTimeout(900);
  const scheduled = await srcCount(page);
  // BUG 1: stays 0 because the sequencer engine never starts in Performance.
  expect(scheduled).toBeGreaterThan(0);
});

test('Performance: the Play button stops the playhead (bug 3)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('#copy-to-performance').click();
  await expect(page.locator('#performance-view-root .perf-clip').first()).toBeVisible();
  await page.locator('#play').click();                 // start
  await page.waitForTimeout(400);
  await page.locator('#play').click();                 // press again → expect STOP
  await page.waitForTimeout(250);
  const a = await playheadLeft(page);
  await page.waitForTimeout(350);
  const b = await playheadLeft(page);
  // BUG 3: the playhead keeps advancing because the toggle re-started instead of
  // stopping (seq.isPlaying() never becomes true in Performance).
  expect(b).toBeCloseTo(a, 1);
});

test('Performance: clip bands show readable names, not raw ids (bug 2)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('#copy-to-performance').click();
  await expect(page.locator('#performance-view-root .perf-clip').first()).toBeVisible();
  const names = await page.locator('#performance-view-root .perf-clip').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) {
    // BUG 2: bands render the generated clip id like "clip-lq3k4-2".
    expect(n.trim()).not.toMatch(/^clip-/);
  }
});

test('Performance: playhead lines up with bar 1 and the ruler (not host padding / over the toolbar)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('#copy-to-performance').click();
  await expect(page.locator('#performance-view-root .perf-clip').first()).toBeVisible();
  await page.locator('#play').click();
  await page.waitForTimeout(120);
  const ph = await page.locator('#perf-playhead').boundingBox();
  const track = await page.locator('.perf-ruler .perf-track').boundingBox();
  if (!ph || !track) throw new Error('boxes not found');
  // Horizontal: the cursor is at/after bar 1's left edge — not ~20px to the left
  // (the host-padding bug put it there).
  expect(ph.x).toBeGreaterThanOrEqual(track.x - 2);
  expect(ph.x).toBeLessThan(track.x + 240); // still near the start so soon after play
  // Vertical: the cursor starts at the ruler, not up over the toolbar (the top:26px
  // bug started it above the tracks).
  expect(ph.y).toBeGreaterThanOrEqual(track.y - 2);
});

test('Performance: enabling Loop A–B does not add a scrollbar to the ruler', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('#copy-to-performance').click();
  await page.locator('.perf-loop-toggle').click();
  await expect(page.locator('.perf-loop-brace')).toBeVisible();
  // A horizontal scrollbar would shrink the track's clientHeight below its
  // offsetHeight; overflow:hidden on the ruler track keeps them equal.
  const scrollbarPx = await page.locator('.perf-ruler .perf-track')
    .evaluate((el) => el.offsetHeight - el.clientHeight);
  expect(scrollbarPx).toBeLessThanOrEqual(0);
});
