import { test, expect } from '@playwright/test';

// Proof that a modulator kind the core does NOT know can be dropped into
// plugins/ and work end to end: the button appears in the panel, clicking it
// creates a card, and that card shows a Rate control the HOST built from the
// manifest's declared params (S&H brings no configTemplate of its own — see
// generic-mod-config.ts). This asserts a PRESENCE on purpose: this project has
// twice shipped an acceptance test that certified an absence and stayed green
// while the plugin it was meant to cover was actually broken.
test('the S&H plugin modulator loads from disk and works in the panel', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');

  // The plugin sweep has to have registered before we can see its effects.
  // Polling the melodic engine selector for Karplus is the same signal
  // plugin-karplus.spec.ts uses to know loadPlugins() has resolved — karplus
  // and sh are built and loaded from the same plugins/* sweep, so seeing one
  // land is proof the other landed too.
  await expect
    .poll(async () => (await page.locator('#engine-select option').allTextContents()).join('|').toLowerCase())
    .toContain('karp');

  // 'tb-303-1' is a melodic lane that exists at boot (see engine-knobs.spec.ts)
  // — opening it routes to the shared poly editor page and injects the
  // modulators panel at the bottom, the same panel every melodic lane gets.
  await page.click('.session-lane-header[data-lane-id="tb-303-1"]');
  const editor = page.locator('[data-page="poly"]');
  await expect(editor).toBeVisible();

  const addButton = editor.locator('.mod-panel-header button.rnd', { hasText: '+ S&H' });
  await expect(addButton).toBeVisible();
  await addButton.click();

  const card = editor.locator('.mod-card.mod-sh');
  await expect(card).toBeVisible();
  await expect(card.locator('.knob-label:visible', { hasText: /^Rate$/i })).toBeVisible();

  expect(errors).toEqual([]);
});
