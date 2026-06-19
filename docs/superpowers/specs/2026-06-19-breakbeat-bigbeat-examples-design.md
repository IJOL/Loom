# Breakbeat / Big Beat — new genre + curated examples

**Date:** 2026-06-19
**Status:** Design — awaiting user review
**Topic:** Add a combined "Breakbeat / Big Beat" genre to the musicality system: style picker, genre generators, and a full curated example gallery (bass + melody + beat).

## Problem

The drum example gallery (and the genre generators) only cover four styles — `acid`, `house`, `synthwave`, `lofi` — all of which are essentially four-on-the-floor / lo-fi oriented. There are **no breakbeat or big beat drum patterns** anywhere: no syncopated funk breaks (Amen-style), no ghost snares, no half-time big-beat stomps. The user wants this material available as curated examples.

## Goal

Add one new **combined** style, `breakbeat`, labelled **"Breakbeat / Big Beat"**, that behaves exactly like the existing four styles:

- Appears in the style selector (top-bar musicality popover).
- Has a full curated example gallery (bass + melody + beat) under its own `<optgroup>` in the inspector's example picker.
- Has working genre generators for all three kinds (Generate bass / melody / beat).

Both flavours (lighter syncopated *breakbeat* and heavier half-time *big beat*) live inside this single style; the distinction is carried by the individual patterns, not by separate selector entries.

## Decisions (from brainstorming)

1. **One combined genre**, not two separate ones — user choice.
2. **Full coverage** curated gallery (bass + melody + beat), so the genre sits at the same level as the others — user choice.
3. **Generator gets a real breakbeat behaviour (Option A)** — a minimal, isolated extension to the pure `genBeat` so that "Generate beat" for this genre produces a recognizably *broken* beat, not a generic backbeat — user choice.

## Why this wires up almost for free

The system is keyed on `StyleId` + `STYLE_CATALOG`, so adding a style cascades automatically:

- The style `<select>` is built from `STYLE_CATALOG` ([musicality-bar.ts:42](../../../src/session/musicality-bar.ts)).
- The inspector example picker iterates `STYLE_CATALOG`, loads each style's examples, groups them with an `<optgroup>` labelled by `StyleEntry.label`, and filters by editor category (drum lane → `beat`; piano-roll → `bass`+`melody`) ([session-inspector.ts:356-372](../../../src/session/session-inspector.ts)). A missing JSON degrades gracefully (`.catch(() => [])`), but we ship the file.
- The `BASS` / `MEL` / `BEAT` config maps in `generators.ts` are `Record<StyleId, …>`, so TypeScript **forces** us to add a config for the new style to all three — no style can be half-wired.

## Design

### 1. `src/core/musicality.ts`

- Extend the type: `export type StyleId = 'acid' | 'house' | 'synthwave' | 'lofi' | 'breakbeat';`
- Append to `STYLE_CATALOG`: `{ id: 'breakbeat', label: 'Breakbeat / Big Beat' }`.

### 2. `src/core/generators.ts`

Add a `breakbeat` entry to each config map:

- **`BASS.breakbeat`** — funky, syncopated, octave jumps:
  `{ density: 0.5, octaves: [0, 1], slideChance: 0.15, accentChance: 0.3, degreePool: [0, 0, 4, 3, 6, 2] }`
  (degree indices into the active scale: root, root, 5th, 4th, ♭7, ♭3 → a bluesy/funky palette in minor.)
- **`MEL.breakbeat`** — stabby, short hooks:
  `{ density: 0.32, longChance: 0.15, spanDegrees: 7 }`
- **`BEAT.breakbeat`** — broken, busy hats, backbeat snare, with the new flag:
  `{ kickEveryBeat: false, snareBackbeat: true, hatChance: 0.85, hatStep: 1, openHatChance: 0.12, breakbeat: true }`

**`BeatCfg` extension (Option A).** Add one optional field:

```ts
interface BeatCfg { …; breakbeat?: boolean; }
```

In `genBeat`, after the existing main loop and the first-downbeat guarantee, when `cfg.breakbeat` is true, add broken-beat character (per bar, using `stepsPerBeat = stepsPerBar/4`):

- **Syncopated kicks:** add a kick at the "and of beat 2" (`barOffset + stepsPerBeat*2 - stepsPerBeat/2`, i.e. step 6 in a 16-step bar) and, with probability ~0.5 (`rng`), at the "and of beat 3" (step 10). These are the off-grid hits that make it a break rather than a backbeat.
- **Ghost snares:** on a few off-beat 16th positions (e.g. the "e"/"a" subdivisions), with probability ~0.35 (`rng`), add a low-velocity snare (vel ~45) — the quiet shuffle under the main backbeat.

The behaviour stays inside `genBeat`; no other style is affected (flag is `undefined` for them). It remains pure and deterministic for a fixed rng seed.

### 3. `public/examples/breakbeat.json` (new)

Format identical to the existing files: `{ "style": "breakbeat", "examples": [ … ] }`. All melodic examples use **scale degrees** (so they follow the project tonality); beats use raw GM notes (kick 36, snare 38, closed hat 42, open hat 46, clap 39). Tick grid: 1 bar = 384 ticks = 16 steps × 24 ticks.

**Beats (~6)** — IDs `breakbeat-beat-1…6`. Defining rhythmic features (exact velocities/ghost placement tuned by ear during implementation):

| # | Name | Bars | Flavour | Defining features |
|---|------|------|---------|-------------------|
| 1 | Classic Breakbeat | 1 | breakbeat | Kick on 1 + "and of 3"; snare on 2 & 4; ghost snares on off-16ths; busy closed hats (16ths), 1 open hat |
| 2 | Funky Break | 1 | breakbeat | Syncopated kick (1, "e of 2", "and of 3"); backbeat snare; off-beat open hats; a ghost kick |
| 3 | Amen 2-Bar | 2 | breakbeat | 2-bar amen-style variation: snare displacement + ghost-snare rolls in bar 2; kick syncopation |
| 4 | Big Beat Stomp | 1 | big beat | Heavy: kick on 1 & "and of 1"; fat snare on 2 & 4 (clap-doubled); sparse, hard; open hat accent |
| 5 | Prodigy Punch | 1 | big beat | Half-time feel: double-kick into a hard snare on 3; minimal hats; aggressive |
| 6 | Big Beat Roll | 2 | big beat | 2-bar heavy groove with a snare/tom roll fill at the end of bar 2 |

**Basses (~5)** — IDs `breakbeat-bass-1…5`: funky syncopated 16th riffs with octave jumps and accents (breakbeat), plus 1–2 with longer sustained rock-ish notes (big beat). 1-bar except one 2-bar.

**Melodies (~4-5)** — IDs `breakbeat-melody-1…5`: short stab/hook riffs in the active scale; at least one descending big-beat-style line; mostly 1-bar, one 2-bar.

### 4. Tests

- **`src/core/generators.test.ts`** — add:
  - `breakbeat` generates bass/melody notes in scale (same shape as the existing acid/synthwave assertions).
  - `breakbeat` beat is *broken*: at least one kick (`midi === 36`) starts at a tick that is **not** on a beat boundary (`start % (stepsPerBeat * TICKS_PER_STEP) !== 0`) — proving the syncopation extension fires. Relative/structural assertion, no absolute magnitudes.
  - The first-downbeat kick guarantee still holds for `breakbeat`.
- **`src/session/example-loader.test.ts`** — add a test that `validateExample` accepts a representative `breakbeat` beat and a `breakbeat` bass example with `style: 'breakbeat'`.
- The existing parametric generator/loader tests must keep passing unchanged.

## Testing & verification

- `npx tsc --noEmit` — the `Record<StyleId>` exhaustiveness check confirms all three generator configs are present.
- `npm run test:unit` — generators + example-loader green.
- `npm run build` then **live ear-check** (per project rule: UI/content features aren't "done" on green tests alone):
  - Open the app, set Style → "Breakbeat / Big Beat" in the musicality popover; confirm it appears.
  - In a **drum lane** clip editor, open the example picker, confirm a "Breakbeat / Big Beat" optgroup lists the 6 beats; load each and **listen** — confirm breakbeat ones are syncopated/ghosted and big-beat ones are heavy/half-time.
  - In a **piano-roll lane**, confirm the same optgroup lists the basses + melodies; load and listen.
  - Hit **Generate beat** on the breakbeat style and confirm the output is audibly broken (not a plain backbeat).
- One test per user path (no "(or …)"): beat-load, bass-load, melody-load, and generate-beat are each verified explicitly by ear.

## Out of scope (YAGNI)

- No new scales — breakbeat/big beat ride the existing tonality (typically minor/pentatonic, which already exist).
- No per-style default tonality wiring (examples are scale-relative; they adapt to whatever the project key/scale is).
- No new drum voices or kits — patterns use the existing GM voices.
- No two-genre split — single combined style by user decision.

## UI text language

All user-facing strings (the style label, example names) are in **English**, per project convention. The label is "Breakbeat / Big Beat".
