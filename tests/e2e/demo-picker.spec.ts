import { test, expect } from '@playwright/test';

// Verifies each baked MIDI demo loads cleanly via the picker:
//  - the demo JSON is fetched without 404
//  - applyLoadedSessionState renders lane tabs in the session tab bar
//  - no console / pageerror events surface during the load
//
// Lane tabs are rendered by src/session/session-tab-bar.ts as
// `button.session-lane-tab[data-lane-id="..."]`, so we count those after
// selecting the demo to confirm the session was applied.

const DEMOS = [
  { label: 'Sweet Dreams',              path: '/demos/sweet-dreams.json' },
  { label: 'MGMT — Kids',               path: '/demos/mgmt-kids.json' },
  { label: 'Solid Sessions — Janeiro',  path: '/demos/solid-sessions-janeiro.json' },
  { label: 'Untitled MIDI',             path: '/demos/untitled.json' },
];

test.describe('demo picker', () => {
  for (const demo of DEMOS) {
    test(`loads ${demo.label}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`);
      });

      await page.goto('/');

      // Wait for the boot demo (minimal-techno) to settle so the picker exists
      // and the session state is in a known-good baseline.
      await page.waitForSelector('#demo-picker', { timeout: 10_000 });
      await page.waitForFunction(
        () => document.querySelectorAll('.session-cell-filled').length > 0,
      );

      // Pick the demo — the option value is the demo path (see main.ts wireDemoPicker call).
      await page.locator('#demo-picker').selectOption(demo.path);

      // The session host re-renders the tab bar synchronously inside
      // applyLoadedSessionState, but the fetch+apply is async; poll until lanes appear.
      await page.waitForFunction(
        () => document.querySelectorAll('button.session-lane-tab[data-lane-id]').length > 0,
        { timeout: 5_000 },
      );

      const laneCount = await page.locator('button.session-lane-tab[data-lane-id]').count();
      expect(laneCount, `Expected at least one lane after loading ${demo.label}`).toBeGreaterThan(0);

      // No console errors should have surfaced from the load.
      expect(consoleErrors, `Console errors while loading ${demo.label}`).toEqual([]);
    });
  }
});
