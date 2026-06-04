import { test, expect, type Page } from '@playwright/test';

// End-to-end UI tests that codify the bugs we hit during the lane unification:
// each one would have failed before the fix and passes after. They replace the
// ad-hoc Playwright probing we used to confirm the fixes worked.

async function destinationCountsForLane(page: Page, laneId: string): Promise<number[]> {
  await page.locator(`button.session-lane-tab[data-lane-id="${laneId}"]`).click();
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLSelectElement>('.mod-dest-select')]
      .filter((s) => s.offsetParent !== null)
      .map((s) => s.options.length),
  );
}

test.describe('modulator destination dropdown', () => {
  test('TB-303 lane lists its 6 engine params', async ({ page }) => {
    await page.goto('/');
    const counts = await destinationCountsForLane(page, 'tb-303-1');
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(6);
  });

  test('Subtractive lane 1 lists 22 destinations', async ({ page }) => {
    await page.goto('/');
    const counts = await destinationCountsForLane(page, 'subtractive-1');
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(22);
  });

  test('Subtractive lane 2 (added by demo) also lists 22 destinations', async ({ page }) => {
    await page.goto('/');
    const counts = await destinationCountsForLane(page, 'subtractive-2');
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(22);
  });

  test('Drums lane lists its bus destinations (level/pan/sends/EQ, ≥7)', async ({ page }) => {
    await page.goto('/');
    const counts = await destinationCountsForLane(page, 'drums-1');
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(7);
  });

  test('Drums lane LFO dropdown includes bus EQ destinations', async ({ page }) => {
    await page.goto('/');
    // Wait for the async fetch to populate laneResources (so drums-1 has its bus EQ wired).
    await page.waitForFunction(
      () => document.querySelectorAll('.session-cell-filled').length > 0,
    );
    await page.locator('button.session-lane-tab[data-lane-id="drums-1"]').click();
    const options = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLSelectElement>('.mod-dest-select')]
        .filter((s) => s.offsetParent !== null)
        .flatMap((s) => [...s.options].map((o) => o.value)),
    );
    expect(options).toContain('drums-1.bus.eq.low');
    expect(options).toContain('drums-1.bus.eq.mid');
    expect(options).toContain('drums-1.bus.eq.high');
  });
});

test.describe('preset selection', () => {
  test('boot applies the demo slot-0 preset (LEAD Square)', async ({ page }) => {
    await page.goto('/');
    // The demo SessionState is now fetched async from /demos/minimal-techno.json,
    // so the dropdown stays at "__custom__" until the fetch resolves and
    // applyLoadedSessionState runs. Wait until the active lane reports a real
    // preset before clicking through.
    await page.waitForFunction(
      () => document.querySelectorAll('.session-cell-filled').length > 0,
    );
    await page.locator('button.session-lane-tab[data-lane-id="subtractive-1"]').click();
    const sel = page.locator('#poly-preset-select');
    await expect(sel).toHaveValue('factory:LEAD Square');
  });
});

test.describe('mixer mutes', () => {
  test('clicking the M button on the Sub 1 column toggles its active class', async ({ page }) => {
    await page.goto('/');
    const muteBtn = page.locator('.mix-col').nth(2).locator('button.mix-btn.mute');
    await expect(muteBtn).not.toHaveClass(/active/);
    await muteBtn.click();
    await expect(muteBtn).toHaveClass(/active/);
    await muteBtn.click();
    await expect(muteBtn).not.toHaveClass(/active/);
  });
});

test.describe('demo JSON presets', () => {
  // Wait for the async demo-loader to populate the dropdown before asserting.
  async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
    await page.waitForFunction(
      () => document.querySelectorAll('.session-cell-filled').length > 0,
    );
  }

  test('every poly lane shows its boot preset in the dropdown', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    await page.locator('button.session-lane-tab[data-lane-id="subtractive-1"]').click();
    await expect(page.locator('#poly-preset-select')).toHaveValue('factory:LEAD Square');

    await page.locator('button.session-lane-tab[data-lane-id="subtractive-2"]').click();
    await expect(page.locator('#poly-preset-select')).toHaveValue('factory:PAD Sweep');
  });

  test('launching a scene does not change per-lane presets', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    // Presets are a per-lane property: launching a scene swaps clips, not sounds.
    // Index 1 = scene B.
    await page.locator('.session-scene-launch').nth(1).click();

    await page.locator('button.session-lane-tab[data-lane-id="subtractive-1"]').click();
    await expect(page.locator('#poly-preset-select')).toHaveValue('factory:LEAD Square');

    await page.locator('button.session-lane-tab[data-lane-id="subtractive-2"]').click();
    await expect(page.locator('#poly-preset-select')).toHaveValue('factory:PAD Sweep');
  });
});

test.describe('modulator scope', () => {
  test('LFO defaults to scope=shared and the SCOPE label appears in the LFO card', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('.session-cell-filled').length > 0,
    );
    await page.locator('button.session-lane-tab[data-lane-id="subtractive-1"]').click();
    // The SCOPE control is rendered as a radio-strip with buttons titled "Shared" and "PerVoice".
    // We search for any button with title="Shared" (the default SCOPE value) within an LFO card.
    const scopeButtons = await page.evaluate(() =>
      [...document.querySelectorAll('.mod-card.mod-lfo .radio-btn')].filter((b) => (b as any).title === 'Shared'),
    );
    expect(scopeButtons.length).toBeGreaterThan(0);
  });
});
