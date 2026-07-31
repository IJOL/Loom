import { test, expect } from '@playwright/test';

// Karplus now lives entirely in public/plugins/karplus/. These two checks are
// the spec's acceptance criteria: the plugin engine is a first-class citizen of
// the selector, and the app survives a plugin directory that isn't there.
test('the Karplus plugin appears as a selectable engine', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');

  const ids = await page.evaluate(async () => {
    const res = await fetch('plugins/index.json');
    return (await res.json()).plugins as string[];
  });
  expect(ids).toContain('karplus');

  // #engine-select is the main lane's engine selector (index.html:208). It is
  // filled from melodicSynthEngineIds(), which lists every registered engine
  // whose descriptor asks for the piano-roll editor — so a plugin engine shows
  // up there with no extra wiring.
  await expect
    .poll(async () => (await page.locator('#engine-select option').allTextContents()).join('|').toLowerCase())
    .toContain('karp');
  expect(errors).toEqual([]);
});

test('a missing plugin directory removes the engine and logs no error', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Serve an empty index: the same thing as deleting public/plugins/karplus/.
  await page.route('**/plugins/index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plugins: [] }) }));
  await page.goto('/');
  await page.waitForTimeout(1500);

  const options = await page.locator('#engine-select option').allTextContents();
  expect(options.join('|').toLowerCase()).not.toContain('karp');
  expect(errors).toEqual([]);
});
