import { test, expect, type Page } from '@playwright/test';
import { waitForBoot } from './helpers';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../../tools/loom-plugin/build.mjs';

// Slice A's REAL acceptance proof — deleting the `listedInSelector` capability
// (a host-menu decision that had leaked into the manifest as an engine
// property) unblocked this: a plugin declaring `capabilities.clipContent:
// 'audio'` must be reachable from the "add lane" menu like any other engine,
// and creating a lane from it must actually produce an audio-channel lane.
//
// Before this fix, audio-probe copied `listedInSelector: false` from the
// built-in `audio` engine's declaration and was UNREACHABLE from every user
// path — the menu never offered it, so nothing could ever create it. The old
// version of this test only checked the probe's ABSENCE from #engine-select,
// which cannot tell "the host honoured a capability" apart from "the plugin
// never loaded" — and it asserted the very bug (unreachability) as if it were
// the feature.
//
// audio-probe is a DSP-less test fixture: no real user should ever see it, so
// it does NOT ship — `public/plugins/index.json` lists only `karplus`, and
// `public/plugins/audio-probe/` (the built artifact) does not exist. Its
// SOURCE stays at `plugins/audio-probe/` for exactly this test to build. This
// test therefore does double duty: it still proves the capability-driven menu,
// but it now ALSO proves the drop-in contract end-to-end — a plugin can be
// installed at runtime, with the served tree completely untouched, which is
// the real shape of the feature (a user installing a plugin later never edits
// `public/`). It installs audio-probe itself via `page.route`: intercept
// `plugins/index.json` to add it to the list, intercept
// `plugins/audio-probe/**` to serve the files built (by this test, into a
// scratch dir) from `plugins/audio-probe/` — never touching the checked-in
// `public/plugins/`.
//
// Why this works: `plugin-host.ts` fetches `plugin.json` with a plain
// `fetch()` on the main thread, which `page.route` intercepts like any other
// network request — the drop-in proof rests on that interception ALONE.
// audio-probe ships no `main` field (its component is adopted straight from
// the manifest — see loom-api.ts's adoptComponents, the one path a component
// enters by) and no `dsp` field either, so it never reaches
// `addPluginWorkletModule` (`ctx.audioWorklet.addModule`) — the one loading
// path verified elsewhere NOT to be interceptable by `page.route`. Had this
// probe carried a `main` or `dsp`, that path (or `module-loader.ts`'s
// `moduleBlobUrl`, for `main`) would need its own proof.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let builtDir: string;
let scratchRoot: string;

test.beforeAll(async () => {
  scratchRoot = mkdtempSync(join(tmpdir(), 'loom-plugin-audio-probe-'));
  await buildPlugin({ srcDir: join(REPO_ROOT, 'plugins', 'audio-probe'), outDir: scratchRoot });
  builtDir = join(scratchRoot, 'audio-probe');
});

test.afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

async function installAudioProbeAtRuntime(page: Page): Promise<void> {
  await page.route('**/plugins/index.json', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ plugins: ['karplus', 'audio-probe'] }),
    }));
  await page.route('**/plugins/audio-probe/**', (route) => {
    const url = new URL(route.request().url());
    const marker = '/plugins/audio-probe/';
    const rel = url.pathname.slice(url.pathname.indexOf(marker) + marker.length);
    return route.fulfill({ path: join(builtDir, rel) });
  });
}

test('a plugin that declares itself an audio channel can be created and behaves like one', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await installAudioProbeAtRuntime(page);
  await page.goto('/');
  await waitForBoot(page);

  // 1. The probe is "published" for this run — installed at test time, not
  //    baked into the served tree. (The real public/plugins/index.json lists
  //    only karplus; see public/plugins/index.json.)
  const ids = await page.evaluate(async () => (await (await fetch('plugins/index.json')).json()).plugins);
  expect(ids).toContain('audio-probe');

  // 2. The "+" add-lane menu OFFERS it — this is what the deleted capability
  //    was blocking. Its name comes from the manifest ("Audio Probe").
  const lanesBefore = await page.locator('.session-lane-header').count();
  await page.locator('.session-lane-add').click();
  const probeItem = page.locator('.session-lane-add-menu .session-add-item', { hasText: 'Audio Probe' });
  await expect(probeItem).toBeVisible();

  // 3. Creating a lane from that entry produces a lane whose engineId is
  //    audio-probe (session-grid-templates.ts paints `lane-engine-<id>` on the
  //    header — no other way to name the engine from the DOM without a global).
  await probeItem.click();
  await expect(page.locator('.session-lane-header')).toHaveCount(lanesBefore + 1, { timeout: 10_000 });
  const newHeader = page.locator('.session-lane-header').last();
  await expect(newHeader).toHaveClass(/lane-engine-audio-probe/);

  // 4. The engine-SWAP selector must NOT offer it: isAudioEngine() excludes it
  //    there on purpose (an audio channel cannot become — or be swapped from —
  //    a melodic instrument). Karplus, a plugin with no clipContent override
  //    (i.e. an ordinary melodic instrument), IS there — proof that plugin
  //    loading works on this page and the probe's absence is the capability,
  //    not a loading failure. Karplus renders under its manifest name "Karp".
  const swapOptions = (await page.locator('#engine-select option').allTextContents()).join('|');
  expect(swapOptions).not.toContain('Audio Probe');
  expect(swapOptions.toLowerCase()).toContain('karp');

  // 5. Nothing failed quietly on the way.
  expect(errors).toEqual([]);
});
