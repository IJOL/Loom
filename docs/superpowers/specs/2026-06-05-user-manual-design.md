# User Manual (with images + generated PDF) — Design

**Date:** 2026-06-05
**Status:** Approved design, pending implementation plan
**Branch:** `worktree-user-manual`

## Goal

Ship a complete **manual** for Loom that serves two audiences in one body of work:
a **user guide** (how to make music with the app) and a **developer guide** (how the
app is built / how to extend it). The manual is authored in **English** as a set of
Markdown chapters with **embedded screenshots** (relative paths, so they render on
GitHub *and* in the PDF), plus a **generated PDF** built from those same Markdown
files.

User's phrasing: *"necesitamos un manual, que explique el funcionamiento"* →
*"ambos"* (user + developer), *"inglés"*, *"si podemos usar alguna herramienta y
generar pdf con imágenes y todo eso, mejor, las imágenes en el manual normal no solo
en pdf."*

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Audience | **Both** — one manual with a user-guide part (chapters 01–09) and a developer-guide part (chapter 10). |
| Language | **English** (matches the UI labels, the code, and the public GitHub Pages deploy). |
| Format / location | A folder **`docs/manual/`** with one Markdown file per chapter + a `README.md` index. Not a single giant file. |
| Images | Real screenshots of the running app, stored in `docs/manual/images/`, referenced from Markdown with **relative paths** so they show in both GitHub Markdown and the PDF. |
| PDF | Generated from the same Markdown into `docs/manual/Loom-Manual.pdf`. |
| Toolchain | **Playwright** (already a dev dependency) drives screenshots *and* renders the PDF (`page.pdf()`). The only new dependency is **`marked`** (Markdown→HTML). No Puppeteer, no Pandoc/LaTeX. |
| Generator | A single Node ESM script **`tools/build-manual.mjs`**, following the existing `tools/build-demos.mjs` pattern. |
| Performance mode | Documented as **"work in progress"** (the record/playback path is wired but the UI never surfaces a take — see `docs/superpowers/REMAINING-WORK.md`). We do not invent functionality. |
| Screenshot source state | The script loads a built-in demo (e.g. Acid Rain / Minimal Techno) so the session grid, clips and editors show **real content**, not an empty app. |

## Why these tradeoffs

- **Playwright for everything.** It is already installed and used by the e2e suite,
  it can both capture element-level screenshots of a live page *and* print HTML to
  PDF via `page.pdf({ printBackground: true })`. Reusing it means **zero heavy new
  dependencies** and a fully reproducible `npm run build:manual`.
- **`marked` only.** A tiny, well-known Markdown→HTML converter. We feed its HTML
  into a Playwright page with a print stylesheet, then `page.pdf()`. Nothing else is
  needed for a clean, image-rich PDF.
- **Folder of chapters, not one file.** Easier to navigate on GitHub, smaller diffs,
  and each chapter file stays small enough to edit and review independently. A
  `README.md` index ties them together and links the PDF + the live demo.
- **Real screenshots from a demo.** An empty Loom is a poor teaching aid; loading a
  demo gives every screenshot real lanes, clips and waveforms, matching what the
  prose describes.

## Architecture

Two independent units with a clean seam between them: the **content** (Markdown +
images) and the **generator** (the script that produces images and the PDF). The
content is human-authored and readable on its own; the generator is reproducible and
never edits prose.

```
docs/manual/
  README.md                         # index / table of contents + links (PDF, live demo)
  01-getting-started.md
  02-transport.md
  03-sessions-lanes-clips-scenes.md
  04-engines.md
  05-editing-clips.md
  06-modulation-and-note-fx.md
  07-mixing-and-fx.md
  08-midi-and-samples.md
  09-saving-and-export.md
  10-developer-guide.md
  images/                           # *.png screenshots, referenced by relative path
  Loom-Manual.pdf                   # generated output (committed)

tools/
  build-manual.mjs                  # Node ESM generator (two phases)
  manual/
    shots.mjs                       # phase 1: capture screenshots with Playwright
    pdf.mjs                         # phase 2: Markdown -> HTML -> PDF with Playwright
    manual.css                      # print/screen stylesheet for the PDF
```

> The `tools/manual/` split (shots vs pdf vs css) keeps each concern in a focused
> file; `build-manual.mjs` is the thin orchestrator that runs both phases. (The
> implementation plan may keep it as one file if that reads cleaner — the seam that
> matters is screenshots-vs-pdf, not the file count.)

### Content unit — chapters

Each chapter is a standalone Markdown file. What it does: teach one area of Loom.
How you use it: read it on GitHub or as a PDF page range. What it depends on: only
the screenshots in `images/` (relative links) — no build step required to *read* it.

| File | Chapter | Covers (mapped to real UI in `index.html`) |
|------|---------|--------------------------------------------|
| `README.md` | Index | What Loom is, TOC with links, link to `Loom-Manual.pdf` and the live demo (ijol.github.io/Loom). |
| `01-getting-started.md` | Getting Started | Open the app, pick a demo from the demo picker, press ▶ Play, hear sound; the big-picture mental model (lanes → clips → scenes). |
| `02-transport.md` | Transport | The transport row: Play, BPM, Meter, Swing, Volume, Bars, the `bar.beat.step` + elapsed readout, Session ⇄ Performance toggle, REC. |
| `03-sessions-lanes-clips-scenes.md` | Sessions, Lanes, Clips, Scenes | The session grid; what a lane/clip/scene is; launching a clip and a whole scene; Stop All; per-clip quantize; moving/copying/colouring clips; the inspector (name, length, quantize, copy/paste/duplicate/delete, 🎲 Notes). |
| `04-engines.md` | Engines | The 7 engines (TB-303, Subtractive, FM, Wavetable, Karplus, Sampler, Drums): the ENGINE selector, PRESET load/save/delete, 🎲 Sound randomize, and the per-engine knob panels. TB-303 slide/accent behaviour. |
| `05-editing-clips.md` | Editing Clips | Piano-roll: pencil/select toggle, marquee selection, clipboard (cut/copy/paste at mouse), group move/delete/nudge, computer-keyboard note input. Drum-grid: variable resolution, off-grid placement, row selection/clipboard. The ↔ Editor toggle. |
| `06-modulation-and-note-fx.md` | Modulation & Note-FX | Per-lane LFO/ADSR modulators (scope, rate, depth, routing to a target param). Per-lane note-FX (arp / chord) replacing the old global arp. |
| `07-mixing-and-fx.md` | Mixing & FX | Per-lane channel strip (gain/pan/mute/solo, EQ, sends). Master FX page: REVERB + DELAY sends, MASTER COMP, master INSERTS (add/remove filters). Sidechain. |
| `08-midi-and-samples.md` | MIDI & Samples | MIDI Import (drop a `.mid`, pick tracks, GM matching). Sampler: load a sample, base note / keymap, per-pad control. Sample drumkits (8-pad). |
| `09-saving-and-export.md` | Saving & Export | New / Save / Load, the Save Manager modal (named saves, import/export JSON, clear). WAV export: the ⤓ WAV menu — Real-time vs Offline. The GitHub Pages live build. |
| `10-developer-guide.md` | Developer Guide | Architecture: the plugin **registry** (engines/FX/modulators discovered at build time), the **SessionState** model (lanes → clips → scenes), **LaneResourceMap**, the look-ahead **scheduler**, how to add an engine / FX / preset / drum kit, and the four testing layers. Expands on `CLAUDE.md` with prose and diagrams-as-text. |

Chapters are scaled to their area: a short page for Transport, longer for Engines and
Editing. Each user-guide chapter follows the same shape — a one-line "what this is",
a labelled screenshot, then a walkthrough of each control.

### Generator unit — `tools/build-manual.mjs`

A reproducible CLI with two phases. What it does: produce `images/*.png` and
`Loom-Manual.pdf` from the running app + the Markdown. How you use it:
`npm run build:manual` (or the two sub-scripts). What it depends on: a production
build served by `vite preview`, Playwright, and `marked`.

**Phase 1 — screenshots (`tools/manual/shots.mjs`).**

1. Start the app the same way the e2e suite does: `vite preview` on its port (4173),
   after a `npm run build`. (The script assumes a fresh build; `build:manual` runs
   `build` first — see Gotchas.)
2. Launch Playwright (chromium), set a fixed viewport (e.g. 1440×900) and
   `deviceScaleFactor: 2` for crisp images.
3. Drive the app into known states and capture **element-level** screenshots by CSS
   selector (`locator.screenshot()`), not just full-page, so each figure frames the
   panel the prose is about. A declarative **shot list** maps
   `{ name, setup, selector }` → `images/<name>.png`. Examples:
   - `transport.png` → `.row.transport`
   - `session-grid.png` → load a demo, `#session-grid`
   - `inspector-piano-roll.png` → open a melodic clip, `#session-inspector`
   - `inspector-drum-grid.png` → open a drum clip
   - `engine-tb303.png`, `engine-subtractive.png`, … → switch lane/engine, the engine page
   - `master-fx.png` → Master FX tab, `.page[data-page="fx"]`
   - `save-manager.png` → open the Save Manager modal
   - `midi-import.png` → open the MIDI Import `<details>`
4. Each `setup` is a small async function that clicks/loads to reach the state. The
   demo is loaded once and reused across shots where possible.

**Phase 2 — PDF (`tools/manual/pdf.mjs`).**

1. Read the chapter files **in fixed order** (the order above), concatenate them.
2. Convert to HTML with `marked`. Rewrite relative `images/...` links to absolute
   `file://` URLs so Playwright can load them.
3. Wrap the HTML in a template that links `tools/manual/manual.css` (print + screen
   styling: page size A4, margins, heading styles, image max-width, code blocks,
   page-break rules so figures don't split, a cover page + auto table of contents).
4. Load the HTML into a Playwright page and `page.pdf({ path: 'docs/manual/Loom-Manual.pdf', format: 'A4', printBackground: true })`.

**Orchestrator (`build-manual.mjs`).** Parses an optional flag (`--shots-only` /
`--pdf-only`), starts/stops `vite preview` for phase 1, runs the phases, logs what it
wrote (count of images, PDF size) like `build-demos.mjs` does.

**`package.json` scripts:**

- `build:manual` → `npm run build && node tools/build-manual.mjs`
- `manual:shots` → `node tools/build-manual.mjs --shots-only`
- `manual:pdf` → `node tools/build-manual.mjs --pdf-only`

## Data flow

```
npm run build:manual
  └─ npm run build                      (fresh dist/ for vite preview)
  └─ node tools/build-manual.mjs
       ├─ phase 1 (shots.mjs)
       │    vite preview ──> Playwright ──> drive app ──> docs/manual/images/*.png
       └─ phase 2 (pdf.mjs)
            docs/manual/*.md ──marked──> HTML (+manual.css, file:// images)
                                  └─ Playwright page.pdf ──> docs/manual/Loom-Manual.pdf
```

The Markdown chapters are the single source of truth: they are independently readable
*and* the PDF input. Screenshots are regenerable whenever the UI changes.

## Gotchas the implementation must respect

- **`vite preview` serves `dist/` with no build step** (per `CLAUDE.md`). The
  screenshot phase therefore requires a fresh `npm run build` first; `build:manual`
  does this. `manual:shots` run alone assumes the caller built recently.
- **Image paths must work in both contexts.** In Markdown/GitHub the links are
  relative (`images/foo.png`); for the PDF the converter rewrites them to `file://`
  absolute paths. Authors always write relative links.
- **Determinism.** Engines with randomness (Karplus/noise) make pixel-exact
  screenshots impossible; that is fine — screenshots are illustrative, never asserted
  against a golden. The manual build is **not** part of `npm test` and never gates CI.
- **Generated artifacts are committed.** `images/*.png` and `Loom-Manual.pdf` are
  committed so the manual renders on GitHub without a build. (They are regenerated by
  the script, not hand-edited.)

## Testing / verification

This is documentation + a build script, not runtime code, so the bar is "it builds and
the output is correct", verified by eye:

- `npm run build:manual` completes and writes every image in the shot list + the PDF.
- The PDF opens, has a cover + TOC, and every chapter's figures are present and not
  split across page breaks.
- Each Markdown chapter renders on GitHub with its images visible (relative links).
- A light sanity check in the script: fail loudly if a shot-list selector matched no
  element (so a UI rename that breaks a screenshot is caught, not silently skipped).

No Vitest/Playwright **test** files are added; the generator itself is the check. (If a
tiny pure helper emerges — e.g. the image-path rewriter — it gets a unit test.)

## Out of scope (v1)

- Spanish (or any second-language) edition — English only.
- In-app help / embedding the manual inside the Loom UI.
- Hosting the manual on a docs site (VitePress/Docusaurus) — plain Markdown + PDF.
- Auto-publishing the PDF via CI on every push — it is built on demand and committed.
- Video / animated GIF captures — static screenshots only.
- Documenting Performance-mode take recording as a finished feature (it is WIP).
```
