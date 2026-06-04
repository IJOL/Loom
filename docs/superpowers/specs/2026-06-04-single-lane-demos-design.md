# Single-lane demos — design

**Date:** 2026-06-04
**Status:** approved (verbal)

## Goal

Four new showcase demos, each a **single lane** (one engine, no drums, no second
lane) carrying a *complete* musical piece — melody, harmony, bass and groove all
implied by that one instrument. The point is to show how much music fits in one
expressive lane. Author's choice of style.

## Constraint that shaped everything

A demo `SessionState` (the `public/demos/*.json` files) has **no tempo field** —
only the save-file path (`saved-state-v3.ts`) ever sets `seq.bpm`. So today every
demo inherits whatever the transport BPM happens to be (120 at boot). For four
pieces in four genres, tempo *is* part of the interpretation.

## Decision: per-demo tempo (approach A)

Teach the demo loader to honor an **optional `bpm`** on the demo JSON. On load,
clamp it (40–240) and push it through the existing transport path
(`bpmBroadcast.broadcast` + update the visible BPM input) — exactly what MIDI
import already does via its `setBpm` closure. Nothing hidden; the BPM input
reflects it. `meter` stays out of scope (all five demos are 4/4; compound feels
are written with triplet/dotted rhythms inside 4/4 bars). Minimal Techno also
gains `bpm: 130` (its intended tempo).

Tick grid (fixed): `TICKS_PER_QUARTER = 96`, 24/16th, 384 ticks/bar (4/4). Notes
are absolute-tick, so slides, swing and triplets are all expressible.

## The lineup

| Title | Engine | Style / tempo | One-lane technique |
|-------|--------|---------------|--------------------|
| **Acid Rain** | `tb303` | Acid techno, 132 | 16th line, heavy slides + accents, per-clip filter-cutoff envelopes sweeping each section. 4 scenes: intro → main riff → resonance climb → breakdown. A-minor. |
| **Blue Hour** | `fm` | Lo-fi jazz Rhodes, 84 | Polyphonic FM e-piano: voiced ii–V–I chords + interleaved walking bass + sparse melody; soft velocity dynamics; subtle tremolo LFO. Fm/F. |
| **Cordillera** | `karplus` | Plucked folk/world, 100 (6/8 feel) | Travis-picked nylon/koto — bass thumb + melody fingers interleaved so one plucked lane reads as a full solo. Dynamic velocities. E-minor. |
| **Neon Drive** | `wavetable` | Synthwave arp lead, 115 | Driving 16th arpeggio implying the groove, wavetable-position automation + LFO + filter envelope evolving across 4 scenes over i–VI–III–VII. A-minor. |

## Build

- **Generator script** under `tools/` (TypeScript, run via `tsx`/`node`) computes
  each piece's notes, velocities, slide/accent flags and automation arrays and
  writes `public/demos/*.json`. Keeps thousands of tick values reproducible
  rather than hand-typed. Committed alongside its output.
- **Loader change** (TDD): optional `bpm` on the demo type; `wireDemoPicker` gains
  an `applyBpm?` dep; boot + picker call it after `applyLoadedSessionState`. Reuse
  a single `setTransportBpm` helper shared with MIDI import.
- **Register** all four in the demo picker in `main.ts` (Minimal Techno stays the
  boot default).

## Components & boundaries

- `src/demo/demo-loader.ts` — `DemoSession = SessionState & { bpm?: number }`;
  `fetchDemoSession` returns it (parse only, no side effects).
- `src/demo/demo-picker.ts` — `wireDemoPicker` calls `applyBpm?.(state.bpm)` after
  apply. Pure wiring; testable with a mocked fetch + spy (mirrors existing test).
- `src/main.ts` — owns `setTransportBpm(bpm)` (clamp + broadcast + input), passes
  it to the picker and to MIDI import, and calls it at boot after the demo apply.
- `tools/build-demos.ts` — pure data authoring; emits JSON. No app imports beyond
  shared types/constants if convenient.

## Verification

- `npm run build` (tsc) green; new unit test for the picker's `applyBpm` call.
- Browser smoke: load each of the four from the picker; confirm each plays at its
  stated tempo and sounds like a complete piece on one lane; launch each scene.
- Finish in the worktree: `npm run build` + `npm test`, then rebase onto main and
  `merge --ff-only` (no merge commit).
