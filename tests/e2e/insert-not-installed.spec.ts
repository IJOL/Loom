import { test, expect, type Page } from '@playwright/test';
import { waitForBoot, openLane } from './helpers';

// §5.6 of the design: the gap where an uninstalled insert used to be must be
// visible WHERE SOMEONE LOOKS, and that has to be proven in a browser rather
// than read off the code. Phase 2 learned this the expensive way — its
// missing-ENGINE notice existed only inside the lane editor, so a session just
// had a track that mysteriously did not sound, and an e2e is what caught it.
// The unit tests around buildLaneInsertUI already pin the markup; what they
// cannot pin is that a real boot, a real save and a real reload put it on screen.
//
// Every assertion here affirms a PRESENCE. The acceptance of the earlier slice
// was a mirage twice over because it certified absences: a broken plugin gave
// exactly the same green as a working one.

const SAVE_NAME = 'E2E insert not installed';
const LANE = 'tb-303-1';

/** The installed set minus one id, served in place of the real index. Deleting
 *  `public/plugins/<id>/` is indistinguishable from this: a browser cannot list
 *  a directory, so index.json IS the installed set. */
async function withoutPlugin(page: Page, drop: string): Promise<void> {
  await page.route('**/plugins/index.json', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { plugins: string[] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ plugins: body.plugins.filter((p) => p !== drop) }),
    });
  });
}

/** The open lane's rack. Anchored on the VISIBLE add button rather than an
 *  index, because every lane owns a rack and only one of them is on screen. */
function openRack(page: Page) {
  return page.locator('.insert-rack').filter({ has: page.locator('.insert-add:visible') }).first();
}

/** Put a Delay on the TB-303 lane and store the session under SAVE_NAME. */
async function saveASessionUsingTheDelay(page: Page): Promise<void> {
  await openLane(page, LANE);
  const addBtn = page.locator('.insert-add:visible').first();
  await addBtn.scrollIntoViewIfNeeded();
  const rack = openRack(page);
  await addBtn.click();
  await rack.locator('.insert-add-picker').selectOption({ label: 'Delay' });
  await expect(rack.locator('.insert-unit', { has: page.locator('.insert-name', { hasText: 'Delay' }) }))
    .toHaveCount(1);

  await page.locator('#save').click();
  await expect(page.locator('#save-manager-modal')).toBeVisible();
  await page.locator('#save-manager-name').fill(SAVE_NAME);
  await page.locator('#save-manager-save').click();
  await expect(page.locator('#save-manager-list')).toContainText(SAVE_NAME);
  await page.locator('#save-manager-close').click();
}

/** Load SAVE_NAME back through the save manager — the same route a user takes. */
async function loadThatSession(page: Page): Promise<void> {
  await page.locator('#save').click();
  await expect(page.locator('#save-manager-modal')).toBeVisible();
  await page.locator('.save-manager-row', { hasText: SAVE_NAME })
    .locator('[data-act="load"]').click();
  await expect(page.locator('#save-manager-modal')).toBeHidden();
}

test('a session whose delay is uninstalled shows a marked slot that keeps its settings', async ({ page }) => {
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await waitForBoot(page);
  await saveASessionUsingTheDelay(page);

  // Now the plugin folder goes away, and the same session comes back.
  await withoutPlugin(page, 'delay');
  await page.reload();
  await waitForBoot(page);
  await loadThatSession(page);
  await openLane(page, LANE);

  // 1. The slot is THERE, marked, naming the plugin it is waiting for. Not a
  //    silent gap and not a bypass — those are the two things it must not be
  //    mistaken for.
  const missing = openRack(page).locator('.insert-unit-missing');
  await expect(missing).toHaveCount(1);
  await expect(missing.locator('.insert-name')).toContainText('⚠');
  await expect(missing.locator('.insert-name')).toContainText('delay');
  await expect(missing).toHaveAttribute('title', /This slot keeps its settings/);

  // 2. The console said so once, in words, without throwing. An absent plugin
  //    is an ordinary state.
  expect(warnings.filter((w) => w.includes('"delay" is not installed'))).toHaveLength(1);
  expect(errors).toEqual([]);

  // 3. And the settings really survive: saving again re-writes the delay's slot
  //    into the JSON, so uninstalling a plugin never deletes what was set.
  await page.locator('#save').click();
  await page.locator('#save-manager-name').fill('E2E round trip');
  await page.locator('#save-manager-save').click();
  await expect(page.locator('#save-manager-list')).toContainText('E2E round trip');
  // Looked up on the LANE, not with a substring search over the payload: the
  // default sends carry a `delay` slot of their own, so `includes('"delay"')`
  // would pass whether or not the lane's slot survived — a green for the wrong
  // reason, which is the failure mode this acceptance keeps hitting.
  //
  // The payload lives in IndexedDB (localStorage holds only name/date/size —
  // the index outgrew the 5 MB cap once and the JSON moved out).
  const laneKeptIt = await page.evaluate((laneId) => new Promise<boolean>((resolve, reject) => {
    const req = indexedDB.open('tb303-saves', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const all = req.result.transaction('entries', 'readonly').objectStore('entries').getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => resolve((all.result as { json: string }[]).some((rec) => {
        const lanes = (JSON.parse(rec.json) as {
          sessionState?: { lanes?: { id: string; inserts?: { pluginId: string }[] }[] };
        }).sessionState?.lanes ?? [];
        return lanes.some((l) => l.id === laneId && (l.inserts ?? []).some((i) => i.pluginId === 'delay'));
      }));
    };
  }), LANE);
  expect(laneKeptIt, 'the absent plugin\'s slot must survive a save').toBe(true);
});

test('putting the folder back brings the insert back, with its knobs', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await waitForBoot(page);
  await saveASessionUsingTheDelay(page);

  // The uninstalled pass, so this test stands on its own rather than inheriting
  // the previous one's browser (Playwright gives each test a fresh context, so
  // there is no shared localStorage to lean on anyway).
  await withoutPlugin(page, 'delay');
  await page.reload();
  await waitForBoot(page);
  await loadThatSession(page);
  await openLane(page, LANE);
  await expect(openRack(page).locator('.insert-unit-missing')).toHaveCount(1);

  // The folder is back: no interception this time.
  await page.unroute('**/plugins/index.json');
  await page.reload();
  await waitForBoot(page);
  await loadThatSession(page);
  await openLane(page, LANE);

  const restored = openRack(page).locator('.insert-unit')
    .filter({ has: page.locator('.insert-name', { hasText: 'Delay' }) });
  await expect(restored).toHaveCount(1);
  // A real unit, not a title row: the placeholder has no knobs, so this is what
  // separates "the name came back" from "the effect came back".
  expect(await restored.locator('.knob').count()).toBeGreaterThan(0);
  await expect(openRack(page).locator('.insert-unit-missing')).toHaveCount(0);
  expect(errors).toEqual([]);
});
