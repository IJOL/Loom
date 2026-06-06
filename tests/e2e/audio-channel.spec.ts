// tests/e2e/audio-channel.spec.ts
import { test, expect, type Page } from '@playwright/test';

/** A ~2s 16-bit PCM mono WAV at 44.1k with two onset bursts so detection finds
 *  slices. Returned as a Buffer for setInputFiles. */
function loopWav(): Buffer {
  const sr = 44100, secs = 2.0, n = Math.floor(sr * secs);
  const dataLen = n * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    // decaying bursts at 0s, 0.5s, 1.0s, 1.5s → clear onsets
    const phase = (i / sr) % 0.5;
    const env = Math.exp(-phase * 18);
    const s = Math.sin(2 * Math.PI * 180 * (i / sr)) * env * 16000;
    buf.writeInt16LE(Math.round(s), 44 + i * 2);
  }
  return buf;
}

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

/** New flow: "+ Audio" creates an EMPTY audio channel (no file prompt); the WAV
 *  is imported per clip by clicking an empty cell, which opens the file picker. */
async function addAudioChannelWithWav(page: Page, wav: Buffer): Promise<void> {
  const lanesBefore = await page.locator('button.session-lane-tab').count();
  await page.locator('button.session-add-audio-btn').click();
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore + 1, { timeout: 10_000 });
  const laneId = await page.locator('button.session-lane-tab').last().getAttribute('data-lane-id');
  const cell = page.locator(`.session-cell[data-lane-id="${laneId}"][data-clip-idx="0"]`);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    cell.click(),
  ]);
  await chooser.setFiles({ name: 'beat.wav', mimeType: 'audio/wav', buffer: wav });
}

test('add an audio channel and import a WAV → lane + launchable scene appear', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const scenesBefore = await page.locator('.session-scene-launch').count();

  await addAudioChannelWithWav(page, loopWav());

  // The row the imported clip occupies has a launchable scene button (the bug fix).
  await expect(page.locator('.session-scene-launch')).toHaveCount(
    Math.max(1, scenesBefore), { timeout: 5_000 },
  );
  await expect(page.locator('.session-cell-filled').last()).toBeVisible();
});

test('launching the audio channel scene starts the transport', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await addAudioChannelWithWav(page, loopWav());
  await expect(page.locator('.session-scene-launch').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('.session-scene-launch').first().click();
  // Transport is now playing. Play and Stop are separate buttons now, so the
  // Play glyph stays ▶ and the playing state is reflected by the .is-playing class.
  await expect(page.locator('#play')).toHaveClass(/is-playing/, { timeout: 5_000 });
});
