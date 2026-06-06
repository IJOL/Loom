// tests/e2e/sampler-audio.spec.ts
// Front D · Task 16 — the Sampler's 3-family instrument picker
// (Melódico / Percusión / Loop) switches the clip editor:
//   • Melódico / Loop  → piano-roll (`.pr-frame`)
//   • Percusión        → drum-grid (canvas, no `.pr-frame`)
// The picker lives in the lane's engine inspector (`.sampler-family-select`);
// the editor it reroutes lives in the clip inspector (`#insp-roll-host`).
//
// Front D · Task 17 — multi-sample import (one zone per file, full-range
// stacked) and loop import (a note clip + launchable scene + a piano-roll with
// a waveform header — the performance notes live there, NOT inside the Sampler).
import { test, expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

/** A short 16-bit PCM mono WAV at 44.1k with decaying onset bursts so loop
 *  detection finds slices and decodeAudioData succeeds. Returned as a Buffer
 *  for setInputFiles. */
function samplerWav(freq = 220): Buffer {
  const sr = 44100, secs = 2.0, n = Math.floor(sr * secs);
  const dataLen = n * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    // decaying bursts every 0.5s → clear onsets for the loop slicer
    const phase = (i / sr) % 0.5;
    const env = Math.exp(-phase * 18);
    const s = Math.sin(2 * Math.PI * freq * (i / sr)) * env * 16000;
    buf.writeInt16LE(Math.round(s), 44 + i * 2);
  }
  return buf;
}

/** Add a Sampler lane via the new-lane engine picker and open its editor so the
 *  engine inspector (the `.sampler-family-select` picker) renders. Returns the
 *  new lane's id (read off the now-active lane tab). */
async function addAndOpenSamplerLane(page: Page): Promise<string> {
  await page.locator('select.session-tabs-engine').selectOption('sampler');
  await page.locator('button.session-tabs-add-btn').click();
  // Open the lane → its engine inspector (keymap editor + family picker) renders.
  await page.getByRole('button', { name: 'Sampler 1', exact: true }).click();
  const tab = page.locator('button.session-lane-tab.active');
  await expect(tab).toBeVisible();
  return (await tab.getAttribute('data-lane-id')) ?? '';
}

test.describe('sampler 3-family picker', () => {
  test('the family selector offers melodic / drumkit / loop families', async ({ page }) => {
    await page.goto('/');
    await addAndOpenSamplerLane(page);

    const sel = page.locator('select.sampler-family-select');
    await expect(sel).toBeVisible();

    // Each family is its own <optgroup>; the bundled content (Fase 6) populates
    // every one — the lists are fetched async, so retry until they fill in.
    await expect(page.locator('.sampler-family-melodic option')).not.toHaveCount(0);
    await expect(page.locator('.sampler-family-drumkit option')).not.toHaveCount(0);
    await expect(page.locator('.sampler-family-loop option')).not.toHaveCount(0);
  });

  test('picking Percusión → drum-grid; back to Melódico → piano-roll', async ({ page }) => {
    await page.goto('/');
    const laneId = await addAndOpenSamplerLane(page);

    // Create a clip in row 0 of this lane so the clip inspector (the rerouted
    // editor) opens. Clicking an empty cell creates + selects it.
    await page
      .locator(`.session-cell-empty[data-lane-id="${laneId}"][data-clip-idx="0"]`)
      .click();
    const roll = page.locator('#insp-roll-host');
    await expect(roll).toBeVisible();
    // A plain sampler lane edits on the piano-roll first.
    await expect(roll.locator('.pr-frame')).toBeVisible();

    const sel = page.locator('select.sampler-family-select');
    await expect(sel).toBeVisible();

    // Percusión: loading a drumkit sets drumkitId → the clip reroutes to the
    // canvas drum-grid (no `.pr-frame`). The load + reroute are async.
    await sel.selectOption({ value: 'drumkit:tr808' });
    await expect(roll.locator('.pr-frame')).toHaveCount(0, { timeout: 10_000 });
    await expect(roll.locator('canvas')).not.toHaveCount(0);

    // Back to Melódico: drumkitId cleared (mutual exclusion) → piano-roll again.
    await sel.selectOption({ value: 'melodic:sweep-pad' });
    await expect(roll.locator('.pr-frame')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('sampler import (Task 17)', () => {
  test('multi-sample import adds one keymap zone per file', async ({ page }) => {
    await page.goto('/');
    await addAndOpenSamplerLane(page);

    // The fresh Sampler lane has no keymap entries yet.
    await expect(page.locator('.sampler-keymap-empty')).toBeVisible();

    // Upload two WAVs to the hidden multi-select input. Each file becomes a
    // zone via addSampleToKeymap (full-range stacked, last-match-wins — that's
    // documented behaviour, not tested here: we only assert TWO zones appear).
    await page.locator('input.sampler-load').setInputFiles([
      { name: 'kick.wav',  mimeType: 'audio/wav', buffer: samplerWav(110) },
      { name: 'snare.wav', mimeType: 'audio/wav', buffer: samplerWav(330) },
    ]);

    // The inspector rebuilds after import → two zone rows in the keymap list.
    await expect(page.locator('.sampler-keymap-list .sampler-keymap-row')).toHaveCount(2, {
      timeout: 10_000,
    });
    await expect(page.locator('.sampler-keymap-empty')).toHaveCount(0);
  });

  test('importing a loop drops a note clip + scene and opens a piano-roll with a waveform header', async ({ page }) => {
    await page.goto('/');
    const laneId = await addAndOpenSamplerLane(page);

    const scenesBefore = await page.locator('.session-scene-launch').count();

    // "Importar loop…" feeds the hidden single-file loop input. The host slices
    // the loop into a bank, builds a one-note-per-slice clip with a display-only
    // waveformRef, and installs it via installSamplerClip (places + ▶ scene +
    // opens the piano-roll, all under one undo entry).
    await page.locator('input.sampler-load-loop').setInputFiles({
      name: 'amen.wav', mimeType: 'audio/wav', buffer: samplerWav(180),
    });

    // (a) A note clip materialises on THIS sampler lane (not a new lane).
    await expect(
      page.locator(`.session-cell-filled[data-lane-id="${laneId}"]`),
    ).not.toHaveCount(0, { timeout: 10_000 });

    // (b) The row it occupies has a launchable ▶ scene.
    await expect(page.locator('.session-scene-launch')).toHaveCount(
      Math.max(1, scenesBefore), { timeout: 5_000 },
    );

    // (c) The editor opens on the piano-roll WITH a waveform header above the
    // note grid (the loop's slices are display-only there).
    const roll = page.locator('#insp-roll-host');
    await expect(roll).toBeVisible();
    await expect(roll.locator('.clip-waveform-header')).toBeVisible({ timeout: 10_000 });
    await expect(roll.locator('.pr-frame')).toBeVisible();

    // (d) The note editor lives in the clip inspector, NOT inside the Sampler
    // engine inspector — the Sampler shows only the slice bank + a hint, no
    // piano-roll of its own.
    await expect(page.locator('.sampler-keymap')).toBeVisible();
    await expect(page.locator('.sampler-keymap .pr-frame')).toHaveCount(0);
  });
});
