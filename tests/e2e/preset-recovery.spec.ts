import { test, expect, type Page } from '@playwright/test';

// Regression: selecting a preset on a lane, switching to another tab, then
// switching back must restore the SAME preset in the dropdown — it must not
// fall back to "(custom — no preset)". This was broken for the non-subtractive
// poly engines (FM / Wavetable / Karplus): their preset-change handler applied
// the sound but never recorded the selection, so re-activating the lane showed
// "custom" even though nothing had been modified. The bug is engine-agnostic in
// spirit, so this test exercises EVERY engine that has a preset dropdown.

async function waitForBoot(page: Page): Promise<void> {
  // The demo SessionState is fetched async; wait until it has populated.
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
  );
}

/** Add a new lane with the given engine via the tab-bar engine picker and
 *  return the new lane's id (read from the freshly-rendered tab). */
async function addLane(page: Page, engineId: string): Promise<string> {
  const before = await page.$$eval('.session-lane-header', (tabs) =>
    tabs.map((t) => (t as HTMLElement).dataset.laneId ?? ''),
  );
  await page.click('.session-lane-add');
  await page.click(`.session-add-item[data-engine-id="${engineId}"]`);
  await page.waitForFunction(
    (n) => document.querySelectorAll('.session-lane-header').length > n,
    before.length,
  );
  const after = await page.$$eval('.session-lane-header', (tabs) =>
    tabs.map((t) => (t as HTMLElement).dataset.laneId ?? ''),
  );
  const newId = after.find((id) => !before.includes(id));
  if (!newId) throw new Error(`addLane(${engineId}): could not find new lane id`);
  return newId;
}

/** Open a lane's editor AND wait until it is really the active one.
 *
 *  The wait is not politeness, it is the difference between testing something
 *  and testing nothing. Clicking a lane header re-renders the session grid,
 *  which replaces the header nodes; a second click issued immediately lands on a
 *  node that is already detached and is simply lost. Verified on `main` as well
 *  as here, so it is not this branch's doing — but without this wait the
 *  "switch away and BACK" below never came back, and the assertion passed by
 *  reading a dropdown nothing had touched. */
async function openLane(page: Page, laneId: string): Promise<void> {
  await page.click(`.session-lane-header[data-lane-id="${laneId}"]`);
  // Wait until the lane really IS the one being edited. Without this the test
  // was vacuous: clicking a lane header re-renders the session grid, a click
  // issued immediately after another one is swallowed, and the "switch away and
  // BACK" below never came back — so the assertion read a dropdown that nothing
  // had touched. Verified on `main` too, so the swallowed click is not this
  // branch's doing; it only became visible once the TB-303 shared this dropdown.
  await page.waitForFunction(
    (id) => !!document.querySelector(`.session-lane-header-active[data-lane-id="${id}"]`),
    laneId,
    { timeout: 5000 },
  );
  // The active class lands DURING the re-render, not after it, so returning the
  // moment it appears hands the next click a node that is about to be replaced —
  // and that click is silently lost. Measured: with a settle here the switch
  // always takes; without it, the third one never does.
  await page.waitForTimeout(250);
}

/** First non-"custom" option value in a select (i.e. the first real preset). */
async function firstPresetValue(page: Page, selectId: string): Promise<string> {
  return page.$eval(
    selectId,
    (el) =>
      [...(el as HTMLSelectElement).options]
        .map((o) => o.value)
        .find((v) => v && v !== '__custom__') ?? '',
  );
}

// Engines that expose a preset dropdown, with the select element each one uses.
// (Sampler is a poly engine too but ships no presets, so it has no dropdown.)
const ENGINES: { engineId: string; label: string; selectId: string }[] = [
  { engineId: 'subtractive',   label: 'Subtractive', selectId: '#poly-preset-select' },
  { engineId: 'fm',            label: 'FM',          selectId: '#poly-preset-select' },
  { engineId: 'wavetable',     label: 'Wavetable',   selectId: '#poly-preset-select' },
  { engineId: 'karplus',       label: 'Karplus',     selectId: '#poly-preset-select' },
  { engineId: 'tb303',         label: 'TB-303',      selectId: '#poly-preset-select' },
  { engineId: 'drums-machine', label: 'Drums',       selectId: '#drums-preset-select' },
];

test.describe('preset recovery across tab switches', () => {
  for (const { engineId, label, selectId } of ENGINES) {
    test(`${label}: selected preset survives switching away and back`, async ({ page }) => {
      await page.goto('/');
      await waitForBoot(page);

      // A different existing lane to switch to (any boot lane works).
      const otherLane = (await page.$$eval('.session-lane-header', (tabs) =>
        tabs.map((t) => (t as HTMLElement).dataset.laneId ?? ''),
      ))[0];

      const laneId = await addLane(page, engineId);
      await openLane(page, laneId);

      // Pick the first real factory preset and apply it.
      const preset = await firstPresetValue(page, selectId);
      expect(preset, `${label} should expose at least one preset`).not.toBe('');
      await page.selectOption(selectId, preset);
      // Sanity: the selection took before we navigate away.
      await expect(page.locator(selectId)).toHaveValue(preset);

      // Switch to another lane, then back to ours.
      await openLane(page, otherLane);
      await openLane(page, laneId);

      // The dropdown must still show our preset — NOT "(custom — no preset)".
      await expect(page.locator(selectId)).toHaveValue(preset);
    });
  }
});
