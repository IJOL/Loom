// tests/e2e/sampler-audio.spec.ts
// Front D · Task 16 — the Sampler's 3-family instrument picker
// (Melódico / Percusión / Loop) switches the clip editor:
//   • Melódico / Loop  → piano-roll (`.pr-frame`)
//   • Percusión        → drum-grid (canvas, no `.pr-frame`)
// The picker lives in the lane's engine inspector (`.sampler-family-select`);
// the editor it reroutes lives in the clip inspector (`#insp-roll-host`).
import { test, expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

/** Add a Sampler lane via the new-lane engine picker and open its editor so the
 *  engine inspector (the `.sampler-family-select` picker) renders. Returns the
 *  new lane's id (read off the now-active lane tab). */
async function addAndOpenSamplerLane(page: Page): Promise<string> {
  await page.locator('select.session-tabs-engine').selectOption('sampler');
  await page.locator('button.session-tabs-add-btn').click();
  // Open the lane → its engine inspector (keymap editor + family picker) renders.
  await page.getByRole('button', { name: 'Sampler 1', exact: true }).click();
  const tab = page.locator('button.session-lane-tab.active');
  await expect(tab).toBeVisible();
  return (await tab.getAttribute('data-lane-id')) ?? '';
}

test.describe('sampler 3-family picker', () => {
  test('the family selector offers melodic / drumkit / loop families', async ({ page }) => {
    await page.goto('/');
    await addAndOpenSamplerLane(page);

    const sel = page.locator('select.sampler-family-select');
    await expect(sel).toBeVisible();

    // Each family is its own <optgroup>; the bundled content (Fase 6) populates
    // every one — the lists are fetched async, so retry until they fill in.
    await expect(page.locator('.sampler-family-melodic option')).not.toHaveCount(0);
    await expect(page.locator('.sampler-family-drumkit option')).not.toHaveCount(0);
    await expect(page.locator('.sampler-family-loop option')).not.toHaveCount(0);
  });

  test('picking Percusión → drum-grid; back to Melódico → piano-roll', async ({ page }) => {
    await page.goto('/');
    const laneId = await addAndOpenSamplerLane(page);

    // Create a clip in row 0 of this lane so the clip inspector (the rerouted
    // editor) opens. Clicking an empty cell creates + selects it.
    await page
      .locator(`.session-cell-empty[data-lane-id="${laneId}"][data-clip-idx="0"]`)
      .click();
    const roll = page.locator('#insp-roll-host');
    await expect(roll).toBeVisible();
    // A plain sampler lane edits on the piano-roll first.
    await expect(roll.locator('.pr-frame')).toBeVisible();

    const sel = page.locator('select.sampler-family-select');
    await expect(sel).toBeVisible();

    // Percusión: loading a drumkit sets drumkitId → the clip reroutes to the
    // canvas drum-grid (no `.pr-frame`). The load + reroute are async.
    await sel.selectOption({ value: 'drumkit:tr808' });
    await expect(roll.locator('.pr-frame')).toHaveCount(0, { timeout: 10_000 });
    await expect(roll.locator('canvas')).not.toHaveCount(0);

    // Back to Melódico: drumkitId cleared (mutual exclusion) → piano-roll again.
    await sel.selectOption({ value: 'melodic:sweep-pad' });
    await expect(roll.locator('.pr-frame')).toBeVisible({ timeout: 10_000 });
  });
});
