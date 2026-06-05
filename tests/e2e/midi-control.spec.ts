import { test, expect } from '@playwright/test';

// Inject a fake Web MIDI device before the app's modules run.
const installFakeMidi = () => {
  const sent: number[][] = [];
  const input: any = { id: 'in', name: 'APC Key 25', manufacturer: 'Akai', onmidimessage: null };
  const output: any = { id: 'out', name: 'APC Key 25', manufacturer: 'Akai', send: (b: number[]) => sent.push(b) };
  const access: any = {
    inputs: new Map([['in', input]]),
    outputs: new Map([['out', output]]),
    onstatechange: null,
  };
  (navigator as any).requestMIDIAccess = async () => access;
  (window as any).__fakeMidi = {
    pad: (note: number) => input.onmidimessage({ data: Uint8Array.from([0x90, note, 100]) }),
    sentCount: () => sent.length,
  };
};

// Wait for the boot demo to populate the clip grid (the same signal the other
// e2e specs use). The minimal-techno demo fills lane 0 / scene 0.
async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('APC Key 25: enable, launch a clip from a pad, receive LED feedback', async ({ page }) => {
  await page.addInitScript(installFakeMidi);
  await page.goto('/');
  await waitForBoot(page);

  // Open the MIDI Control disclosure and enable.
  await page.locator('summary', { hasText: 'MIDI Control' }).click();
  await page.locator('#midi-control-enable').click();
  await expect(page.locator('#midi-control-status')).toContainText('APC Key 25');

  // The app should have sent LED bytes on connect (full render).
  await expect.poll(() => page.evaluate(() => (window as any).__fakeMidi.sentCount())).toBeGreaterThan(0);

  // Push pad note 32 (top-left → grid lane 0, scene/row 0). The boot demo has a
  // clip at lane 0 / row 0, so this launches it and starts the transport.
  await page.evaluate(() => (window as any).__fakeMidi.pad(32));

  // Assert a clip launched: a session cell enters the playing state (the same
  // robust signal clip-click.spec.ts uses; launchClipAt queues at `now` so it
  // fires on the next tick).
  await expect(page.locator('.session-cell-playing').first()).toBeVisible({ timeout: 3000 });
});
