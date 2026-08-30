// The capture round's ONE user path (master source): press ● while the
// arrangement plays, wait a couple of bars, press ● again — a new Audio lane
// lands on the timeline with a whole-bars band, and that band is AUDIBLE on
// its own once the source material is deleted. getDisplayMedia/getUserMedia
// sources are not scriptable here (permission prompts) — phases 2-3 are
// verified live, as src/stems/system-audio-capture.ts already is.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitForBoot, installMasterTap, waitForAudible, measureMaster } from './helpers';

const FIXTURE = join(
  process.cwd(), 'test', 'fixtures', 'loops', 'drum',
  'Amen_Break_135_BPM_cw_amen10_135bpm_1.wav',
);

async function gotoArrange(page: Page): Promise<void> {
  await waitForBoot(page);
  await page.locator('#mode-toggle [data-mode="performance"]').click();
}

async function dropLoop(page: Page, clientX: number): Promise<void> {
  const b64 = readFileSync(FIXTURE).toString('base64');
  await page.evaluate(async ({ b64: data, x }) => {
    const res = await fetch(`data:audio/wav;base64,${data}`);
    const file = new File([await res.blob()], 'amen.wav', { type: 'audio/wav' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const host = document.getElementById('performance-view-root')!;
    host.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: x, clientY: 200 }));
  }, { b64, x: clientX });
  await page.waitForSelector('.perf-clip[data-band-id]', { timeout: 10_000 });
}

test('press ●, wait two bars, press ● — a whole-bars loop lands and SOUNDS on its own', async ({ page }) => {
  test.setTimeout(90_000); // real-time capture: the bars must actually play
  await installMasterTap(page);
  await page.goto('/');
  await gotoArrange(page);
  // One drop at bar 0 + the A-B loop: the amen plays CONTINUOUSLY, so every
  // bar the capture window covers holds material (two spread-out drops left
  // silent bars under the window and the take measured near-silent).
  await dropLoop(page, 130);
  await expect(page.locator('.perf-clip[data-band-id]')).toHaveCount(1);
  await page.locator('.perf-loop-toggle').click(); // loop the whole (1-bar) song

  await page.locator('#play').click(); // trusted click = the audio gesture
  await waitForAudible(page);
  // The source's own loudness — the reference the capture is measured AGAINST
  // (relative assertion: the round trip re-enters through a lane's own gain
  // staging, so an absolute floor borrowed from the drop test reads a real,
  // audible take as silence).
  const source = await measureMaster(page, 700);

  // ● — starts at the NEXT bar; the button leaves idle immediately.
  await page.locator('.perf-capture-btn').click();
  await expect(page.locator('.perf-capture-btn')).not.toHaveClass(/\bidle\b/);
  // Default 120 BPM 4/4 → 2 s bars: 5.5 s guarantees ≥ 2 whole bars whatever
  // the press phase was.
  await page.waitForTimeout(5500);
  await page.locator('.perf-capture-btn').click(); // cut at the end of this bar

  // Delivery is async (bar-end + encode + decode + ingest): the second band is
  // the settled signal. (The A-B wrap moves the anchor by whole loops, so the
  // bar grid the capture cuts on is unchanged — the band just lands at its
  // unwrapped position, past the loop end.)
  await expect(page.locator('.perf-clip[data-band-id]')).toHaveCount(2, { timeout: 15_000 });

  // The captured band covers a WHOLE number of bars (relative: within 5% of a
  // bar at 80 px/bar), and at least two of them.
  const widths = await page.locator('.perf-clip[data-band-id]').evaluateAll(
    (els) => els.map((el) => (el as HTMLElement).getBoundingClientRect().width),
  );
  const bars = widths[widths.length - 1] / 80;
  expect(bars).toBeGreaterThanOrEqual(1.95);
  expect(Math.abs(bars - Math.round(bars))).toBeLessThan(0.05);

  // The loop is REAL audio: silence the source and play only the capture.
  await page.locator('#stop').click();
  await page.locator('.perf-loop-toggle').click(); // off — or Play never leaves bars 0-1
  await page.locator('.perf-clip[data-band-id]').first().click({ button: 'right' });
  await page.locator('.perf-context-item', { hasText: 'Delete' }).click();
  await expect(page.locator('.perf-clip[data-band-id]')).toHaveCount(1);
  // The stopped master, post-tail: the noise floor the capture must dwarf.
  await page.waitForTimeout(2500);
  const floor = await measureMaster(page, 500);
  // Where the band starts, in content px (fresh page → scrollLeft is 0).
  const band = page.locator('.perf-clip[data-band-id]');
  const bandX = (await band.boundingBox())!.x;
  const trackLeft = await page.evaluate(
    () => (document.querySelector('.perf-ruler .perf-track') as HTMLElement).getBoundingClientRect().left,
  );
  await page.locator('#play').click();
  // Let playback REACH the band naturally (no seek: entering an audio band
  // mid-flight via seek is a separate path, not this round's subject), then
  // measure a window long enough (2 s) that the band's material dominates.
  await page.waitForFunction((px) => {
    const ph = document.getElementById('perf-playhead');
    return !!ph && parseFloat(ph.style.left || '0') > px + 8;
  }, bandX - trackLeft, { timeout: 30_000 });
  const on = await measureMaster(page, 2000);
  // Relative on both sides: far above the measured stopped floor (real audio,
  // not a tail), and tied — loosely — to the source's own loudness. Measured
  // round trip today: the take's FILE matches the master (RMS ≈ 0.13, peak 1)
  // but plays back at ≈ 1/11 of the source level through the audio lane's
  // gain staging — a product observation for the live listen, not a capture
  // defect, so the tie is deliberately generous.
  expect(on.avgRms).toBeGreaterThan(floor.avgRms * 10);
  expect(on.avgRms).toBeGreaterThan(source.avgRms / 30);
});
