import { test, expect } from '@playwright/test';

// End-to-end contract for the relocated master mixer (frente C):
//   - the master strip lives at the foot of the scenes column of the mixer row,
//   - the old "Master FX" tab is gone, replaced by an FX toggle button on the
//     strip that opens/closes the #master-fx-panel (which still hosts all the
//     #fx-* ids unchanged), and
//   - the strip fader is a two-way proxy of the existing #volume control.
//
// Pattern mirrors lane-ui.spec.ts: wait for the async demo loader to populate
// the grid before asserting on rendered columns.

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
  );
}

test.describe('master strip', () => {
  test('exists at the foot of the grid with a MASTER label', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    const strip = page.locator('.master-strip');
    await expect(strip).toBeVisible();
    await expect(strip.locator('.mix-name')).toHaveText('MASTER');
  });

  test('the Master FX tab no longer exists', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    await expect(page.locator('button.tab[data-tab="fx"]')).toHaveCount(0);
  });

  test('the FX button toggles the #master-fx-panel open and closed', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    const panel = page.locator('#master-fx-panel');
    // The panel starts hidden (native [hidden] attribute → not visible).
    await expect(panel).toBeHidden();

    await page.locator('.master-fx-toggle').click();
    await expect(panel).toBeVisible();
    // Internal ids were preserved when the markup moved out of the old tab.
    await expect(panel.locator('#fx-reverb-knobs')).toHaveCount(1);
    await expect(panel.locator('#fx-master-comp-knobs')).toHaveCount(1);
    await expect(panel.locator('#fx-filters')).toHaveCount(1);

    await page.locator('.master-fx-toggle').click();
    await expect(panel).toBeHidden();
  });

  test('the Master FX knobs are still live when the panel opens', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    await page.locator('.master-fx-toggle').click();
    await expect(page.locator('#master-fx-panel')).toBeVisible();

    const compKnobs = await page.locator('#fx-master-comp-knobs .knob').count();
    expect(compKnobs).toBeGreaterThan(0);
  });

  test('the fader is a two-way proxy of #volume', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    // Forward: fader → #volume.
    await page.evaluate(() => {
      const fader = document.querySelector('.master-strip .mix-fader') as HTMLInputElement;
      fader.value = '0.3';
      fader.dispatchEvent(new Event('input'));
    });
    await expect(page.locator('#volume')).toHaveValue('0.3');

    // Inverse: #volume → fader.
    await page.evaluate(() => {
      const vol = document.getElementById('volume') as HTMLInputElement;
      vol.value = '0.7';
      vol.dispatchEvent(new Event('input'));
    });
    await expect(page.locator('.master-strip .mix-fader')).toHaveValue('0.7');
  });

  test('lane mixer columns keep their VU and the master is not counted as a lane', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    // Lane columns are .mix-col WITHOUT .master-strip; each still has its VU host.
    const laneCols = page.locator('.mix-col:not(.master-strip)');
    const laneCount = await laneCols.count();
    expect(laneCount).toBeGreaterThan(0);
    for (let i = 0; i < laneCount; i++) {
      await expect(laneCols.nth(i).locator('.mix-vu-host')).toHaveCount(1);
    }

    // Exactly one master strip, and it is excluded from the lane count above.
    await expect(page.locator('.master-strip')).toHaveCount(1);
  });
});
