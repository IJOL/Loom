import { test, expect, type Page } from '@playwright/test';

// Regression coverage for the "loaded lane shows the CORRECT sound but the preset
// dropdown is empty" bug. When a session/demo (or a MIDI import) loads a lane with
// an enginePresetName, the engine gets the right params (sound is correct) but the
// preset <select> must ALSO reflect which preset is applied. Built-in presets now
// share one vocabulary (`engine:<name>` for every engine; `user:`/`sampler:` are
// the two genuinely-different sources), so we assert vocabulary-agnostically: the
// SELECTED OPTION'S TEXT equals the preset's bare name. An empty dropdown (the bug)
// has selectedIndex === -1 → text "" → the assertion fails, naming the engine.

function selectIdFor(engine: string): string {
  if (engine === 'tb303') return '#bass-preset-select';
  if (engine === 'drums-machine') return '#drums-preset-select';
  return '#poly-preset-select'; // subtractive / fm / wavetable / karplus / sampler
}

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('.session-cell-filled').length > 0, { timeout: 10_000 });
}

/** Open a lane's editor and return the text of its preset dropdown's selected
 *  option ("" when nothing is selected — i.e. the empty-dropdown bug). */
async function selectedPresetText(page: Page, laneId: string, engine: string): Promise<string> {
  await page.locator(`.session-lane-header[data-lane-id="${laneId}"]`).click();
  const sel = page.locator(selectIdFor(engine));
  await expect(sel).toBeVisible();
  return sel.evaluate((s: HTMLSelectElement) => (s.selectedIndex >= 0 ? s.options[s.selectedIndex].text : ''));
}

/** Load a demo by its picker label and wait for its first lane to appear. */
async function loadDemo(page: Page, label: string, firstLaneId: string): Promise<void> {
  await page.locator('#demo-picker').selectOption({ label });
  await page.locator(`.session-lane-header[data-lane-id="${firstLaneId}"]`).waitFor({ state: 'visible', timeout: 10_000 });
}

interface LaneExp { id: string; engine: string; preset: string }

// Demo lane inventory (parsed from public/demos/*.json). Covers subtractive,
// tb303, drums-machine, karplus and wavetable. fm + sampler have no demo lane —
// covered separately by a fixture.
const DEMOS: { label: string; boot?: boolean; lanes: LaneExp[] }[] = [
  { label: 'Minimal Techno', boot: true, lanes: [
    { id: 'tb-303-1',      engine: 'tb303',          preset: 'BASS Acid Classic' },
    { id: 'drums-1',       engine: 'drums-machine',  preset: 'KIT Power' },
    { id: 'subtractive-1', engine: 'subtractive',    preset: 'LEAD Square' },
    { id: 'subtractive-2', engine: 'subtractive',    preset: 'PAD Sweep' },
  ] },
  { label: 'Cordillera', lanes: [
    { id: 'gtr-1',  engine: 'karplus',         preset: 'GTR Nylon Soft Fingerpick' },
    { id: 'bass-1', engine: 'subtractive',     preset: 'BASS Plucky' },
    { id: 'perc-1', engine: 'drums-machine',   preset: 'KIT Jazz' },
  ] },
  { label: 'Neon Drive', lanes: [
    { id: 'wavetable-1', engine: 'wavetable',      preset: 'LEAD Saw Classic' },
    { id: 'pad-1',       engine: 'subtractive',    preset: 'PAD Warm' },
    { id: 'bass-1',      engine: 'subtractive',    preset: 'BASS Punchy' },
    { id: 'drums-1',     engine: 'drums-machine',  preset: 'KIT Electronic' },
  ] },
];

for (const demo of DEMOS) {
  test(`${demo.label}: every loaded lane shows its preset in the dropdown`, async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);
    if (!demo.boot) await loadDemo(page, demo.label, demo.lanes[0].id);

    // Soft so every lane is checked and reported (a per-engine matrix), instead
    // of stopping at the first failing lane.
    for (const lane of demo.lanes) {
      const text = await selectedPresetText(page, lane.id, lane.engine);
      expect.soft(text, `${demo.label} · ${lane.engine} lane "${lane.id}" preset dropdown`).toBe(lane.preset);
    }
  });
}

// FM has no demo lane, so load a fixture (a minimal-techno variant whose second
// lane is FM with a known preset). Injects the fixture as a demo-picker option so
// it goes through the SAME loadDemoSession path a real demo does.
test('FM: a loaded FM lane shows its preset in the dropdown', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.evaluate((path) => {
    const sel = document.getElementById('demo-picker') as HTMLSelectElement;
    const o = document.createElement('option'); o.value = path; o.textContent = 'fixture-fm';
    sel.appendChild(o); sel.value = path; sel.dispatchEvent(new Event('change'));
  }, '/demos/_fixture-fm.json');
  await page.locator('.session-lane-header[data-lane-id="subtractive-2"]').waitFor({ state: 'visible', timeout: 10_000 });
  const text = await selectedPresetText(page, 'subtractive-2', 'fm');
  expect(text, 'FM lane preset dropdown').toBe('EP Classic Tine');
});
