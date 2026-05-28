# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based **Roland TB-303 bass synth + drum machine** built with Web Audio + TypeScript + Vite. All sound is synthesized live in the browser — no samples, no DAW required.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start Vite dev server (hot reload) at <http://localhost:5173>
- `npm run build` — typecheck + bundle to `dist/`
- `npm run preview` — serve the production build locally
- `npx tsc --noEmit` — typecheck without bundling
- `npm test` — Vitest: 215 tests across four layers
- `npm run test:fast` — everything except DSP renders (inner-loop TDD)
- `npm run test:dsp` — only the real-DSP renders (slower, requires `node-web-audio-api`)
- `npm run test:wav-diff` — compares `test/output/*.wav` (last run) against `test/golden/*.wav` (committed reference) and prints peak/RMS/L2 deltas. Never fails CI — human inspection tool.
- `npm run test:wav-bless` — overwrites `test/golden/` with the current `test/output/`. Deliberate action; commit the result.

No linter is configured.

## Testing layout

Four layers, distinct technique per risk class:

1. **Pure** — schemas, scales, migrations, pattern logic. `src/**/*.test.ts` (not `.dsp` or `.wiring`).
2. **Scheduling (mocks)** — sequencer ↔ engines via a fake-clock harness. [src/core/sequencer.test.ts](src/core/sequencer.test.ts) driven by [test/sequencer-harness.ts](test/sequencer-harness.ts).
3. **DSP real** — every engine + every drum kit rendered through `OfflineAudioContext` (via [node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api), globalized in [test/setup.ts](test/setup.ts)). Files end in `.dsp.test.ts`. Use the shared battery in [test/dsp-battery.ts](test/dsp-battery.ts). Each render writes a WAV to `test/output/` (gitignored) for audible inspection; `test/golden/` is the committed reference.
4. **Modulation wiring** — LFO/ADSR voices connected through a depth bridge into a target `AudioParam`. Files end in `.wiring.test.ts`.

Assertion rule: **always relative**. Use ratios (`>`, `<`, `> * 2`), never absolute magnitudes. Absolute thresholds are a brittleness smell; if you write one, justify it in a comment.

## Architecture

Five files under `src/`, each with a single responsibility:

1. **[src/synth.ts](src/synth.ts) — `TB303` class.** Monophonic bass voice: one persistent `OscillatorNode` → `BiquadFilterNode` (LP) → `GainNode` → destination. `trigger(note, time)` schedules a fresh per-note envelope using AudioParam automation at sample-accurate times.

2. **[src/drums.ts](src/drums.ts) — `DrumMachine` class + kit definitions.** All voices (kick, snare, hats, clap, cowbell) are synthesized from oscillators/noise/filters; **kits are bags of parameters** (`KITS` array) that drive the same DSP primitives. Adding a new kit = adding an entry to that array — no new synthesis code.

3. **[src/sequencer.ts](src/sequencer.ts) — `Sequencer` class.** Multi-track look-ahead scheduler (Chris Wilson "A Tale of Two Clocks"): a `setTimeout` "tick" every 25 ms schedules any 16th-note steps in the next 120 ms onto `synth.trigger(..., time)` and `drumMachine.trigger(...)`. One `bass` track + one `drums[lane]` track per drum voice; all share the same length and clock.

4. **[src/random.ts](src/random.ts) — `randomize()` and `clearPattern()`.** Pure functions that mutate sequencer state. Randomization is fine-grained: `{ notes, accents, slides, drums, mod }` flags let the user randomize one dimension at a time. Bass note randomization is scale-aware (`SCALES` map). Drum randomization is biased toward musical placement (kicks on downbeats, snares on backbeats).

5. **[src/main.ts](src/main.ts) — DOM glue.** Builds the UI on boot, wires controls to model/state, calls `ctx.resume()` on first play.

## TB-303 behaviors that drive the design

- **Slide** bleeds across `synth.ts` and `sequencer.ts`. A step's `slide` flag means "slide INTO the next step." When [src/sequencer.ts](src/sequencer.ts) schedules step N it looks at step **N-1**'s slide flag — if set, it passes `slide: true` to `synth.trigger`, which tells the voice to ramp pitch and *skip the amp re-attack* so the previous gate keeps holding. Sliding-out steps also get an extended duration (1.5× step) so their gate overlaps with the next trigger.
- **Accent** is per-step on both bass and drums: brightens the filter envelope + bumps Q + raises gain on bass; raises velocity on drums.
- Synth params on `synth.params` are read at trigger time, so live tweaks during a held note do not change the currently sounding envelope — only the next trigger.

## When changing the sequencer

- `bpm` and `length` are mutable at runtime. The next scheduled step uses the new values; no restart needed for tempo. `setLength()` resizes all track arrays in place.
- Step duration is `60 / bpm / 4` (16th notes).
- The UI "current step" highlight is driven by a separate `setTimeout` matched to the scheduled audio time — visual sync may drift under heavy tab throttling but audio scheduling is unaffected.

## When changing the drum machine

- Add a kit: append an object to the `KITS` array in [src/drums.ts](src/drums.ts) with the same shape as existing kits (kick/snare/hat/clap/cowbell parameter blocks). It will appear in the kit dropdown automatically.
- Add a new drum voice: extend the `DrumVoice` union + `DRUM_LANES` array + every kit's parameter set + add a `play<Voice>()` method + add a case in `trigger()`. The UI builds rows from `DRUM_LANES`, so the new lane appears automatically; only style.css needs new color rules.

## When changing the UI

- The full track grid is rebuilt by `rebuildTracks()` whenever pattern length changes. Cell references are stored in `bassCells` and `drumCells` so randomize/clear can re-render visual state without rebuilding the DOM.
- Drum cells use a single button that cycles **off → on → on+accent** on click; bass cells have separate note/on/accent/slide controls.
- `--steps` CSS custom property on `.tracks` is set from `seq.length` so grid columns match the pattern length.
