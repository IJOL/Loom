import { test, expect, type Page, type Locator } from '@playwright/test';
import { openLane } from './helpers';

// The interactions the lit-html migration rewired from addEventListener to
// template bindings, and which no automated test covered before: a knob drag,
// the modulator card's mode toggles, the select-control radio strip, and the
// insert rack. Each one is a place where a repaint could plausibly drop a
// listener, reset a control mid-gesture, or rebuild a widget that owns pointer
// capture — none of which a render-structure assertion would catch.

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

/** Drags a knob's SVG vertically. `page.mouse` does not auto-scroll the way
 *  locator actions do, so an off-screen knob would silently receive nothing. */
async function dragKnob(page: Page, knob: Locator, dy: number): Promise<void> {
  await knob.scrollIntoViewIfNeeded();
  const box = await knob.locator('.knob-svg').boundingBox();
  if (!box) throw new Error('knob has no layout box');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx, cy + (dy * i) / 10);
  await page.mouse.up();
}

test('dragging a knob changes its value and marks the gesture', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await openLane(page, 'tb-303-1');

  const knob = page.locator('.knob').first();
  const before = Number(await knob.getAttribute('data-value-norm'));

  await knob.scrollIntoViewIfNeeded();
  const box = await knob.locator('.knob-svg').boundingBox();
  const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 20);
  // The drag class proves pointerdown landed on the widget, not on a wrapper.
  await expect(knob).toHaveClass(/dragging/);
  await page.mouse.move(cx, cy - 50);
  await page.mouse.up();

  const after = Number(await knob.getAttribute('data-value-norm'));
  expect(after).toBeGreaterThan(before);   // dragging up raises the value
  await expect(knob).not.toHaveClass(/dragging/);
});

test('a knob drag survives an unrelated repaint of the panel around it', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await openLane(page, 'tb-303-1');

  const knob = page.locator('.knob').first();
  const raised = async () => Number(await knob.getAttribute('data-value-norm'));
  await dragKnob(page, knob, -50);
  const afterDrag = await raised();

  // Toggling the modulator repaints the panel; a cached widget must keep its
  // value rather than being rebuilt from the engine defaults.
  const onOff = page.locator('.mod-card-row button', { hasText: /^(ON|OFF)$/ }).first();
  await onOff.click();
  await onOff.click();
  expect(await raised()).toBe(afterDrag);
});

test('LFO FREE/SYNC swaps the RATE knob for the BARS field and back', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await openLane(page, 'tb-303-1');

  const modeBtn = page.locator('.mod-card button', { hasText: /^(FREE|SYNC)$/ }).first();
  await modeBtn.scrollIntoViewIfNeeded();
  const rateKnob = page.locator('.mod-card .knob-label', { hasText: 'RATE' });

  await expect(modeBtn).toHaveText('FREE');
  await expect(rateKnob).toHaveCount(1);
  await expect(page.locator('.mod-bars-field')).toHaveCount(0);

  await modeBtn.click();
  await expect(modeBtn).toHaveText('SYNC');
  await expect(page.locator('.mod-bars-field')).toHaveCount(1);
  await expect(rateKnob).toHaveCount(0);

  await modeBtn.click();
  await expect(modeBtn).toHaveText('FREE');
  await expect(rateKnob).toHaveCount(1);
  await expect(page.locator('.mod-bars-field')).toHaveCount(0);
});

test('the modulator ON/OFF button reflects the state it just set', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await openLane(page, 'tb-303-1');

  const onOff = page.locator('.mod-card-row button', { hasText: /^(ON|OFF)$/ }).first();
  await onOff.scrollIntoViewIfNeeded();
  await expect(onOff).toHaveText('ON');
  await expect(onOff).toHaveClass(/primary/);
  await onOff.click();
  await expect(onOff).toHaveText('OFF');
  await expect(onOff).not.toHaveClass(/primary/);
  await onOff.click();
  await expect(onOff).toHaveText('ON');
});

test('a select-control radio strip activates the option that was clicked', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await openLane(page, 'tb-303-1');

  const strip = page.locator('.mod-card .radio-btn');
  await strip.first().scrollIntoViewIfNeeded();
  expect(await strip.count()).toBeGreaterThan(2);

  await strip.nth(2).click();
  await expect(strip.nth(2)).toHaveClass(/active/);
  // Exactly one option in that strip stays active.
  const parent = strip.nth(2).locator('xpath=..');
  await expect(parent.locator('.radio-btn.active')).toHaveCount(1);
});

test('adding an insert mounts a live unit with its own knobs', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await openLane(page, 'tb-303-1');

  // Every lane owns a rack, so anchor on the VISIBLE one — the open lane's —
  // instead of an index. Scroll by the button, not the rack: the rack's mount
  // host is `display: contents` to keep the flex column's gaps intact, and an
  // element with no box counts as invisible to Playwright.
  const addBtn = page.locator('.insert-add:visible').first();
  await addBtn.scrollIntoViewIfNeeded();
  const rack = page.locator('.insert-rack').filter({ has: page.locator('.insert-add:visible') }).first();
  const unitsBefore = await rack.locator('.insert-unit').count();

  await addBtn.click();
  await rack.locator('.insert-add-picker').selectOption({ label: 'Delay' });

  const units = rack.locator('.insert-unit');
  await expect(units).toHaveCount(unitsBefore + 1);
  const added = units.filter({ has: page.locator('.insert-name', { hasText: 'Delay' }) }).first();
  await expect(added).toBeVisible();
  // A mounted insert brings real knobs, not just a title row.
  expect(await added.locator('.knob').count()).toBeGreaterThan(0);

  // Its enable button bypasses the unit, and the unit survives that repaint.
  const enable = added.locator('.insert-btn').first();
  await expect(enable).toHaveText('ON');
  await enable.click();
  await expect(enable).toHaveText('BYP');
  await expect(enable).toHaveClass(/bypassed/);
  await expect(units.filter({ has: page.locator('.insert-name', { hasText: 'Delay' }) })).toHaveCount(1);
});
