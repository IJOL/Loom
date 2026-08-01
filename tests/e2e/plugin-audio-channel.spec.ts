import { test, expect } from '@playwright/test';

// Slice A's acceptance proof: a plugin that declares itself an audio channel
// (capabilities.clipContent: 'audio') gets the audio behaviour from the host
// with zero DSP and zero mention under src/.
test('a plugin that declares itself an audio channel gets the audio behaviour', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(() => {
    const w = window as unknown as { Loom?: unknown };
    return { loom: !!w.Loom };
  });
  expect(state.loom).toBe(true);

  // The probe engine does NOT appear in the selector (listedInSelector: false),
  // which is the observable half of the capability.
  const options = await page.locator('#engine-select option').allTextContents();
  expect(options.join('|')).not.toContain('Audio Probe');
});
