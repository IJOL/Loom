import { test, expect, type Page } from '@playwright/test';
import { openLane } from './helpers';

// Every melodic engine must render ITS OWN knobs when its lane is opened, and
// show the "🎲 Sound" dice; the engines whose sound is a loaded thing must show
// no dice at all.
//
// The failure this exists to catch is an editor that comes up EMPTY — no unit
// test sees it, because the knobs are built by buildParamUI into live DOM from
// the engine's declared spec. The TB-303 is in the list for a concrete reason:
// it used to be edited on a page of its own, and when that page was deleted the
// whole route had zero coverage. This is that cover.
//
// The knob names below are a SIGNATURE, not the full spec: enough that "nothing
// rendered" and "the previous engine's controls are still up" both fail, while
// adding a param to an engine does not break the test.

interface EngineCase {
  id: string;
  /** Knob labels a user expects to see for this engine, verbatim from its spec. */
  knobs: string[];
}

const MELODIC: EngineCase[] = [
  { id: 'tb303',       knobs: ['Cutoff', 'Resonance', 'Env', 'Decay', 'Accent'] },
  { id: 'subtractive', knobs: ['Osc1 Lvl', 'Cutoff', 'Resonance'] },
  // NOT 'Algorithm': it is a discrete param that opts into `selectStyle:
  // 'dropdown'`, so it renders as a <select>, not a knob (engine-param-grid.ts).
  { id: 'fm',          knobs: ['Mix', 'Op1 Ratio', 'Op4 Rel'] },
  { id: 'wavetable',   knobs: ['Wave A', 'Wave B', 'Morph'] },
  { id: 'westcoast',   knobs: ['Fold', 'Symmetry', 'Ratio'] },
  { id: 'karplus',     knobs: ['Damping', 'Brightness', 'Excite'] },
];

/** Add a lane with `engineId` via the "+" menu and return the new lane's id. */
async function addLane(page: Page, engineId: string): Promise<string> {
  const before = await page.$$eval('.session-lane-header', (tabs) =>
    tabs.map((t) => (t as HTMLElement).dataset.laneId ?? ''),
  );
  await page.click('.session-lane-add');
  await page.click(`.session-add-item[data-engine-id="${engineId}"]`);
  await page.waitForFunction(
    (n) => document.querySelectorAll('.session-lane-header').length > n,
    before.length,
  );
  const after = await page.$$eval('.session-lane-header', (tabs) =>
    tabs.map((t) => (t as HTMLElement).dataset.laneId ?? ''),
  );
  const newId = after.find((id) => !before.includes(id));
  if (!newId) throw new Error(`addLane(${engineId}): could not find the new lane id`);
  return newId;
}

/** The lane editor lives on the poly page — for EVERY melodic engine, the
 *  TB-303 included. There is no second page. */
function editor(page: Page) {
  return page.locator('[data-page="poly"]');
}

/** Knob labels are literal text, and some carry regex metacharacters ("FB (op4)"). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const eng of MELODIC) {
  test(`${eng.id}: opening its lane shows its own knobs and a dice`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/');

    const laneId = await addLane(page, eng.id);
    await openLane(page, laneId);

    // The editor is the poly page and it is the one on screen.
    await expect(editor(page)).toBeVisible();

    for (const label of eng.knobs) {
      // `:visible` used to be load-bearing: Subtractive's section knobs stayed
      // MOUNTED for every lane, merely hidden by CSS, so a page showing a TB-303
      // held two "Cutoff" labels — the hidden subtractive one and the real one.
      // That static markup is gone (this branch): every engine now builds its
      // knobs from its own declared spec, so only the active lane's knobs exist
      // in the DOM at all. `:visible` is kept anyway as belt-and-braces — it is
      // still correct, just no longer covering a live corpse.
      await expect(
        editor(page).locator('.knob-label:visible', { hasText: new RegExp(`^${escapeRe(label)}$`, 'i') }).first(),
        `${eng.id} should render a visible "${label}" knob`,
      ).toBeVisible();
    }

    // A melodic engine rolls its declared params, so it declares isRandomizable
    // (by saying nothing) and gets the dice.
    await expect(editor(page).locator('#poly-randomize')).toBeVisible();

    expect(errors).toEqual([]);
  });
}

test('the TB-303 has no page of its own', async ({ page }) => {
  await page.goto('/');
  // The lane exists at boot; the point is that editing it does not open a
  // `data-page="303"`, because there is no such page any more.
  await expect(page.locator('[data-page="303"]')).toHaveCount(0);
  await openLane(page, 'tb-303-1');
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator('#poly-randomize')).toBeVisible();
});

test('an engine whose sound is a loaded thing shows NO dice', async ({ page }) => {
  await page.goto('/');

  // Sampler: its sound is a keymap, not a bag of params — isRandomizable: false.
  const samplerLane = await addLane(page, 'sampler');
  await openLane(page, samplerLane);
  await expect(editor(page).locator('#poly-randomize')).toHaveCount(0);

  // Non-vacuity: the same slot DOES get a dice once a melodic lane is opened,
  // so the assertion above is about the capability and not about the page being
  // blank or the selector being wrong.
  const fmLane = await addLane(page, 'fm');
  await openLane(page, fmLane);
  await expect(editor(page).locator('#poly-randomize')).toBeVisible();
});

test('the drum machine shows no dice either', async ({ page }) => {
  await page.goto('/');
  await openLane(page, 'drums-1');
  // Drums keep their own page (pads, kits, bus knobs are genuinely different),
  // and `drums-machine` declares isRandomizable: false — a kit is a preset.
  await expect(page.locator('#poly-randomize')).toHaveCount(0);
});
