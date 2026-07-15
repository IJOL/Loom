import { test, expect, type Page } from '@playwright/test';

// Reproductions for the Performance bugs reported 2026-07-15: copy the session's
// scenes into Performance, resize a band, press Play — the cursor starts in the
// wrong place / late, and the timeline renders wrong.
//
// WHY THE EXISTING PERFORMANCE TESTS MISS ALL OF THIS: every one of them does
// `goto('/')` → click Play immediately, so ctx.currentTime is ~0 and the drifting
// song position happens to be ~0 too. The bugs need TIME to pass — exactly what a
// human does and a test never did. These tests pause on purpose.

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

/** Count NOTES actually triggered, by tapping the worklet message port.
 *
 *  Counting createOscillator/createBufferSource (as the older Performance specs
 *  do) measures nothing here: synthesis lives in an AudioWorklet, so a lane's
 *  node is built once at allocation and every note afterwards is a `postMessage`
 *  to the processor — `{type:'spawn'}` for the melodic engines, `{type:'hit'}`
 *  for drums. Patching the prototype catches every lane's port. */
async function instrumentNotes(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __notes: number }).__notes = 0;
    const orig = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (this: MessagePort, msg: unknown, ...rest: unknown[]) {
      const t = (msg as { type?: string } | null)?.type;
      if (t === 'spawn' || t === 'hit') (window as unknown as { __notes: number }).__notes++;
      return (orig as (...a: unknown[]) => void).call(this, msg, ...rest);
    };
  });
}
const noteCount = (page: Page) => page.evaluate(() => (window as unknown as { __notes: number }).__notes);

const bandGeom = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('#performance-view-root .perf-clip-band')].map((b) =>
    [...b.querySelectorAll('.perf-clip')].map((c) => ({
      left: parseFloat((c as HTMLElement).style.left) || 0,
      width: parseFloat((c as HTMLElement).style.width) || 0,
    }))));

async function copyToPerformance(page: Page): Promise<void> {
  await page.locator('#copy-to-performance').click();
  await expect(page.locator('#performance-view-root .perf-clip').first()).toBeVisible();
}

/** Drag a band edge by `dx` px. The resize handler is pointer-event based, so a
 *  real mouse press/move/release is required — .click() won't do it. */
async function dragBandEdge(page: Page, bandIdx: number, dx: number): Promise<void> {
  const h = page.locator('#performance-view-root .perf-clip').nth(bandIdx).locator('.perf-clip-handle.r');
  const box = (await h.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// --- BUG 1: the song position drifts with wall-clock while the transport is stopped ---
// beginArrangement() derived "where to start" as `ctx.currentTime - songAnchorSec`.
// songAnchorSec is the ctx time the LAST playback began and nothing rebases it on
// stop, so the derived position keeps advancing while stopped. Play then seeks that
// far into the arrangement.

test('Performance: Play after a pause starts at the top, not at wall-clock elapsed', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await copyToPerformance(page);

  await page.locator('#play').click();
  await page.waitForTimeout(300);
  await page.locator('#stop').click();

  // The user thinks for a moment. The transport is stopped: the song position
  // must not move. ~2.5s is ≈1.35 bars at 130bpm ≈ 108px — far outside tolerance.
  await page.waitForTimeout(2500);

  await page.locator('#play').click();
  await page.waitForTimeout(200);

  const ph = (await page.locator('#perf-playhead').boundingBox())!;
  const track = (await page.locator('.perf-ruler .perf-track').boundingBox())!;
  expect(ph.x - track.x).toBeLessThan(40);
});

test('Performance: Play after a pause longer than the arrangement still sounds', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  // Shorten the arrangement in TIME by raising the tempo before copying, so the
  // pause below can exceed it without a 20-second test. 8 bars @240bpm (the input's
  // max) = 8.0s, so the 9s pause below lands past the end.
  await page.locator('#bpm').fill('240');
  await page.locator('#bpm').press('Enter');
  await copyToPerformance(page);
  await instrumentNotes(page);

  await page.locator('#play').click();
  await page.waitForTimeout(300);
  await page.locator('#stop').click();
  // Sanity: the first play must fire notes, or the pause below proves nothing.
  expect(await noteCount(page)).toBeGreaterThan(0);

  // Pause for longer than the whole arrangement. With the drift, Play seeks past
  // the end, every lane's cursor is left beyond its last event, and NOTHING fires.
  await page.waitForTimeout(9000);

  const before = await noteCount(page);
  await page.locator('#play').click();
  await page.waitForTimeout(900);
  expect(await noteCount(page)).toBeGreaterThan(before);
});

// --- BUG 2: durationSec is never recomputed after a band edit ---
// Only finalizeArrangement (a REC take) recomputes it, so after copy+resize the
// arrangement's idea of its own length is stale: bands render clipped against the
// old end and the ruler refuses to grow.

test('Performance: growing a band past the end is drawn in full, not clipped', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await copyToPerformance(page);

  const before = await bandGeom(page);
  const lane0 = before[0];
  expect(lane0.length).toBeGreaterThanOrEqual(2);
  const clipW = lane0[0].width;

  // Grow the first band by its own width (2 bars → 4). The last band on the lane
  // ripples past the old total; it must still be drawn at full width.
  await dragBandEdge(page, 0, clipW);

  const after = await bandGeom(page);
  expect(after[0][0].width).toBeGreaterThan(clipW * 1.5);
  const lastBefore = before[0][before[0].length - 1].width;
  const lastAfter = after[0][after[0].length - 1].width;
  expect(lastAfter).toBeCloseTo(lastBefore, 0);
});

test('Performance: the ruler grows when a band is pushed past the old end', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await copyToPerformance(page);

  const barsBefore = await page.locator('.perf-ruler .perf-track > *').count();
  const clipW = (await bandGeom(page))[0][0].width;
  await dragBandEdge(page, 0, clipW);
  const barsAfter = await page.locator('.perf-ruler .perf-track > *').count();

  expect(barsAfter).toBeGreaterThan(barsBefore);
});

test('Performance: stretching a band does not put a scrollbar on the lane', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await copyToPerformance(page);

  const clipW = (await bandGeom(page))[0][0].width;
  await dragBandEdge(page, 0, clipW);

  // The lane must grow with its content. When the timeline stayed at the stale
  // length the band overflowed its track and the browser put a horizontal
  // scrollbar on that one lane — the visible symptom the user reported.
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll('#performance-view-root .perf-clip-band')]
      .map((b) => b.scrollWidth - b.clientWidth));
  expect(Math.max(...overflow)).toBeLessThanOrEqual(0);
});

// --- BUG 3: the Length field reports the raw user-set length ---
// `lengthBars` is the explicit MINIMUM length (0 = auto/derive-from-content), so
// the field read "0 bars" over 8 bars of copied content.

test('Performance: the Length field reports the real length after a copy, not 0', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await copyToPerformance(page);

  const bars = await page.locator('.perf-ruler .perf-track > *').count();
  expect(bars).toBeGreaterThan(0);
  const len = await page.locator('#performance-view-root input[type=number]').first().inputValue();
  expect(parseInt(len, 10)).toBe(bars);
});
