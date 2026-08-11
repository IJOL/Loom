// Putting a lane on a topology, and taking it off again.
//
// These are here rather than in a unit test because the thing that was broken
// only existed on screen. The topology was three buttons, so weaving could be
// turned on and never off; and a CLOUD given a speed slid along one horizontal
// line, because the flow is one number and a cloud is two. Both are the kind of
// bug a green unit suite reports as working.
import { test, expect, type Page } from '@playwright/test';
import { waitForBoot } from './helpers';

const WEAVE_TAB = '#mode-toggle .mode-btn[data-mode="weave"]';
const PANEL = '#panel-view-weave';
const ROW = `${PANEL} .weave-lane-wrap`;

async function openWeave(page: Page) {
  await page.locator(WEAVE_TAB).click();
  await expect(page.locator(`${PANEL} .weave-rack`)).toBeVisible();
}

/** The first lane's topology dropdown. */
const topoOf = (page: Page) => page.locator(`${ROW} .weave-topo`).first();
/** The first lane's loop cell — whatever its topology calls for. */
const cellOf = (page: Page) => page.locator(`${ROW} .weave-cell`).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await openWeave(page);
});

test('a lane starts off, and the dropdown says so', async ({ page }) => {
  // The whole feature is additive: a session nobody has woven is a session
  // playing its clips.
  await expect(topoOf(page)).toHaveValue('');
  await expect(cellOf(page).locator('.weave-hint')).toBeVisible();
});

test('Queue is no longer on the shelf', async ({ page }) => {
  // Retired from the CHOICES only. The topology still resolves and a lane saved
  // on it still plays — this asserts what the user can pick, not what the app
  // can do.
  const values = await topoOf(page).locator('option').evaluateAll(
    (os) => os.map((o) => (o as HTMLOptionElement).value),
  );
  expect(values).toEqual(['', 'ab', 'cloud']);
});

test.describe('A→B', () => {
  test('gives the lane two loops and a dial', async ({ page }) => {
    await topoOf(page).selectOption('ab');
    await expect(cellOf(page).locator('.weave-slot')).toHaveCount(2);
    await expect(cellOf(page).locator('.weave-dial')).toHaveCount(1);
    await expect(cellOf(page).locator('.weave-hint')).toHaveCount(0);
  });

  test('names both ends with real loops, not a dash', async ({ page }) => {
    // A first selection is filled from the list the user can actually see. Two
    // empty pickers would be a lane that is weaving nothing.
    await topoOf(page).selectOption('ab');
    for (const i of [0, 1]) {
      const v = await cellOf(page).locator('.weave-slot').nth(i).inputValue();
      expect(v).not.toBe('');
    }
  });

  test('OFF puts the lane back to playing its clip', async ({ page }) => {
    // The bug. With three buttons this was unreachable: once a lane wove, there
    // was no gesture that stopped it.
    await topoOf(page).selectOption('ab');
    await expect(cellOf(page).locator('.weave-slot')).toHaveCount(2);

    await topoOf(page).selectOption('');

    await expect(cellOf(page).locator('.weave-hint')).toBeVisible();
    await expect(cellOf(page).locator('.weave-slot')).toHaveCount(0);
    await expect(topoOf(page)).toHaveValue('');
  });

  test('off and on again is a fresh selection, not a dead row', async ({ page }) => {
    await topoOf(page).selectOption('ab');
    await topoOf(page).selectOption('');
    await topoOf(page).selectOption('ab');
    await expect(cellOf(page).locator('.weave-slot')).toHaveCount(2);
  });
});

test.describe('CLOUD', () => {
  test('gives the lane four corners round a pad', async ({ page }) => {
    await topoOf(page).selectOption('cloud');
    await expect(cellOf(page).locator('.weave-slot')).toHaveCount(4);
    await expect(cellOf(page).locator('.pad2d')).toHaveCount(1);
  });

  test('offers the two paths, on RIM', async ({ page }) => {
    // RIM is the default AND what an absent path means, so every cloud saved
    // before paths existed reads as this.
    const paths = cellOf(page).locator('.weave-path .weave-topo-btn');
    await topoOf(page).selectOption('cloud');
    await expect(paths).toHaveCount(2);
    await expect(paths.first()).toHaveClass(/on/);
    await expect(paths.nth(1)).not.toHaveClass(/on/);
  });

  test('CROSS takes over from RIM', async ({ page }) => {
    await topoOf(page).selectOption('cloud');
    const paths = cellOf(page).locator('.weave-path .weave-topo-btn');
    await paths.nth(1).click();
    await expect(paths.nth(1)).toHaveClass(/on/);
    await expect(paths.first()).not.toHaveClass(/on/);
  });

  test('the flow drags the dot in BOTH axes', async ({ page }) => {
    // THE bug, and the only assertion here that a unit test could not have
    // made cheaply: this needs the audio clock, because the flow travels on the
    // scheduling tick and not on the panel's animation.
    //
    // The dot's position is read off the style the pad paints. A cloud starts
    // at the top-left corner, so `top` is 0 and stays 0 for the first quarter
    // of the lap — the whole point is that it does NOT stay 0 after that.
    await topoOf(page).selectOption('cloud');
    const dot = cellOf(page).locator('.pad2d-dot');
    await expect(dot).toHaveCount(1);

    await page.locator(`${PANEL} .weave-speed`).selectOption('4');
    // A trusted click: it is the play gesture AND what resumes the AudioContext.
    await page.locator('#play').click();

    // Waited FOR, never slept through — a quarter of a four-bar lap is about
    // two seconds at the demo tempo and a fixed wait would be a race either way.
    await page.waitForFunction(() => {
      const d = document.querySelector('#panel-view-weave .pad2d-dot') as HTMLElement | null;
      return !!d && parseFloat(d.style.top) > 1;
    }, undefined, { timeout: 20_000 });

    const at = await dot.evaluate((d) => ({
      x: parseFloat((d as HTMLElement).style.left),
      y: parseFloat((d as HTMLElement).style.top),
    }));
    // Inside the square, not off it: the path is the square's outline.
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.x).toBeLessThanOrEqual(100);
    expect(at.y).toBeLessThanOrEqual(100);

    await page.locator('#stop').click();
  });
});
