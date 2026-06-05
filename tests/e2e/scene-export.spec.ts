// tests/e2e/scene-export.spec.ts
//
// Real-time export is now an ARM → Play → Stop "live take": clicking the
// real-time entry arms the recorder (it does NOT export a WAV download), the
// top transport ▶ starts the capture from the downbeat, and the unified stop
// (▶ → ⏹) finalizes the take. The finished take is inserted as a clip in a NEW
// dedicated 'audio' channel — it is never downloaded. (Offline export still
// downloads a WAV; that path is covered by scene-export-offline.spec.ts.)
import { test, expect } from '@playwright/test';

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('real-time export arms a live take → Play/Stop → take lands in a new audio channel', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // No audio lane yet; remember how many lanes exist so we can prove one appears.
  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  const lanesBefore = await page.locator('button.session-lane-tab').count();

  // Resume the AudioContext via a real click (autoplay policy) without starting
  // the transport — open & dismiss the export menu.
  await page.locator('#export-scene').click();

  // Pick "real-time" → this ARMS the take (it does NOT export a WAV download).
  await page.locator('#export-rt').click();
  // Armed state surfaces on the export button.
  await expect(page.locator('#export-scene')).toHaveClass(/armed/, { timeout: 2000 });

  // Top transport ▶ → transport starts AND, because we're armed, the live take
  // begins capturing from the downbeat (wireTransport's onStart). Button → ⏹.
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('■', { timeout: 5_000 });
  // While recording, the export button reflects it (and is no longer "armed").
  await expect(page.locator('#export-scene')).toHaveClass(/recording/, { timeout: 2000 });

  // Launch a clip so the scene is actually sounding into the capture.
  await page.locator('.session-cell-filled .session-cell-play').first().click();

  // Let it play for a beat so there's real PCM to capture.
  await page.waitForTimeout(1200);

  // Unified stop via the SAME top transport (▶ again) → the take finalizes
  // (worklet posts 'done' after the tail) and is dropped into a new audio lane.
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('▶', { timeout: 5_000 });

  // A NEW 'audio' engine lane appears, holding the take as a sample-backed clip.
  // (Finalize is async: encode → decode → persist → add lane, plus the 2s tail.)
  const audioLane = page.locator('.lane-engine-audio');
  await expect(audioLane).toHaveCount(1, { timeout: 15_000 });

  // The lane count grew by one and the new audio lane has a filled (clip-backed) cell.
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore + 1, { timeout: 5_000 });
  const audioLaneId = await page.locator('button.session-lane-tab').last().getAttribute('data-lane-id');
  expect(audioLaneId).toMatch(/^audio/);
  await expect(
    page.locator(`.session-cell-filled[data-lane-id="${audioLaneId}"]`).first(),
  ).toBeVisible({ timeout: 5_000 });

  // The export button has returned to idle (recorder reset after delivering the take).
  await expect(page.locator('#export-scene')).not.toHaveClass(/armed|recording/, { timeout: 5_000 });
});
