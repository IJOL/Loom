import { test, expect, type Page } from '@playwright/test';

// Slice A's REAL acceptance proof — deleting the `listedInSelector` capability
// (a host-menu decision that had leaked into the manifest as an engine
// property) unblocked this: a plugin declaring `capabilities.clipContent:
// 'audio'` must be reachable from the "add lane" menu like any other engine,
// and creating a lane from it must actually produce an audio-channel lane.
//
// Before this fix, audio-probe copied `listedInSelector: false` from the
// built-in `audio` engine's declaration and was UNREACHABLE from every user
// path — the menu never offered it, so nothing could ever create it. The old
// version of this test only checked the probe's ABSENCE from #engine-select,
// which cannot tell "the host honoured a capability" apart from "the plugin
// never loaded" — and it asserted the very bug (unreachability) as if it were
// the feature.
async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('a plugin that declares itself an audio channel can be created and behaves like one', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await waitForBoot(page);

  // 1. The probe is published and its index entry is real.
  const ids = await page.evaluate(async () => (await (await fetch('plugins/index.json')).json()).plugins);
  expect(ids).toContain('audio-probe');

  // 2. The "+" add-lane menu OFFERS it — this is what the deleted capability
  //    was blocking. Its name comes from the manifest ("Audio Probe").
  const lanesBefore = await page.locator('.session-lane-header').count();
  await page.locator('.session-lane-add').click();
  const probeItem = page.locator('.session-lane-add-menu .session-add-item', { hasText: 'Audio Probe' });
  await expect(probeItem).toBeVisible();

  // 3. Creating a lane from that entry produces a lane whose engineId is
  //    audio-probe (session-grid-templates.ts paints `lane-engine-<id>` on the
  //    header — no other way to name the engine from the DOM without a global).
  await probeItem.click();
  await expect(page.locator('.session-lane-header')).toHaveCount(lanesBefore + 1, { timeout: 10_000 });
  const newHeader = page.locator('.session-lane-header').last();
  await expect(newHeader).toHaveClass(/lane-engine-audio-probe/);

  // 4. The engine-SWAP selector must NOT offer it: isAudioEngine() excludes it
  //    there on purpose (an audio channel cannot become — or be swapped from —
  //    a melodic instrument). Karplus, a plugin with no clipContent override
  //    (i.e. an ordinary melodic instrument), IS there — proof that plugin
  //    loading works on this page and the probe's absence is the capability,
  //    not a loading failure. Karplus renders under its manifest name "Karp".
  const swapOptions = (await page.locator('#engine-select option').allTextContents()).join('|');
  expect(swapOptions).not.toContain('Audio Probe');
  expect(swapOptions.toLowerCase()).toContain('karp');

  // 5. Nothing failed quietly on the way.
  expect(errors).toEqual([]);
});
