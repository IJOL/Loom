// The SOUND control's rack, in a real browser.
//
// Everything this file pins is invisible to the unit suite by construction. What
// a slot may HOLD is decided from the live engine registry, and that registry is
// only complete once the plugins have been fetched over HTTP — so a rule that
// looks right in a fixture can still put an engine in a slot that has no
// renderer in the worklet, which is silence with a full-looking dropdown above
// it. And whether the crossfade actually ARRIVES somewhere can only be measured
// at the master.
import { test, expect, type Page } from '@playwright/test';
import { installMasterTap, measureMaster, waitForAudible, waitForBoot } from './helpers';

const WEAVE_TAB = '#mode-toggle .mode-btn[data-mode="weave"]';
const PANEL = '#panel-view-weave';

// The boot demo's 303 lane: a melodic engine with clips in every scene, so it
// makes sound without this file having to author any.
const LANE = '303 1';
const LANE_ENGINE = 'tb303';

function row(page: Page) {
  return page.locator(`${PANEL} .weave-lane-wrap`)
    .filter({ has: page.locator('.weave-lane-name', { hasText: LANE }) })
    .first();
}

async function openWeave(page: Page) {
  await page.locator(WEAVE_TAB).click();
  await expect(page.locator(`${PANEL} .weave-rack`)).toBeVisible();
}

/** Turn the SOUND control on for the 303 row and wait for the rack it builds. */
async function soundOn(page: Page) {
  const r = row(page);
  await r.locator('.weave-sound-btn').click();
  await expect(r.locator('.weave-slot-btn')).toHaveCount(2);
  return r;
}

test('turning SOUND on fills the second slot with an instrument that can make sound', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await openWeave(page);

  const r = await soundOn(page);
  await r.locator('.weave-slot-btn').nth(1).click();

  // The Sampler and the drum machine run in processors of their own and are
  // unreachable from the worklet's renderer registry, so a slot holding one is
  // skipped at spawn: a dropdown naming an instrument that cannot make a sound.
  const held = await r.locator('select.weave-engine').inputValue();
  expect(held).not.toBe('sampler');
  expect(held).not.toBe('drums-machine');
  // And what it IS: the lane's own instrument, duplicated. Turning the control
  // on must not swap in an instrument nobody asked for — you cross towards
  // whatever you put in slot 2 yourself.
  expect(held).toBe(LANE_ENGINE);
});

test('the far end of the SOUND control is not silence', async ({ page }) => {
  await installMasterTap(page);
  await page.goto('/');
  await waitForBoot(page);

  // A trusted click, which is also what resumes the AudioContext.
  await page.locator('.session-scene-launch').first().click();
  await waitForAudible(page);

  await openWeave(page);
  const r = await soundOn(page);
  // Solo, so the master carries THIS lane and nothing else — otherwise the drums
  // alone would keep the measurement above the floor and the assertion would
  // pass over a silent slot.
  await r.locator('.weave-tbtn.solo').click();
  await waitForAudible(page);

  const near = await measureMaster(page, 1200);
  expect(near.peak).toBeGreaterThan(0.01);

  // All the way to the far end: gains are l0 = 0, l1 = 1.
  await r.locator('.weave-sound-fader').fill('1');
  await page.waitForTimeout(400);
  const far = await measureMaster(page, 1200);

  // Relative, per the project's assertion rule: the far end need not match the
  // near one — a different instrument is a different level — but it must be
  // sound rather than silence.
  expect(far.avgRms).toBeGreaterThan(near.avgRms * 0.25);
  expect(far.nearSilent).toBeLessThan(far.frames * 0.2);
});

test('changing a slot preset leaves you on that slot', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await openWeave(page);

  const r = await soundOn(page);
  await r.locator('.weave-slot-btn').nth(1).click();
  await expect(r.locator('.weave-slot-btn').nth(1)).toHaveClass(/on/);

  const preset = r.locator('select.weave-preset');
  const values = await preset.locator('option').evaluateAll(
    (os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  expect(values.length).toBeGreaterThan(1);
  const chosen = values[values.length - 1];
  await preset.selectOption(chosen);

  // The panel remounts on this write, and the row's open slot used to be a
  // local of that mount — so the row came back showing instrument 1 and the
  // preset you had just chosen was nowhere on screen. Reported as "no lo pone y
  // salta a layer 1".
  await expect(r.locator('.weave-slot-btn').nth(1)).toHaveClass(/on/);
  await expect(r.locator('select.weave-preset')).toHaveValue(chosen);
});

test('building and editing a rack leaves the audio alive', async ({ page }) => {
  // The hang this file was written for: the panel went on animating, the
  // transport lights were right, and nothing came out. A dead worklet looks
  // exactly like that from the DOM, so the only witness is the master plus
  // whatever the page threw.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await installMasterTap(page);
  await page.goto('/');
  await waitForBoot(page);

  await page.locator('.session-scene-launch').first().click();
  await waitForAudible(page);

  await openWeave(page);
  const r = await soundOn(page);
  await r.locator('.weave-tbtn.solo').click();
  await r.locator('.weave-slot-btn').nth(1).click();

  // Swap what slot 2 holds — which REBUILDS the lane, since a lane's params are
  // numbered once for its lifetime — then give it a preset, then cross to it.
  const engines = r.locator('select.weave-engine');
  const other = (await engines.locator('option').evaluateAll(
    (os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  )).find((id) => id !== LANE_ENGINE);
  expect(other).toBeTruthy();
  await engines.selectOption(other!);
  await page.waitForTimeout(300);

  await r.locator('.weave-slot-btn').nth(1).click();
  const presets = r.locator('select.weave-preset');
  const names = await presets.locator('option').evaluateAll(
    (os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  if (names.length) await presets.selectOption(names[names.length - 1]);
  await page.waitForTimeout(300);

  for (const x of ['0.25', '0.5', '0.75', '1']) {
    await r.locator('.weave-sound-fader').fill(x);
    await page.waitForTimeout(150);
  }

  await waitForAudible(page, 5000);
  const after = await measureMaster(page, 1500);
  expect(after.peak).toBeGreaterThan(0.01);
  expect(after.nearSilent).toBeLessThan(after.frames * 0.2);
  expect(errors).toEqual([]);
});
