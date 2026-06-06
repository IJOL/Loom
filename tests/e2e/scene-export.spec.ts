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
  // (worklet posts 'done' after the tail) and surfaces the destination dialog.
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('▶', { timeout: 5_000 });

  // The take is NOT auto-inserted: choose "new audio channel" in the dialog.
  await expect(page.locator('#take-dialog')).toBeVisible({ timeout: 15_000 });
  await page.locator('#take-dest-audio').click();
  await expect(page.locator('#take-dialog')).toBeHidden({ timeout: 5_000 });

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

// REGRESSION (user-reported): the natural way to start playback is to launch a
// SCENE (▶ Scene N in the grid), not the top transport ▶. That path calls
// seq.start() directly and used to bypass the armed live take, so the recording
// never began — pressing "⏹ all" produced nothing (no take, no dialog). This
// test drives that exact flow and asserts the take now records and surfaces a
// destination dialog (the take is no longer auto-inserted into an audio lane).
test('live take started by LAUNCHING A SCENE → ⏹ all → destination dialog → new audio channel', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  const lanesBefore = await page.locator('button.session-lane-tab').count();

  // Arm the live take (the real click also resumes the AudioContext).
  await page.locator('#export-scene').click();
  await page.locator('#export-rt').click();
  await expect(page.locator('#export-scene')).toHaveClass(/armed/, { timeout: 2000 });

  // Start playback by LAUNCHING A SCENE (▶ Scene 1) — NOT the top transport ▶.
  // The transport must start AND the armed take must begin capturing from the
  // downbeat. (The bug: this path never told the live take the transport started.)
  await page.locator('button.session-scene-launch').first().click();
  await expect(page.locator('#play')).toHaveText('■', { timeout: 5_000 });
  // Recording is now visibly evident on the export button (red background class).
  await expect(page.locator('#export-scene')).toHaveClass(/recording/, { timeout: 3_000 });

  // Let it play so there is real PCM to capture.
  await page.waitForTimeout(1200);

  // Unified stop via the session "⏹ all" → the take finalizes after the tail.
  await page.locator('#session-stop-all').click();

  // The take is NOT auto-inserted: a dialog asks file vs new audio channel.
  await expect(page.locator('#take-dialog')).toBeVisible({ timeout: 15_000 });

  // Choose "new audio channel" → a NEW 'audio' lane appears holding the take.
  await page.locator('#take-dest-audio').click();
  await expect(page.locator('#take-dialog')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('.lane-engine-audio')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore + 1, { timeout: 5_000 });

  // The export button returns to idle once the take is delivered.
  await expect(page.locator('#export-scene')).not.toHaveClass(/armed|recording/, { timeout: 5_000 });
});

test('arming then stopping without Play tears down cleanly (no take, no audio channel)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  const lanesBefore = await page.locator('button.session-lane-tab').count();

  // Arm the live take…
  await page.locator('#export-scene').click();
  await page.locator('#export-rt').click();
  await expect(page.locator('#export-scene')).toHaveClass(/armed/, { timeout: 2000 });

  // …then Stop WITHOUT ever pressing Play, via the session "⏹ all" (unified stop).
  await page.locator('#session-stop-all').click();

  // The recorder tears down: button returns to idle, NO destination dialog is
  // shown (there is no take), and NO audio channel is created.
  await expect(page.locator('#export-scene')).not.toHaveClass(/armed|recording/, { timeout: 3000 });
  await expect(page.locator('#take-dialog')).toHaveCount(0);
  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore);
});
