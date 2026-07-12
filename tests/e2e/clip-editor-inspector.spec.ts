// tests/e2e/clip-editor-inspector.spec.ts
//
// Front E (declutter the clip editors) end-to-end coverage. Exercises the
// re-organised inspector against the boot demo (minimal-techno: a tb-303
// melodic lane, a drums-machine lane) plus an audio channel created in-memory.
//
// Scenarios (plan Tarea 11):
//   1. Transport vs edit separation — Launch lives in #insp-transport-row, not edit.
//   2. Visibility by clip kind — melodic shows the octave grid-control, drums shows
//      the Grid resolution control, audio HIDES the edit row + has no BPM/bar header.
//   3. Honest labels — Copy notes / Paste ▸ … / toggle title "does not change the sound".
//   4. Octave operable from the UI — clicking ▸ steps the label, and `x` does the same.
//   5. Toggle has no first-click no-op — one click flips a melodic clip to the grid.
//   6. Discoverable help — the "?" reveals the legend ("a s d f", "Ctrl+A").
//   7. Launch-quantize persists and undoes.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** A ~2s 16-bit PCM mono WAV with decaying onset bursts so detection finds
 *  slices. Returned as a Buffer for setInputFiles. (Mirrors audio-channel.spec.) */
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

/** Lane id of the first lane whose header carries the given engine class
 *  (e.g. 'drums-machine'). The boot demo lays one drums lane; this avoids
 *  hard-coding the demo's id strings. */
async function laneIdForEngine(page: Page, engineId: string): Promise<string> {
  return page.evaluate((eng) => {
    const h = document.querySelector(`.session-lane-header.lane-engine-${eng}`) as HTMLElement | null;
    return h?.dataset.laneId ?? '';
  }, engineId);
}

/** Open the inspector on the first filled clip of `laneId`. */
async function openClip(page: Page, laneId: string): Promise<void> {
  const cell = page.locator(`.session-cell-filled[data-lane-id="${laneId}"]`).first();
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(page.locator('#session-inspector')).toBeVisible();
}

/** Create an empty audio channel ("+ Audio"), then import a WAV into its first
 *  cell (the picker now opens on cell click, not at channel creation); the clip
 *  auto-opens in the inspector. Returns once the audio clip has been imported. */
async function addAudioChannel(page: Page): Promise<void> {
  const lanesBefore = await page.locator('.session-lane-header').count();
  await page.locator('.session-lane-add').click();
  await page.locator('.session-lane-add-menu .session-add-item', { hasText: 'Audio channel' }).click();
  await expect(page.locator('.session-lane-header')).toHaveCount(lanesBefore + 1, { timeout: 10_000 });
  const laneId = await page.locator('.session-lane-header').last().getAttribute('data-lane-id');
  const cell = page.locator(`.session-cell[data-lane-id="${laneId}"][data-clip-idx="0"]`);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    cell.click(),
  ]);
  await chooser.setFiles({ name: 'beat.wav', mimeType: 'audio/wav', buffer: loopWav() });
}

test('1 · Launch quantize sits in the transport row, not the edit row', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  const lane = await laneIdForEngine(page, 'tb303');
  await openClip(page, lane);

  // Launch select is a child of the transport row, never of the edit row.
  await expect(page.locator('#insp-transport-row #insp-quantize')).toHaveCount(1);
  await expect(page.locator('#insp-edit-row #insp-quantize')).toHaveCount(0);
  // The clip name now lives in the breadcrumb header (inline-rename input),
  // not the transport row. The transport row owns Length / Duplicate / Delete.
  await expect(page.locator('.ctx-clip-seg #insp-name')).toHaveCount(1);
  await expect(page.locator('#insp-transport-row #insp-name')).toHaveCount(0);
  await expect(page.locator('#insp-transport-row #insp-length')).toHaveCount(1);
  await expect(page.locator('#insp-transport-row #insp-duplicate')).toHaveCount(1);
  await expect(page.locator('#insp-transport-row #insp-delete')).toHaveCount(1);
});

test('2 · Edit row + editor controls vary by clip kind', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Melodic clip → edit row visible, octave grid-control reads a "C…" label.
  const melodic = await laneIdForEngine(page, 'tb303');
  await openClip(page, melodic);
  await expect(page.locator('#insp-edit-row')).toBeVisible();
  await expect(page.locator('#insp-copy')).toHaveText('Copy notes');
  await expect(page.locator('#insp-random-notes')).toHaveText('🎲');
  // The pr-toolbar now holds TWO .editor-grid-control wrappers: the octave
  // stepper (◂ [C4] ▸, has buttons) and the shared Grid resolution <select>
  // (no buttons). Isolate the octave one via :has(button).
  const octLabel = page.locator('#insp-roll-host .pr-toolbar .editor-grid-control:has(button) span');
  await expect(octLabel).toHaveText(/^C-?\d+$/);

  // Drums clip → edit row visible, the grid-control is the "Grid" resolution <select>.
  const drums = await laneIdForEngine(page, 'drums-machine');
  await openClip(page, drums);
  await expect(page.locator('#insp-edit-row')).toBeVisible();
  const gridCtl = page.locator('#insp-roll-host .editor-grid-control');
  await expect(gridCtl).toContainText('Grid');
  await expect(gridCtl.locator('select')).toHaveCount(1);

  // Audio clip → edit row hidden. The audio editor surfaces the warp/loop
  // controls (Warp on/off, loop quantize free/beat/bar, Transcribe loop) but
  // never a numeric tempo readout, so there is no "bpm" text. ("bar" now appears
  // legitimately as a loop-quantize option, so it is no longer a useful negative.)
  await addAudioChannel(page);
  await expect(page.locator('#session-inspector')).toBeVisible();
  await expect(page.locator('#insp-edit-row')).toBeHidden();
  const headerText = (await page.locator('#insp-roll-host').innerText()).toLowerCase();
  expect(headerText).not.toContain('bpm');
});

test('3 · Clip buttons carry honest labels and tooltips', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  const lane = await laneIdForEngine(page, 'tb303');
  await openClip(page, lane);

  await expect(page.locator('#insp-copy')).toHaveText('Copy notes');
  await expect(page.locator('#insp-paste-replace')).toHaveText('Paste ▸ Replace');
  await expect(page.locator('#insp-paste-layer')).toHaveText('Paste ▸ Layer');
  // The toggle's tooltip is explicit that it never re-pitches/re-sounds the clip.
  await expect(page.locator('#insp-toggle-editor')).toHaveAttribute(
    'title', /does not change the sound/i,
  );
});

test('4 · Octave is operable from the UI and matches the x shortcut', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  const lane = await laneIdForEngine(page, 'tb303');
  await openClip(page, lane);

  // The octave grid-control is the one with the ◂/▸ buttons (the other
  // .editor-grid-control is the Grid resolution <select>, no buttons).
  const octCtl = page.locator('#insp-roll-host .pr-toolbar .editor-grid-control:has(button)');
  const octLabel = octCtl.locator('span');
  const upBtn = octCtl.getByRole('button', { name: '▸' });

  const before = await octLabel.textContent();
  await upBtn.click();
  const afterClick = await octLabel.textContent();
  expect(afterClick).not.toBe(before); // C4 → C5 (or whatever the next step is)

  // Pressing `x` on the focused editor wrap steps the octave the same way.
  const wrap = page.locator('#insp-roll-host div[tabindex="0"]').first();
  await wrap.focus();
  await page.keyboard.press('x');
  const afterKey = await octLabel.textContent();
  expect(afterKey).not.toBe(afterClick);
});

test('5 · The view toggle flips on the first click (no no-op)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  const lane = await laneIdForEngine(page, 'tb303');
  await openClip(page, lane);

  const toggle = page.locator('#insp-toggle-editor');
  // A melodic clip resolves to the piano roll, so the button offers the grid.
  await expect(toggle).toHaveText('View as grid');
  // The melodic editor really is a piano roll right now.
  await expect(page.locator('#insp-roll-host .pr-toolbar')).toHaveCount(1);

  await toggle.click();
  // One click swaps to the drum grid and relabels to offer the way back.
  await expect(toggle).toHaveText('View as piano roll');
  await expect(page.locator('#insp-roll-host .editor-grid-control select')).toHaveCount(1);
  await expect(page.locator('#insp-roll-host .pr-toolbar')).toHaveCount(0);
});

test('6 · The "?" button reveals the keyboard legend', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  const lane = await laneIdForEngine(page, 'tb303');
  await openClip(page, lane);

  const help = page.locator('#insp-roll-host .editor-help-btn');
  await expect(help).toHaveText('?');
  const popover = page.locator('#insp-roll-host .editor-help-popover');
  await expect(popover).toBeHidden();

  await help.click();
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('a s d f');
  await expect(popover).toContainText('Ctrl+A');
});

test('7 · Launch quantize persists across reopen and undoes', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  const lane = await laneIdForEngine(page, 'tb303');
  await openClip(page, lane);

  const quantize = page.locator('#insp-quantize');
  await quantize.selectOption('1/1'); // "1 bar"
  await expect(quantize).toHaveValue('1/1');

  // Reopen the inspector → the chosen value survives the re-render.
  await openClip(page, lane);
  await expect(page.locator('#insp-quantize')).toHaveValue('1/1');

  // Undo reverts to the clip's original (unset) launch quantize.
  await page.keyboard.press('Control+z');
  await openClip(page, lane);
  await expect(page.locator('#insp-quantize')).toHaveValue('');
});
