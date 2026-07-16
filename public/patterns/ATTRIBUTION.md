# Pattern library — provenance

The four JSON files in this directory are **not** Loom's own work. They come from
**mpump**, a browser groovebox by gdamdam:

- Source: <https://github.com/gdamdam/mpump> (`mpump/server/public/data/`)
- Live: <https://mpump.live/>
- Copyright (C) 2024-2026 gdamdam
- Licence: **AGPL-3.0-or-later** — the same licence Loom is under, which is what
  makes including them here lawful. If you redistribute Loom, these files carry
  the same obligations as the rest of the source.

| File | Contents |
|---|---|
| `patterns-s1.json` | 410 synth patterns across 20 genres |
| `patterns-t8-drums.json` | 400 drum patterns |
| `patterns-t8-bass.json` | 400 bass patterns |
| `catalog.json` | the name and one-line description of every pattern |

**1210 curated patterns in total.** They are the hand-written work of mpump's
author (its `scripts/generate_new_patterns.py` dumps them to JSON once); the
craft is in the patterns, not in the generator.

## How they map onto Loom

The genre keys are used verbatim as Loom `StyleId`s, so a lookup is
`patterns[style]` with no translation table in between. Conversion to Loom's
`NoteEvent` lives in [`src/patterns/mpump-patterns.ts`](../../src/patterns/mpump-patterns.ts):

- step index → ticks (`start = step * TICKS_PER_STEP`)
- clap 50 → 39 and cowbell 47 → 56: mpump numbers those off the 808 layout,
  which are toms in GM. Every other note it uses is already GM.
- `slide: true` → a note 1.5x long, because in Loom the slide *is* the overlap.
