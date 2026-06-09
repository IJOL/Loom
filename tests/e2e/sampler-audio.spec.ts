// tests/e2e/sampler-audio.spec.ts
// The Sampler's instruments (Melodic / Drumkit / Loop) ARE its presets: they
// load from the unified PRESET dropdown (`#poly-preset-select`), and selecting
// one switches the clip editor:
//   • Melodic / Loop  → piano-roll (`.pr-frame`)
//   • Drumkit         → drum-grid (canvas, no `.pr-frame`)
// (There is no separate family picker in the body — one selector = PRESET.)
// The editor it reroutes lives in the clip inspector (`#insp-roll-host`).
//
// Front D · Task 17 — multi-sample import (one zone per file, full-range
// stacked) and loop import (a note clip + launchable scene + a piano-roll with
// a waveform header — the performance notes live there, NOT inside the Sampler).
//
// Front D · Task 18 — an audio channel (a dropped WAV on an `audio` lane) is a
// pure waveform clip: its editor is the waveform header + a small bpm/bars/warp
// toolbar, with NO `✂ Slice → pads` button (that slice-to-bank path was removed
// — slicing now happens Sampler-side via "Importar loop…", see Task 13).
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
 *  engine inspector (PRESET dropdown + keymap editor) renders. Returns the new
 *  lane's id (read off the now-active lane tab). */
async function addAndOpenSamplerLane(page: Page): Promise<string> {
  await page.locator('select.session-tabs-engine').selectOption('sampler');
  await page.locator('button.session-tabs-add-btn').click();
  // Open the lane → its engine inspector (PRESET dropdown + keymap editor) renders.
  await page.getByRole('button', { name: 'Sampler 1', exact: true }).click();
  const tab = page.locator('button.session-lane-tab.active');
  await expect(tab).toBeVisible();
  return (await tab.getAttribute('data-lane-id')) ?? '';
}

test.describe('sampler instruments via the PRESET dropdown', () => {
  test('the PRESET dropdown offers melodic / drumkit / loop instruments', async ({ page }) => {
    await page.goto('/');
    await addAndOpenSamplerLane(page);

    const sel = page.locator('#poly-preset-select');
    await expect(sel).toBeVisible();

    // The Sampler's instruments populate the shared preset selector as namespaced
    // `sampler:<family>:<id>` options (grouped Drumkit / Melodic / Loop); the
    // lists are fetched async, so retry until they fill in.
    await expect(sel.locator('option[value^="sampler:melodic:"]')).not.toHaveCount(0);
    await expect(sel.locator('option[value^="sampler:drumkit:"]')).not.toHaveCount(0);
    await expect(sel.locator('option[value^="sampler:loop:"]')).not.toHaveCount(0);
  });

  test('picking a drumkit → drum-grid; back to melodic → piano-roll', async ({ page }) => {
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

    const sel = page.locator('#poly-preset-select');
    await expect(sel).toBeVisible();

    // A drumkit: loading it sets drumkitId → the clip reroutes to the canvas
    // drum-grid (no `.pr-frame`). The load + reroute are async.
    await sel.selectOption({ value: 'sampler:drumkit:tr808' });
    await expect(roll.locator('.pr-frame')).toHaveCount(0, { timeout: 10_000 });
    await expect(roll.locator('canvas')).not.toHaveCount(0);

    // Back to a melodic instrument: drumkitId cleared (mutual exclusion) → piano-roll.
    await sel.selectOption({ value: 'sampler:melodic:sweep-pad' });
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

test.describe('audio channel (Task 18)', () => {
  test('a dropped WAV is a pure waveform clip — no ✂ Slice → pads button', async ({ page }) => {
    await page.goto('/');
    // Boot: the demo session fills the grid before we add anything.
    await page.waitForFunction(
      () => document.querySelectorAll('.session-cell-filled').length > 0,
      { timeout: 10_000 },
    );

    // "+ Audio" creates an EMPTY audio channel; the WAV is imported by clicking
    // the new lane's empty cell (the picker opens there now). Importing selects
    // the clip and opens its editor in #insp-roll-host with no extra click.
    await page.locator('button.session-add-audio-btn').click();
    const laneId = await page.locator('button.session-lane-tab').last().getAttribute('data-lane-id');
    const cell = page.locator(`.session-cell[data-lane-id="${laneId}"][data-clip-idx="0"]`);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      cell.click(),
    ]);
    await chooser.setFiles({ name: 'beat.wav', mimeType: 'audio/wav', buffer: samplerWav(180) });

    // The editor is the audio-clip editor: a waveform header + the small toolbar
    // (bpm / bars / warp). It is NOT a piano-roll.
    const roll = page.locator('#insp-roll-host');
    await expect(roll).toBeVisible();
    await expect(roll.locator('.clip-waveform-header')).toBeVisible({ timeout: 10_000 });
    await expect(roll.locator('.audio-clip-warp')).toBeVisible();

    // The Task-9 removal: there is NO ✂ Slice → pads button anywhere in the
    // audio-clip editor.
    await expect(roll.locator('.audio-clip-slice')).toHaveCount(0);
    await expect(roll.locator('.pr-frame')).toHaveCount(0);
  });
});
