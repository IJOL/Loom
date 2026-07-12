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

async function openLane(page: Page, laneId: string): Promise<void> {
  await page.click(`.session-lane-header[data-lane-id="${laneId}"]`);
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
  { engineId: 'tb303',         label: 'TB-303',      selectId: '#bass-preset-select' },
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
