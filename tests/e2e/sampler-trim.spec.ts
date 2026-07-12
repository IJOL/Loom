import { test, expect } from '@playwright/test';
import { addLane, openLane } from './helpers';

test('dragging the start handle trims the sample', async ({ page }) => {
  await page.goto('/');
  await addLane(page, 'sampler');
  await openLane(page, 'sampler-1');

  const sel = page.locator('#poly-preset-select');
  await expect(sel).toBeVisible();
  await expect(sel.locator('option[value^="sampler:melodic:"]')).not.toHaveCount(0);
  // Selecting a sampler preset auto-loads it via the 'change' event listener.
  await sel.selectOption('sampler:melodic:sweep-pad');

  const canvas = page.locator('.ssv-canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });
  await expect(canvas).toHaveAttribute('data-sample-start', '0.0000');

  // Wait for the rAF draw to set a non-zero canvas.width — fracAt uses it as
  // the denominator; a zero width makes every pointermove map to frac=0 and
  // the handle never moves.
  await page.waitForFunction(() => {
    const c = document.querySelector('.ssv-canvas') as HTMLCanvasElement | null;
    return c != null && c.width > 0;
  }, undefined, { timeout: 10_000 });

  // Dispatch pointer events directly on the canvas so the drag registers
  // regardless of scroll position. page.mouse only works in-viewport; the
  // waveform panel is at ~966px y which is below the default 768px viewport.
  const result = await page.evaluate(() => {
    const c = document.querySelector('.ssv-canvas') as HTMLCanvasElement;
    const sc = document.querySelector('.ssv-wave') as HTMLElement;
    const scLeft = sc.getBoundingClientRect().left;
    const scTop  = sc.getBoundingClientRect().top;
    const targetFrac = 0.2;
    const startX = scLeft + 1;       // frac ≈ 0 → picks the start handle
    const endX   = scLeft + c.width * targetFrac;
    const y      = scTop + sc.clientHeight / 2;

    const mkPointer = (type: string, x: number): PointerEvent =>
      new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1,
        clientX: x, clientY: y, isPrimary: true, pointerType: 'mouse',
      });

    c.dispatchEvent(mkPointer('pointerdown', startX));
    for (let i = 1; i <= 10; i++) {
      const px = startX + (endX - startX) * (i / 10);
      c.dispatchEvent(mkPointer('pointermove', px));
    }
    c.dispatchEvent(mkPointer('pointerup', endX));

    return c.dataset.sampleStart;
  });

  expect(Number(result)).toBeGreaterThan(0.1);
});
