// Swapping a lane's instrument while it is PLAYING.
//
// The failure this is looking for has a very specific shape, reported twice: one
// channel goes on sounding for ever, the transport's stop does nothing to it,
// and the only thing that silences it is that lane's own mute. An orphaned
// worklet node does exactly that — the stop reaches the engine the lane now
// has, while the old one keeps rendering into the same channel strip, which is
// why the fader and the mute still work on it.
//
// Measured at the master, because no DOM assertion can see it: the UI shows one
// engine and the graph holds two.
import { test, expect, type Page } from '@playwright/test';
import { installMasterTap, measureMaster, waitForAudible, waitForBoot } from './helpers';

const WEAVE_TAB = '#mode-toggle .mode-btn[data-mode="weave"]';
const PANEL = '#panel-view-weave';
const LANE = '303 1';

function row(page: Page) {
  return page.locator(`${PANEL} .weave-lane-wrap`)
    .filter({ has: page.locator('.weave-lane-name', { hasText: LANE }) })
    .first();
}

test('swapping the instrument mid-play leaves nothing behind', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await installMasterTap(page);
  await page.goto('/');
  await waitForBoot(page);

  await page.locator('.session-scene-launch').first().click();
  await waitForAudible(page);

  await page.locator(WEAVE_TAB).click();
  await expect(page.locator(`${PANEL} .weave-rack`)).toBeVisible();

  // Three swaps while the music runs — an orphan left by any one of them keeps
  // rendering, and three makes the residue big enough to measure rather than
  // arguable.
  const r = row(page);
  for (const id of ['westcoast', 'fm', 'westcoast']) {
    await r.locator('select.weave-engine').selectOption(id);
    await page.waitForTimeout(900);
  }

  const playing = await measureMaster(page, 800);
  expect(playing.peak).toBeGreaterThan(0.01);

  await page.locator('#stop').click();
  await page.waitForTimeout(1500);
  const stopped = await measureMaster(page, 1500);

  // Nothing may outlive the stop. Relative, per the project's rule.
  expect(stopped.peak).toBeLessThan(playing.peak * 0.1);

  // And the session still plays afterwards. Reported after a swap that killed a
  // stuck lane: "ahora ya no hace play". A swap that leaves the transport
  // unable to start again trades one silence for another.
  //
  // Back to the Session view first: the scene launches live there, and a
  // locator that resolves to a hidden element waits out the whole timeout
  // saying "element is not visible" — which reads exactly like the bug.
  await page.locator('#mode-toggle .mode-btn[data-mode="session"]').click();
  await page.locator('.session-scene-launch').first().click();
  await waitForAudible(page);
  const again = await measureMaster(page, 800);
  expect(again.peak).toBeGreaterThan(playing.peak * 0.1);

  expect(errors).toEqual([]);
});
