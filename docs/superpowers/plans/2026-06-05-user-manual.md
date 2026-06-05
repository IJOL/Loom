# User Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a complete English manual for Loom (user guide chapters 01–09 + developer guide chapter 10) as Markdown with embedded screenshots, plus a generated `Loom-Manual.pdf`, built by a reproducible Playwright-based script.

**Architecture:** Two units. (1) **Content** — `docs/manual/*.md` chapters that link screenshots by relative path (readable on GitHub *and* fed to the PDF). (2) **Generator** — `tools/build-manual.mjs` that programmatically starts `vite preview`, captures element screenshots with Playwright (`tools/manual/shots.mjs`), and renders the chapters to PDF via `marked` → HTML → `page.pdf()` (`tools/manual/pdf.mjs`). A pure helper (`tools/manual/assemble.mjs`) concatenates chapters and rewrites image paths; it is the only unit-tested piece.

**Tech Stack:** Node ESM scripts, `@playwright/test` (already installed — `chromium` + `page.pdf()`), Vite's programmatic `preview()` API, `marked` (new dependency), Vitest (for the one pure helper test).

Spec: [docs/superpowers/specs/2026-06-05-user-manual-design.md](../specs/2026-06-05-user-manual-design.md)

---

## File Structure

**Create:**
- `tools/manual/assemble.mjs` — pure: chapter list, `resolveImageSrc`, `rewriteHtmlImageSrcs`, `assembleHtml`
- `tools/manual/assemble.test.mjs` — Vitest unit test for the pure helper
- `tools/manual/pdf.mjs` — `buildPdf()`: assemble HTML, `page.pdf()`
- `tools/manual/shots.mjs` — `buildShots(baseURL)`: drive the app, capture screenshots
- `tools/manual/shot-list.mjs` — declarative `SHOTS` array `{ name, selector, setup }`
- `tools/manual/manual.css` — print/screen stylesheet for the PDF
- `tools/build-manual.mjs` — orchestrator: start preview, run shots + pdf, stop preview
- `docs/manual/README.md` … `docs/manual/10-developer-guide.md` — the 11 chapters
- `docs/manual/images/` — generated `*.png` (committed)
- `docs/manual/Loom-Manual.pdf` — generated output (committed)

**Modify:**
- `package.json` — add `marked` dep + `build:manual` / `manual:shots` / `manual:pdf` scripts

---

## Task 1: Scaffold — dependency, scripts, directories, CSS

**Files:**
- Modify: `package.json`
- Create: `tools/manual/manual.css`, `docs/manual/.gitkeep` (temporary), `docs/manual/images/.gitkeep`

- [ ] **Step 1: Install `marked`**

Run: `npm install -D marked`
Expected: `marked` appears under `devDependencies` in `package.json`; `node_modules/marked` exists.

- [ ] **Step 2: Add npm scripts**

In `package.json` `"scripts"`, add (after `"preview"`):

```json
    "build:manual": "npm run build && node tools/build-manual.mjs",
    "manual:shots": "node tools/build-manual.mjs --shots-only",
    "manual:pdf": "node tools/build-manual.mjs --pdf-only",
```

- [ ] **Step 3: Create the PDF stylesheet `tools/manual/manual.css`**

```css
:root { --ink:#1a1a1a; --muted:#666; --accent:#7a5cff; --rule:#e3e3e3; }
* { box-sizing: border-box; }
body {
  font: 11pt/1.55 "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
  color: var(--ink); margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.chapter { break-after: page; }
.chapter:last-child { break-after: auto; }
h1 { font-size: 22pt; color: var(--accent); margin: 0 0 .4em; border-bottom: 3px solid var(--accent); padding-bottom: .2em; }
h2 { font-size: 15pt; margin: 1.4em 0 .4em; border-bottom: 1px solid var(--rule); padding-bottom: .15em; }
h3 { font-size: 12pt; margin: 1.1em 0 .3em; }
p, li { orphans: 3; widows: 3; }
img { max-width: 100%; height: auto; border: 1px solid var(--rule); border-radius: 6px; margin: .6em 0; break-inside: avoid; }
figure { break-inside: avoid; margin: .8em 0; }
figcaption { color: var(--muted); font-size: 9.5pt; text-align: center; margin-top: .2em; }
code, pre { font-family: "IBM Plex Mono", "Consolas", monospace; font-size: 9.5pt; }
pre { background: #f6f6f8; border: 1px solid var(--rule); border-radius: 6px; padding: .7em .9em; overflow-x: auto; break-inside: avoid; }
:not(pre) > code { background: #f0f0f4; padding: .1em .35em; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: .6em 0; font-size: 10pt; break-inside: avoid; }
th, td { border: 1px solid var(--rule); padding: .35em .55em; text-align: left; vertical-align: top; }
th { background: #f3f1ff; }
a { color: var(--accent); text-decoration: none; }
blockquote { border-left: 3px solid var(--accent); margin: .8em 0; padding: .2em .9em; color: var(--muted); background: #faf9ff; }
```

- [ ] **Step 4: Create placeholder dirs so the tree exists**

Run (PowerShell):
```powershell
New-Item -ItemType Directory -Force docs/manual/images | Out-Null
New-Item -ItemType File -Force docs/manual/images/.gitkeep | Out-Null
```

- [ ] **Step 5: Verify**

Run: `node -e "import('marked').then(m=>console.log('marked', typeof m.marked))"`
Expected: prints `marked function`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tools/manual/manual.css docs/manual/images/.gitkeep
git commit -m "build(manual): add marked dep, npm scripts, PDF stylesheet, dir scaffold"
```

---

## Task 2: Pure assembly helper (TDD)

**Files:**
- Create: `tools/manual/assemble.mjs`
- Test: `tools/manual/assemble.test.mjs`

- [ ] **Step 1: Write the failing test**

`tools/manual/assemble.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { resolveImageSrc, rewriteHtmlImageSrcs } from './assemble.mjs';

describe('resolveImageSrc', () => {
  it('rewrites a relative image path to a file:// URL under the manual dir', () => {
    const out = resolveImageSrc('images/transport.png', '/repo/docs/manual');
    expect(out.startsWith('file://')).toBe(true);
    expect(out).toContain('/docs/manual/images/transport.png');
  });
  it('leaves absolute http(s) and file URLs untouched', () => {
    expect(resolveImageSrc('https://x/y.png', '/m')).toBe('https://x/y.png');
    expect(resolveImageSrc('file:///a/b.png', '/m')).toBe('file:///a/b.png');
  });
});

describe('rewriteHtmlImageSrcs', () => {
  it('rewrites only relative <img src> values', () => {
    const html = '<img src="images/a.png" alt="a"><img src="https://x/b.png">';
    const out = rewriteHtmlImageSrcs(html, '/repo/docs/manual');
    expect(out).toContain('file://');
    expect(out).toContain('/docs/manual/images/a.png');
    expect(out).toContain('https://x/b.png');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cross-env NO_COLOR=1 npx vitest run tools/manual/assemble.test.mjs`
Expected: FAIL — `Cannot find module './assemble.mjs'` / exports undefined.

- [ ] **Step 3: Implement `tools/manual/assemble.mjs`**

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';

// Chapters, in the fixed reading / PDF order.
export const CHAPTERS = [
  'README.md',
  '01-getting-started.md',
  '02-transport.md',
  '03-sessions-lanes-clips-scenes.md',
  '04-engines.md',
  '05-editing-clips.md',
  '06-modulation-and-note-fx.md',
  '07-mixing-and-fx.md',
  '08-midi-and-samples.md',
  '09-saving-and-export.md',
  '10-developer-guide.md',
];

const ABSOLUTE = /^(?:[a-z]+:)?\/\//i; // http://, https://, //, file:// (file: handled below)

/** Relative `images/x.png` -> absolute `file://…/docs/manual/images/x.png`. */
export function resolveImageSrc(src, manualDir) {
  if (ABSOLUTE.test(src) || src.startsWith('file:')) return src;
  return pathToFileURL(join(manualDir, src)).href;
}

/** Rewrite every relative <img src> in an HTML string to a file:// URL. */
export function rewriteHtmlImageSrcs(html, manualDir) {
  return html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi,
    (_m, pre, src, post) => pre + resolveImageSrc(src, manualDir) + post,
  );
}

/** Read every chapter, convert to HTML, rewrite images, wrap with CSS. */
export function assembleHtml(manualDir, cssText) {
  const sections = CHAPTERS.map((file) => {
    const md = readFileSync(join(manualDir, file), 'utf8');
    const html = rewriteHtmlImageSrcs(marked.parse(md), manualDir);
    return `<section class="chapter">${html}</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${cssText}</style></head><body>${sections.join('\n')}</body></html>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cross-env NO_COLOR=1 npx vitest run tools/manual/assemble.test.mjs`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add tools/manual/assemble.mjs tools/manual/assemble.test.mjs
git commit -m "feat(manual): pure chapter-assembly helper with image-path rewriting"
```

---

## Task 3: PDF phase — `pdf.mjs` + first real PDF

**Files:**
- Create: `tools/manual/pdf.mjs`
- Create (temporary placeholders so the PDF has input): minimal `docs/manual/README.md` + the ten chapter files with a single heading each.

- [ ] **Step 1: Create placeholder chapter files**

Create `docs/manual/README.md` and each of `01-getting-started.md` … `10-developer-guide.md` (exact names from `CHAPTERS`) with just a title line, e.g. `docs/manual/02-transport.md`:

```markdown
# Transport

_(chapter content added in a later task)_
```

`docs/manual/README.md`:

```markdown
# Loom — Manual

Placeholder index. Chapters added in later tasks.
```

- [ ] **Step 2: Implement `tools/manual/pdf.mjs`**

```js
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { assembleHtml } from './assemble.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const MANUAL_DIR = join(here, '..', '..', 'docs', 'manual');
const CSS_PATH = join(here, 'manual.css');
const OUT = join(MANUAL_DIR, 'Loom-Manual.pdf');

export async function buildPdf() {
  const css = readFileSync(CSS_PATH, 'utf8');
  const html = assembleHtml(MANUAL_DIR, css);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // setContent + networkidle so file:// images finish loading before printing.
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: OUT,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await browser.close();
  }
  console.log(`wrote ${OUT}`);
}
```

- [ ] **Step 3: Smoke-run the PDF builder directly**

Run: `node -e "import('./tools/manual/pdf.mjs').then(m=>m.buildPdf())"`
Expected: prints `wrote …/docs/manual/Loom-Manual.pdf`; the file exists and opens as an 11-section PDF (mostly empty placeholders).

- [ ] **Step 4: Commit**

```bash
git add tools/manual/pdf.mjs docs/manual/*.md
git commit -m "feat(manual): PDF builder (marked -> HTML -> page.pdf) + chapter placeholders"
```

---

## Task 4: Screenshot phase — `shot-list.mjs` + `shots.mjs`

**Files:**
- Create: `tools/manual/shot-list.mjs`
- Create: `tools/manual/shots.mjs`

This task captures the **core, deterministic** screenshots (selectors verified against `index.html`). The per-engine screenshots are added in Task 9 where the live UI is available to confirm engine-navigation selectors.

- [ ] **Step 1: Create `tools/manual/shot-list.mjs`**

```js
// Declarative screenshot list. Each shot:
//   name     -> output file docs/manual/images/<name>.png
//   selector -> element to frame (omit for full page)
//   setup    -> async (page) => {} to reach the right UI state before the shot
//
// Selectors below come from index.html. The app boots with a demo loaded, so
// the session grid already has filled cells (no demo-loading needed).

const openFirstClip = async (page) => {
  await page.locator('.session-cell-filled').first().click();
  await page.locator('#session-inspector').waitFor({ state: 'visible' });
};

export const SHOTS = [
  { name: 'app-overview', selector: '.synth' },
  { name: 'transport', selector: '.row.transport' },
  { name: 'session-grid', selector: '#session-grid' },
  { name: 'session-view', selector: '#session-view' },
  {
    name: 'inspector',
    selector: '#session-inspector',
    setup: openFirstClip,
  },
  {
    name: 'export-menu',
    selector: '.export-menu-wrap',
    setup: async (page) => { await page.locator('#export-scene').click();
      await page.locator('#export-menu').waitFor({ state: 'visible' }); },
  },
  {
    name: 'midi-import',
    selector: '.midi-panel',
    setup: async (page) => { await page.locator('.midi-panel > summary').click(); },
  },
  {
    name: 'master-fx',
    selector: '.page[data-page="fx"]',
    setup: async (page) => { await page.locator('.tab[data-tab="fx"]').click();
      await page.locator('.page[data-page="fx"]').waitFor({ state: 'visible' }); },
  },
  {
    name: 'save-manager',
    selector: '.save-manager-dialog',
    setup: async (page) => { await page.locator('#load').click();
      await page.locator('#save-manager-modal').waitFor({ state: 'visible' }); },
  },
];
```

- [ ] **Step 2: Implement `tools/manual/shots.mjs`**

```js
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { SHOTS } from './shot-list.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const IMG_DIR = join(here, '..', '..', 'docs', 'manual', 'images');

async function waitForBoot(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    null, { timeout: 15_000 },
  );
}

export async function buildShots(baseURL, only) {
  mkdirSync(IMG_DIR, { recursive: true });
  const shots = only ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
    });
    for (const shot of shots) {
      await page.goto(baseURL);
      await waitForBoot(page);
      if (shot.setup) await shot.setup(page);
      if (shot.selector) {
        const loc = page.locator(shot.selector).first();
        if (await page.locator(shot.selector).count() === 0)
          throw new Error(`shot "${shot.name}": selector ${shot.selector} matched nothing`);
        await loc.scrollIntoViewIfNeeded();
        await loc.screenshot({ path: join(IMG_DIR, `${shot.name}.png`) });
      } else {
        await page.screenshot({ path: join(IMG_DIR, `${shot.name}.png`), fullPage: true });
      }
      console.log(`shot ${shot.name}.png`);
    }
  } finally {
    await browser.close();
  }
  console.log(`wrote ${shots.length} screenshots`);
}
```

- [ ] **Step 3: Verification deferred to Task 5**

`buildShots` needs a running preview server; it is exercised end-to-end once the orchestrator (Task 5) can start `vite preview`. No standalone run here.

- [ ] **Step 4: Commit**

```bash
git add tools/manual/shot-list.mjs tools/manual/shots.mjs
git commit -m "feat(manual): screenshot phase with declarative shot list"
```

---

## Task 5: Orchestrator — `build-manual.mjs` + end-to-end run

**Files:**
- Create: `tools/build-manual.mjs`

- [ ] **Step 1: Implement `tools/build-manual.mjs`**

```js
// Orchestrates the manual build:
//   default        : screenshots (needs a preview server) + PDF
//   --shots-only   : screenshots only
//   --pdf-only     : PDF only (no server)
//
// Run via npm: build:manual / manual:shots / manual:pdf.
// Assumes dist/ is fresh — `build:manual` runs `npm run build` first.
import { preview } from 'vite';
import { buildShots } from './manual/shots.mjs';
import { buildPdf } from './manual/pdf.mjs';

const args = process.argv.slice(2);
const shotsOnly = args.includes('--shots-only');
const pdfOnly = args.includes('--pdf-only');

async function withPreview(fn) {
  const server = await preview({ preview: { port: 4173, strictPort: true } });
  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:4173/';
  try { await fn(url); }
  finally { await new Promise((res) => server.httpServer.close(res)); }
}

async function main() {
  if (!pdfOnly) await withPreview((url) => buildShots(url));
  if (!shotsOnly) await buildPdf();
  console.log('manual: done.');
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Build the app (preview serves `dist/`)**

Run: `npm run build`
Expected: `tsc` passes and `dist/` is written. (If it fails, fix the build before continuing — the manual build depends on it.)

- [ ] **Step 3: Run screenshots end-to-end**

Run: `npm run manual:shots`
Expected: preview starts on 4173; prints `shot app-overview.png` … `shot save-manager.png`; `wrote 9 screenshots`; `docs/manual/images/` now has 9 PNGs.
If any shot throws `selector … matched nothing`, open the app (`npm run dev`, `http://localhost:5173`), inspect the real markup, fix that shot's `selector`/`setup` in `tools/manual/shot-list.mjs`, and re-run.

- [ ] **Step 4: Run the full manual build**

Run: `npm run build:manual`
Expected: build → 9 screenshots → `wrote …/Loom-Manual.pdf` → `manual: done.`

- [ ] **Step 5: Commit (scripts only; generated assets land in Task 16)**

```bash
git add tools/build-manual.mjs
git commit -m "feat(manual): orchestrator wiring screenshots + PDF via vite preview"
```

---

## Content tasks (06–15)

Each content task writes one chapter as real prose. Shared rules for all content tasks:

- **Voice:** second person, present tense, concise. English. Each user chapter opens with a one-line "what this is", then walks through the controls.
- **Screenshots:** embed with **relative** links and a caption, e.g.
  `![Transport bar](images/transport.png)` followed by `*The transport bar.*`
  Only reference images that exist in `docs/manual/images/` (from Task 4/9).
- **Accuracy:** read the listed source files before writing; describe what the code actually does. Do not invent controls. Cross-link chapters with relative links (`see [Engines](04-engines.md)`).
- **Commit** at the end of each task with message `docs(manual): write <chapter>`.
- **No verification command** beyond "the file exists and its images resolve"; visual PDF check happens in Task 16.

---

## Task 6: Chapter README (index) + 01 Getting Started

**Files:**
- Modify: `docs/manual/README.md`, `docs/manual/01-getting-started.md`

**Sources to read:** `index.html` (overall layout), `src/main.ts` (boot), `src/demo/` (demo picker + baked demos), `README`-level intro in `CLAUDE.md` ("What this is").

- [ ] **Step 1: Write `README.md`** — title + one-paragraph "What is Loom" (browser-based, session music workstation: lanes → clips → scenes; 7 engines; live Web Audio). A Markdown table of contents linking all ten chapters. A line linking the PDF (`[Loom-Manual.pdf](Loom-Manual.pdf)`) and the live demo (`https://ijol.github.io/Loom/`). Embed `images/app-overview.png` with a caption.

- [ ] **Step 2: Write `01-getting-started.md`** — open the app (dev URL / live demo), the at-a-glance layout (transport on top, session grid below), load a demo from the demo picker (`#demo-picker`), press **▶ Play** (`#play`), adjust **Volume**. The mental model: a **lane** is an instrument track, a **clip** is a pattern, a **scene** is a column launched together. Embed `images/app-overview.png` and `images/session-grid.png`.

- [ ] **Step 3: Commit** — `git add docs/manual/README.md docs/manual/01-getting-started.md && git commit -m "docs(manual): write index + getting started"`

---

## Task 7: Chapter 02 Transport

**Files:** Modify `docs/manual/02-transport.md`

**Sources:** `index.html` (`.row.transport`), `src/core/sequencer.ts`, `src/core/transport-state.ts`, `src/core/meter.ts`, swing handling, `src/app/bpm-broadcast.ts`.

- [ ] **Step 1: Write the chapter** — document each transport control by its visible label: **▶ Play/Stop** (`#play`), **BPM** (`#bpm`, 40–240), **Meter** (`#meter`, see [meter.ts]), **Swing** (`#swing`, 0–0.6), **Volume** (`#volume`), **Bars** (`#bars`, view length), the **bar.beat.step** + elapsed readout (`#transport-position` / `#transport-time`), **Session ⇄ Performance** toggle (`#mode-toggle`; note Performance is *work in progress* per the spec), **REC** (`#rec`, records knob moves). Explain step duration = `60 / bpm / 4` (16ths) and that BPM/length changes apply to the next scheduled step. Embed `images/transport.png`.

- [ ] **Step 2: Commit** — `git commit -m "docs(manual): write transport chapter"`

---

## Task 8: Chapter 03 Sessions, Lanes, Clips, Scenes

**Files:** Modify `docs/manual/03-sessions-lanes-clips-scenes.md`

**Sources:** `src/session/session.ts`, `session-ui.ts`, `session-runtime.ts`, `session-host.ts`, `session-inspector.ts`; `index.html` (`#session-view`, `#session-grid`, `#session-inspector`).

- [ ] **Step 1: Write the chapter** — the grid layout (rows = lanes, columns = scenes/clip slots). Launching: click a cell body opens the **inspector** without playing; click the **▶** icon (`.session-cell-play`) launches the clip; **⏸** stops the lane. The session toolbar: launch a scene, **⏹ All** (`#session-stop-all`). Per-clip **Quantize** (`#insp-quantize`: immediate / 1/4 … 4 bars) vs global quantize. The inspector controls: **Name** (`#insp-name`), **Length (bars)** (`#insp-length`), **Copy/Paste (Replace/Layer)** (`#insp-copy` / `#insp-paste-replace` / `#insp-paste-layer`), **Duplicate** (`#insp-duplicate`), **↔ Editor** (`#insp-toggle-editor`), **🎲 Notes** (`#insp-random-notes`), **Delete** (`#insp-delete`). Moving/copying/colouring clips. Embed `images/session-view.png` and `images/inspector.png`.

- [ ] **Step 2: Commit** — `git commit -m "docs(manual): write sessions/lanes/clips/scenes chapter"`

---

## Task 9: Chapter 04 Engines (+ per-engine screenshots)

**Files:**
- Modify: `docs/manual/04-engines.md`
- Modify: `tools/manual/shot-list.mjs` (append engine shots once selectors are confirmed live)

**Sources:** `src/engines/registry.ts`, `engine-types.ts`, `engine-params.ts`, each of `tb303.ts`, `subtractive.ts`, `fm.ts`, `wavetable.ts`, `karplus.ts`, `sampler.ts`, `drums-engine.ts`; `src/engines/engine-selector-ui.ts`; `public/presets/*.json`; `index.html` engine pages (`.page[data-page="303"|"poly"|"drums"]`, `#engine-select`, `#engine-select-303`).

- [ ] **Step 1: Confirm engine-navigation selectors against the live app**

Run `npm run dev` (`http://localhost:5173`). Using the browser (or `npx playwright codegen http://localhost:4173` after a build), determine: how a lane's engine editor page is shown (which `#synth-tabs .tab` to click), and how `#engine-select` swaps the MAIN lane's engine. Note the exact selectors.

- [ ] **Step 2: Append engine shots to `tools/manual/shot-list.mjs`**

Using the confirmed selectors, add shots. Example shape (adjust selector/value names to what Step 1 found — `ENGINE_IDS` are the registry ids: `subtractive`, `fm`, `wavetable`, `karplus`, `sampler`; `tb303` and `drums-machine` have dedicated pages):

```js
// appended to SHOTS in shot-list.mjs
const showMainLane = async (page) => {
  // click the MAIN (poly) lane's tab so .page[data-page="poly"] is visible
  await page.locator('#synth-tabs .tab', { hasText: 'MAIN' }).first().click();
  await page.locator('.page[data-page="poly"]').waitFor({ state: 'visible' });
};
const engineShot = (id) => ({
  name: `engine-${id}`,
  selector: '.page[data-page="poly"]',
  setup: async (page) => {
    await showMainLane(page);
    await page.selectOption('#engine-select', id);
    await page.waitForTimeout(200); // let the engine page re-render
  },
});
SHOTS.push(
  engineShot('subtractive'), engineShot('fm'),
  engineShot('wavetable'), engineShot('karplus'), engineShot('sampler'),
);
```

Run: `npm run build && npm run manual:shots`
Expected: the new `engine-*.png` files appear; fix selectors and re-run until all pass.

- [ ] **Step 3: Write the chapter** — intro: every lane runs one engine; switch via the **ENGINE** selector; **PRESET** load/save/delete; **🎲 Sound** randomize. One short section per engine describing its character + key params (read each engine file + its preset JSON): **TB-303** (Wave/Cutoff/Resonance/Env/Decay/Accent + slide/accent behaviour), **Subtractive** (OSC1/OSC2/SUB/NOISE/FILTER/AMP), **FM**, **Wavetable** (morph), **Karplus** (string), **Sampler** (load sample, base note), **Drums** (per-voice rack, kits). A summary table (engine → best for → standout params). Embed the `engine-*.png` screenshots captured in Step 2.

- [ ] **Step 4: Commit** — `git add docs/manual/04-engines.md tools/manual/shot-list.mjs && git commit -m "docs(manual): write engines chapter + per-engine screenshots"`

---

## Task 10: Chapter 05 Editing Clips

**Files:** Modify `docs/manual/05-editing-clips.md`

**Sources:** `src/core/piano-roll-editing.ts`, `src/core/drum-grid-editing.ts`, `src/session/clip-editors/` (router → piano-roll / drum-grid), `src/core/pianoroll.ts`.

- [ ] **Step 1: Capture the two editor screenshots** — add two shots to `shot-list.mjs` (or capture ad hoc): `inspector-piano-roll` (open a melodic-lane clip) and `inspector-drum-grid` (open a drum-lane clip, or use `#insp-toggle-editor`), selector `#insp-roll-host`. Run `npm run build && npm run manual:shots` and confirm both PNGs.

- [ ] **Step 2: Write the chapter** — **Piano-roll**: Pencil/Select toggle, draw a note, drag to move, resize for duration, marquee selection, clipboard (cut/copy/paste at mouse), group move/delete/nudge, computer-keyboard note input (asdf/qwer rows + z/x octave; audition + step + record). **Drum-grid**: variable resolution (1/4 … 1/32 + triplets + free), free off-grid placement, row-based selection/clipboard/group-move, the canvas playhead. The **↔ Editor** toggle switches editor type. Embed `images/inspector-piano-roll.png` and `images/inspector-drum-grid.png`.

- [ ] **Step 3: Commit** — `git add docs/manual/05-editing-clips.md tools/manual/shot-list.mjs && git commit -m "docs(manual): write clip-editing chapter"`

---

## Task 11: Chapter 06 Modulation & Note-FX

**Files:** Modify `docs/manual/06-modulation-and-note-fx.md`

**Sources:** `src/modulation/` (LFO/ADSR modulators, `ModulationHost`, `ModulatorScope`, connection binder), `src/plugins/modulators/` (`lfo`, `adsr`), the note-FX plugin category + `src/arp/`.

- [ ] **Step 1: Write the chapter** — **Modulators** are per-lane: add an LFO or ADSR, choose its **scope** (shared vs per-voice), set rate/depth, and route it to a target param (e.g. filter cutoff). Explain the depth bridge / target-by-id routing at a user level. **Note-FX** are per-lane note processors (arp / chord) that sit before the engine; they live in `lane.engineState` and reset per demo. Document the arp and chord controls. Embed a relevant screenshot if one is captured (otherwise describe; optional shot `modulation` of the per-lane mod host `.engine-mod-host`).

- [ ] **Step 2: Commit** — `git commit -m "docs(manual): write modulation and note-fx chapter"`

---

## Task 12: Chapter 07 Mixing & FX

**Files:** Modify `docs/manual/07-mixing-and-fx.md`

**Sources:** `src/core/fx.ts` (`ChannelStrip`, `CompBlock`, `MasterCompressor`, EQ), `src/core/lane-resources.ts`, `src/core/sidechain-bus.ts`, `src/plugins/fx/*` (`multifilter`, `distortion`, `reverb`, `delay`, `InsertChain`), `src/app/audio-graph`; `index.html` Master FX page.

- [ ] **Step 1: Write the chapter** — per-lane **channel strip**: gain, pan, mute/solo, EQ, reverb/delay **sends** (`bus.reverbSend` / `bus.delaySend`). Per-lane **inserts** (the lane FX knob row). **Master FX** page: **SENDS** (REVERB `#fx-reverb-knobs`, DELAY `#fx-delay-knobs`), **MASTER COMP** (`#fx-master-comp-knobs`), **INSERTS → MASTER FILTERS** (add via `#fx-add-filter`, the `#fx-filters` chain). **Sidechain** compression bus. Embed `images/master-fx.png`.

- [ ] **Step 2: Commit** — `git commit -m "docs(manual): write mixing and fx chapter"`

---

## Task 13: Chapter 08 MIDI & Samples

**Files:** Modify `docs/manual/08-midi-and-samples.md`

**Sources:** `src/midi/` (`midi-parse.ts`, `midi-to-session.ts`, `gm-lookup.ts`, import UI), `src/samples/` (sample store, IndexedDB, keymap/repitch), `src/engines/sampler.ts`; `index.html` `.midi-panel`.

- [ ] **Step 1: Write the chapter** — **MIDI Import**: open the panel (`.midi-panel`), choose a `.mid` (`#poly-midi-file`), pick tracks from the track list, GM program matching maps tracks to engines/presets. **Sampler**: load an audio file into a pad/zone, set base note + keymap, per-pad params (tune/cutoff/res/env/level/pan/sends, loop, retrig-mono). **Sample drumkits**: an 8-pad rack (single-note keymap at GM notes) reusing the drum-grid editor. Embed `images/midi-import.png`.

- [ ] **Step 2: Commit** — `git commit -m "docs(manual): write midi and samples chapter"`

---

## Task 14: Chapter 09 Saving & Export

**Files:** Modify `docs/manual/09-saving-and-export.md`

**Sources:** `src/save/` (`SaveManager`, `saved-state-v3.ts`, `history-wiring.ts`), `src/export/` (scene export, real-time + offline), `index.html` save-manager modal + export menu; `build:pages` script + GitHub Pages note.

- [ ] **Step 1: Write the chapter** — **New** (`#new-session`), **Save**/**Load** open the **Save Manager** (`#save-manager-modal`): named saves, save current, load, import/export `.json`, clear all. Undo/redo is global. **WAV export**: the **⤓ WAV ▾** menu (`#export-scene`) — **Real-time** (`#export-rt`, ground truth) vs **Offline (fast)** (`#export-offline`); export renders the current scene once (no loop). **Live build**: pushing to `main` auto-deploys to GitHub Pages (`https://ijol.github.io/Loom/`). Embed `images/save-manager.png` and `images/export-menu.png`.

- [ ] **Step 2: Commit** — `git commit -m "docs(manual): write saving and export chapter"`

---

## Task 15: Chapter 10 Developer Guide

**Files:** Modify `docs/manual/10-developer-guide.md`

**Sources:** `CLAUDE.md` (architecture section), `src/engines/registry.ts`, `src/plugins/` (SPI + registry, `plugin-bootstrap`), `src/session/session.ts`, `src/core/lane-resources.ts`, `src/core/lane-scheduler.ts`, `src/core/sequencer.ts`, the testing layout in `CLAUDE.md`.

- [ ] **Step 1: Write the chapter** — for contributors. The **plugin registry** model (engines/FX/modulators discovered by a build-time `import.meta.glob` scan). The **SessionState** data model (lanes → clips → scenes; clips hold `notes: NoteEvent[]`). **LaneResourceMap** (per-lane strip + engine + insert chain; the lane allocator is the sole allocation path). The look-ahead **scheduler** (`sessionTick` / `tickLane`; step duration `60/bpm/4`). How-to recipes: **add an engine** / **add an FX or modulator** / **add a preset** / **add a drum kit** (mirror the "When adding/changing things" recipes in `CLAUDE.md`). The **four testing layers** (pure / scheduling-mocks / DSP-real / modulation-wiring) and the relative-assertion rule. Commands (`npm run dev`, `build`, `test`, `test:unit`, `test:e2e`). Use text/ASCII for any diagram (no extra image needed). Link back to `CLAUDE.md` as the canonical source.

- [ ] **Step 2: Commit** — `git commit -m "docs(manual): write developer guide chapter"`

---

## Task 16: Final regeneration, commit generated assets, verify, finish

**Files:** `docs/manual/images/*.png`, `docs/manual/Loom-Manual.pdf` (generated); remove `docs/manual/images/.gitkeep` if real images exist.

- [ ] **Step 1: Regenerate everything from clean**

Run: `npm run build:manual`
Expected: build → all screenshots (core + engine + editor shots) → `wrote …/Loom-Manual.pdf` → `manual: done.`

- [ ] **Step 2: Visual verification (eyes on output)**

Open `docs/manual/Loom-Manual.pdf`: confirm a clean cover/first page, every chapter present, headings styled, **every figure renders** (no broken image boxes) and figures are not split across page breaks. Spot-check 2–3 chapter `.md` files render on GitHub by confirming each referenced `images/*.png` exists.

- [ ] **Step 3: Sanity-check the suite still passes**

Run: `cross-env NO_COLOR=1 npx vitest run tools/manual/assemble.test.mjs`
Expected: PASS. (Optionally `npm run test:fast` to confirm nothing else regressed; the manual build is not part of `npm test`.)

- [ ] **Step 4: Commit generated assets**

```bash
git rm --cached docs/manual/images/.gitkeep 2>/dev/null; true
git add docs/manual/images docs/manual/Loom-Manual.pdf
git commit -m "docs(manual): generate screenshots and PDF"
```

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch — rebase onto `main`, `merge --ff-only`, then `ExitWorktree`. (Per project convention: no merge commit.)

---

## Self-Review notes

- **Spec coverage:** chapters 01–10 map 1:1 to the spec's chapter table; pipeline (Tasks 1–5) matches the spec's `tools/` layout (assemble/shots/pdf/css/orchestrator); `marked`-only dependency, Playwright for shots + PDF, relative image links rewritten to `file://` for the PDF, generated assets committed, build not in CI — all per spec. Performance mode flagged WIP (Task 7). Screenshots taken with a demo loaded (the app boots with one — Task 4).
- **Determinism caveat (spec):** engine-navigation selectors can't be verified without the live app, so Task 9 confirms them live before appending engine shots — this is verification, not a placeholder; the shot code is given.
- **Type/name consistency:** `CHAPTERS` order (assemble.mjs) == file names created in Task 3 == chapters written in Tasks 6–15. `buildShots`/`buildPdf`/`assembleHtml`/`resolveImageSrc`/`rewriteHtmlImageSrcs` names are consistent across tasks. Output paths (`docs/manual/images`, `docs/manual/Loom-Manual.pdf`) consistent across shots.mjs/pdf.mjs.
```
