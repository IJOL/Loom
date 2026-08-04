import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addLane, openLane, waitForBoot } from './helpers';

// The one check that can tell "the host obeys the manifest it fetched" apart
// from "the host obeys a copy baked in at build time" — before this slice,
// `loadPlugins` fetched `plugin.json`, validated it, then ran a copy of the
// same components esbuild had inlined into `main.js` at build time, so an
// edit to the file on disk was invisible to the running app. The whole unit
// suite (3736 tests) is green under EITHER behaviour, because none of it
// touches the built artifact — this test edits the artifact itself.
//
// `vite preview` (what `test:e2e` boots — see playwright.config.ts) serves
// `dist/`, which `vite build` populates by copying `public/` verbatim. So
// `dist/plugins/karplus/plugin.json` is the exact file the browser fetches at
// `/plugins/karplus/plugin.json`; `public/plugins/karplus/plugin.json` is its
// tracked source and editing it would (a) never reach the already-built
// server for this run and (b) dirty a committed file. `dist/` is gitignored,
// so mutating it needs no git cleanup, but it is restored anyway so a second
// `playwright test` run in the same `dist/` (no rebuild) sees the real file.
const MANIFEST = join(process.cwd(), 'dist', 'plugins', 'karplus', 'plugin.json');

test('the UI follows a hand-edited plugin.json, not a copy baked into main.js', async ({ page }) => {
  const original = readFileSync(MANIFEST, 'utf8');
  try {
    const raw = JSON.parse(original);
    // components[0].params[0] is Karplus's "string.damping" param ("Damping").
    // It is a continuous knob, not a discrete <select> or an SVG-drawn value —
    // engine-param-grid.ts renders its label as plain text in a `.knob-label`
    // div (knob.ts), so the edit shows up verbatim with no truncation,
    // uppercasing, or markup to survive. "EDITED" does not collide with any
    // existing UI string (checked: no hit anywhere under src/, tests/, public/).
    raw.components[0].params[0].label = 'EDITED';
    writeFileSync(MANIFEST, JSON.stringify(raw));

    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/');
    await waitForBoot(page);

    // Karplus has no lane in the boot demo (minimal-techno.json ships tb303,
    // drums-machine and two subtractive lanes), so create one through the
    // engine selector — the same "+" add-lane path engine-knobs.spec.ts uses
    // for every melodic engine, including karplus.
    const laneId = await addLane(page, 'karplus');
    await openLane(page, laneId);

    // Presence, not absence: the edited label must BE on screen. This plan
    // was burned twice by acceptance tests that only proved something was
    // MISSING — a plugin that failed to load, or an engine selector that
    // silently fell back to a different lane, would also show no "Damping"
    // knob, and an absence check on the old label would pass for the wrong
    // reason. Only "EDITED" being visible proves the fetched file was read.
    const editor = page.locator('[data-page="poly"]');
    await expect(editor.locator('.knob-label:visible', { hasText: 'EDITED' }).first()).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    // Restore even on failure, so a broken run never leaves the built
    // artifact (or a later test run against the same dist/) mutated.
    writeFileSync(MANIFEST, original);
  }
});
