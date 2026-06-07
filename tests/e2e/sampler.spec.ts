import { test, expect } from '@playwright/test';

// Generates a tiny valid 0.3s/220Hz mono WAV as a Buffer for file upload.
function makeWav(): Buffer {
  const sr = 8000, secs = 0.3, n = Math.floor(sr * secs);
  const dataLen = n * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / sr) * 16000), 44 + i * 2);
  }
  return buf;
}

test.describe('sampler', () => {
  test('add a Sampler lane, load a sample, see a keymap entry', async ({ page }) => {
    await page.goto('/');

    // Add a Sampler lane via the new-lane engine picker.
    await page.locator('select.session-tabs-engine').selectOption('sampler');
    await page.locator('button.session-tabs-add-btn').click();

    // Open the lane so the engine inspector (keymap editor) renders.
    await page.getByRole('button', { name: 'Sampler 1', exact: true }).click();

    // Before loading, the keymap editor shows the empty state.
    await expect(page.locator('.sampler-keymap')).toBeVisible();
    await expect(page.locator('.sampler-keymap-empty')).toHaveText('No samples loaded yet.');

    // Upload a WAV directly to the sampler's file input.
    await page.locator('input.sampler-load').setInputFiles({
      name: 'tone.wav', mimeType: 'audio/wav', buffer: makeWav(),
    });

    // The keymap now has exactly one melodic zone, rendered as a channel strip
    // (root note 60 = C4), with its root editable in the sample editor.
    await expect(page.locator('.dv-col')).toHaveCount(1);
    await expect(page.locator('.ssv-znum input').first()).toHaveValue('60');
  });
});
