// tests/e2e/scene-export.spec.ts
//
// Real-time export is an ARM → Play → Stop "live take", now driven by the unified
// REC group: pick the ⏱ live mode, then press REC (#rec) to arm — it does NOT
// download a WAV. Any transport start (the top ▶ OR launching a scene/clip)
// begins the capture from the downbeat; the dedicated Stop (#stop) / "⏹ all"
// finalizes it. The finished take is offered in a destination dialog (a new
// 'audio' channel, or a WAV download); it is never auto-inserted. (Offline export
// is covered by scene-export-offline.spec.ts.)
//
// Transport note: Play and Stop are separate buttons now — the Play glyph stays
// ▶ and the playing state is the `is-playing` class (no ▶/■ toggle). The old
// standalone #export-scene menu is gone; arming lives on the REC button.
import { test, expect } from '@playwright/test';

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

async function armLiveTake(page: import('@playwright/test').Page): Promise<void> {
  // Select the ⏱ live REC mode, then press REC to arm (the real clicks also
  // resume the AudioContext). Armed state surfaces on the REC button.
  await page.locator('[data-recmode="live"]').click();
  await page.locator('#rec').click();
  await expect(page.locator('#rec')).toHaveClass(/armed/, { timeout: 2000 });
}

test('live take: arm → top ▶ → Stop → take lands in a new audio channel', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  const lanesBefore = await page.locator('button.session-lane-tab').count();

  await armLiveTake(page);

  // Top transport ▶ starts the transport (gains .is-playing) AND, because we're
  // armed, the live take begins capturing from the downbeat → REC shows recording.
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveClass(/is-playing/, { timeout: 5_000 });
  await expect(page.locator('#rec')).toHaveClass(/recording/, { timeout: 2000 });

  // Launch a clip so the scene is actually sounding into the capture.
  await page.locator('.session-cell-filled .session-cell-play').first().click();
  await page.waitForTimeout(1200);

  // Dedicated Stop finalizes the take (worklet posts 'done' after the tail) and
  // surfaces the destination dialog.
  await page.locator('#stop').click();
  await expect(page.locator('#play')).not.toHaveClass(/is-playing/, { timeout: 5_000 });

  // The take is NOT auto-inserted: choose "New audio channel".
  await expect(page.locator('#take-dialog')).toBeVisible({ timeout: 15_000 });
  await page.locator('#take-dest-audio').click();
  await expect(page.locator('#take-dialog')).toBeHidden({ timeout: 5_000 });

  // A NEW 'audio' engine lane appears holding the take as a sample-backed clip.
  const audioLane = page.locator('.lane-engine-audio');
  await expect(audioLane).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore + 1, { timeout: 5_000 });
  const audioLaneId = await page.locator('button.session-lane-tab').last().getAttribute('data-lane-id');
  expect(audioLaneId).toMatch(/^audio/);
  await expect(
    page.locator(`.session-cell-filled[data-lane-id="${audioLaneId}"]`).first(),
  ).toBeVisible({ timeout: 5_000 });

  // REC returns to idle once the take is delivered.
  await expect(page.locator('#rec')).not.toHaveClass(/armed|recording/, { timeout: 5_000 });
});

// REGRESSION (user-reported): the natural way to start playback is to launch a
// SCENE (▶ Scene N in the grid), not the top transport ▶. That path calls
// seq.start() directly and used to bypass the armed live take, so the recording
// never began. seq.onStart now drives the capture, so launching a scene records.
test('live take started by LAUNCHING A SCENE → ⏹ all → destination dialog → new audio channel', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  const lanesBefore = await page.locator('button.session-lane-tab').count();

  await armLiveTake(page);

  // Start playback by LAUNCHING A SCENE (▶ Scene 1) — NOT the top transport ▶.
  await page.locator('button.session-scene-launch').first().click();
  await expect(page.locator('#play')).toHaveClass(/is-playing/, { timeout: 5_000 });
  await expect(page.locator('#rec')).toHaveClass(/recording/, { timeout: 3_000 });

  await page.waitForTimeout(1200);

  // Unified stop via the session "⏹ all" → the take finalizes after the tail.
  await page.locator('.session-stop-all').click();

  // The take is NOT auto-inserted: a dialog asks file vs new audio channel.
  await expect(page.locator('#take-dialog')).toBeVisible({ timeout: 15_000 });
  await page.locator('#take-dest-audio').click();
  await expect(page.locator('#take-dialog')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('.lane-engine-audio')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore + 1, { timeout: 5_000 });

  await expect(page.locator('#rec')).not.toHaveClass(/armed|recording/, { timeout: 5_000 });
});

test('arming then stopping without Play tears down cleanly (no take, no audio channel)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  const lanesBefore = await page.locator('button.session-lane-tab').count();

  await armLiveTake(page);

  // …then Stop WITHOUT ever pressing Play, via the session "⏹ all" (the unified
  // stop). The dedicated #stop is a no-op while the transport is idle, but "⏹ all"
  // tears the armed recorder down regardless.
  await page.locator('.session-stop-all').click();

  // The recorder tears down: REC returns to idle, NO destination dialog is shown
  // (there is no take), and NO audio channel is created.
  await expect(page.locator('#rec')).not.toHaveClass(/armed|recording/, { timeout: 3000 });
  await expect(page.locator('#take-dialog')).toHaveCount(0);
  await expect(page.locator('.lane-engine-audio')).toHaveCount(0);
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore);
});
