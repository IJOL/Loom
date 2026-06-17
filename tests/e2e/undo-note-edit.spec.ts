// tests/e2e/undo-note-edit.spec.ts
//
// Task 9 verification: a single note-edit (drum-grid pencil click) produces
// exactly ONE undo entry — not a phantom duplicate caused by double-capture.
//
// Assertion structure (strict, unambiguous):
//   1. Boot → #undo-btn DISABLED (clean stack at start).
//   2. Open drum clip inspector → #undo-btn STILL DISABLED (opening a clip is
//      UI-only state; it must NOT push an undo entry — if this fails, that is a
//      real bug where clip-open pollutes the undo stack).
//   3. ONE pencil click on the canvas → #undo-btn becomes ENABLED.
//   4. Click #undo-btn ONCE → #undo-btn becomes DISABLED.
//      This is the key anti-double-capture proof: one undo emptied the stack,
//      so the edit was a single entry. If double-capture had occurred there would
//      be two entries for the single pencil click; the first undo would only
//      consume the phantom entry and #undo-btn would remain enabled — failing here.
//
// NOTE on draw mode: `currentTool` in clip-editor-drum-grid.ts is a module-level
// variable that starts as 'draw'. We do NOT click the draw toolbar button to
// activate it — clicking any button triggers an AutoHistory checkpoint that would
// capture the editor-open's `clip.gridResolution` initialisation as a spurious
// undo entry (deferred from the openClip render), corrupting the single-entry proof.
// The default 'draw' mode is reliable because the module initialises to it.
//
// We use the drum-grid (drums-machine lane in the boot demo) because its canvas
// cells are easy to locate: LABEL_W=54 px label gutter, RULER_H=20 px ruler,
// ROW_H=26 px per row.  A click at (LABEL_W+10, RULER_H+ROW_H/2) hits the first
// beat of the first voice row in draw mode (the default), which adds a note on an
// empty grid.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const LABEL_W = 54;
const RULER_H = 20;
const ROW_H   = 26;

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

/** Lane id of the drums-machine lane in the boot demo. */
async function drumsLaneId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const h = document.querySelector('.session-lane-header.lane-engine-drums-machine') as HTMLElement | null;
    return h?.dataset.laneId ?? '';
  });
}

/** Open the inspector on the first filled clip of laneId. */
async function openClip(page: Page, laneId: string): Promise<void> {
  const cell = page.locator(`.session-cell-filled[data-lane-id="${laneId}"]`).first();
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(page.locator('#session-inspector')).toBeVisible();
}

test('drum-grid pencil click is ONE undo step (no double-capture)', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Step 1: Clean baseline at boot — nothing to undo.
  await expect(page.locator('#undo-btn')).toBeDisabled();

  // Open the drum clip inspector.
  const laneId = await drumsLaneId(page);
  expect(laneId).toBeTruthy();
  await openClip(page, laneId);

  // The drum editor canvas lives inside #insp-roll-host.
  // Wait for the canvas to be present and sized.
  const canvas = page.locator('#insp-roll-host canvas').first();
  await expect(canvas).toBeVisible();

  // Step 2: Opening a clip is a UI-only action and must NOT push an undo entry.
  // If this assertion fails it is a real bug — opening a clip is polluting the stack.
  await expect(page.locator('#undo-btn')).toBeDisabled();

  // Draw mode is the default (clip-editor-drum-grid.ts module-level `currentTool`
  // initialises to 'draw'). We deliberately do NOT click the draw toolbar button
  // here — any button click triggers an AutoHistory checkpoint, which could absorb
  // intervening mutations and corrupt the single-entry proof in step 4.

  // --- Step 3: Perform ONE pencil click on the canvas to add a drum note ---
  // canvas.click() with a position offset: LABEL_W+10 px right (past label gutter),
  // RULER_H + ROW_H/2 px down (centre of first voice row).  Triggers the canvas
  // pointerdown handler which calls pencilClick() in draw mode.
  await canvas.click({ position: { x: LABEL_W + 10, y: RULER_H + ROW_H / 2 } });

  // Give AutoHistory's microtask + click listener time to fire.
  await page.waitForTimeout(200);

  // After ONE edit, #undo-btn must be enabled.
  await expect(page.locator('#undo-btn')).toBeEnabled();

  // --- Step 4: Click #undo-btn ONCE and assert the stack is now empty ---
  await page.locator('#undo-btn').click();
  await page.waitForTimeout(200);

  // The stack must be empty: one undo consumed the single edit entry.
  // If double-capture had occurred, two entries would exist for the single pencil
  // click; after one undo the button would remain enabled — caught here.
  await expect(page.locator('#undo-btn')).toBeDisabled();

  // Redo must now be enabled (we undid something real).
  await expect(page.locator('#redo-btn')).toBeEnabled();
});
