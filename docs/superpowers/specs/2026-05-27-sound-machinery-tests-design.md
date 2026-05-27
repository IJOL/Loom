# Sound Machinery Tests — Design

**Date:** 2026-05-27
**Status:** Draft

## Goal

Add a coherent, layered test suite that detects four classes of regressions the current tests do not catch:

1. An engine stops producing sound after a DSP refactor.
2. The sequencer fires triggers with the wrong timing or flags (slide, accent, gate).
3. The modulation host (LFO/ADSR) stops reaching the engine parameter destinations it should.
4. Session ↔ engine wiring breaks across migrations or saves.

The existing ~1000 lines of tests cover schemas, pure logic, and migrations. They do not exercise the real DSP path or the sequencer↔engine coupling. This spec closes that gap.

## Non-goals

- DOM / jsdom UI tests for knobs, panels, automation painter.
- E2E browser tests.
- Master FX tests (out of current scope).
- Save/load format coverage beyond what already exists.

If any of these become priorities, they get their own spec.

## Architecture: four layers

| Layer | Risk covered | Technique |
|---|---|---|
| 1. Pure | Schemas, scales, notes, migrations, pattern logic | Vitest, pure functions. **Already exists.** |
| 2. Scheduling | Sequencer ↔ engines: order, timing, slide N-1, accent, gate sliding, BPM/length live changes | Mocks + fake clock. **New.** |
| 3. DSP real | Each engine produces sound and responds to its primary knobs | `node-web-audio-api` + `OfflineAudioContext`. **New.** |
| 4. Modulation wiring | LFO/ADSR effectively reach the destination `setBaseValue` on the right engine at the right time | Real host + real binder + real engine, manual clock. **New.** |

**Guiding principle:** each risk is covered by the cheapest technique that still detects the bug. Do not render audio to verify the sequencer fired step 3. Do not mock the DSP to verify the filter opens with cutoff.

## New infrastructure

### Dependency

- `node-web-audio-api` (Ircam) — native WebAudio implementation for Node, supports Windows and `OfflineAudioContext`. Only new dep.

### Global setup

`test/setup.ts` (referenced from `vitest.config.ts` via `setupFiles`):

```ts
import { AudioContext, OfflineAudioContext, /* ... */ } from 'node-web-audio-api';
globalThis.OfflineAudioContext = OfflineAudioContext;
globalThis.AudioContext = AudioContext;
// expose any other constructors src/ instantiates by global name
```

Source code under `src/` stays untouched and keeps using `new OfflineAudioContext(...)` / `new AudioContext()` as if running in the browser.

### Helpers

**`test/render.ts`** (~50 lines) — `renderEngine(engineFactory, opts)`:

- `engineFactory(ctx)` returns `{ engine, output }` with the engine already constructed and `output` wired up to whatever the engine emits.
- Creates `OfflineAudioContext(1, sampleRate * duration, sampleRate)`, connects `output` to destination.
- Accepts an event list `{ time, type: 'trigger'|'noteOff', note?, velocity?, accent?, slide? }` translated into engine method calls.
- Calls `startRendering()` and returns the resulting `Float32Array`.

**`test/dsp-asserts.ts`** (~80 lines):

- `rms(buf)`, `peak(buf)`, `isSilent(buf, threshold = 1e-4)`
- `spectralCentroid(buf, sampleRate)` — radix-2 FFT over a hanning-windowed frame
- `freqContour(buf, sampleRate, hopMs)` — zero-crossing rate per window, returns array — used to detect slide
- `expectRising(values, tolerance)` / `expectFalling(values, tolerance)` — relaxed monotonicity

**`test/sequencer-harness.ts`** (~70 lines) — for layer 2:

- Real `Sequencer` + `FakeEngine` that records each `trigger(note, time, opts)` into a timestamped array.
- Fake clock via `vi.useFakeTimers()` plus a stub `AudioContext` with manually advanced `currentTime`.
- `advance(ms)` advances both clocks and yields the event log ready for assertion.

### Directory layout

```text
test/
  setup.ts
  render.ts
  dsp-asserts.ts
  sequencer-harness.ts
src/**/*.test.ts                 # layer 1 (existing) + layer 2 (new)
src/**/*.dsp.test.ts             # layer 3 — new
src/modulation/*.wiring.test.ts  # layer 4 — new
```

DSP tests live next to the engine they test, with the `.dsp.test.ts` suffix so they can be filtered in/out for fast iteration.

### Scripts

- `npm test` → all layers
- `npm run test:fast` → excludes `*.dsp.test.ts` (TDD inner loop)
- `npm run test:dsp` → only audio rendering tests

CI runs `npm test`. If the DSP suite ever exceeds 60 s, split it into its own job.

## Layer 2 — Scheduling (mocks)

Target: ~12 tests covering the sequencer and step scheduler without touching DSP.

### Sequencer tests

1. 16 steps at 120 BPM produces 16 triggers spaced `60/120/4 = 125 ms` apart.
2. Changing `bpm` mid-pattern affects the next step's delta only (does not reschedule already-queued steps).
3. `setLength(8)` truncates and the next cycle restarts at step 0 after 8 steps.
4. A step with `on=false` produces no trigger.

### Slide tests

1. Slide flag on step N → step N+1 trigger receives `slide: true` and the engine is NOT re-gated (no `noteOff` between).
2. Slide-out step has duration ≈ 1.5 × normal step (verified by the next `noteOff` time).
3. Chained slides (N and N+1 both slide) sustain the gate continuously.

### Accent tests

1. Step with `accent=true` propagates the flag to both engine and drum trigger calls.

### Drums multi-lane tests

1. Kick lane and hat lane on the same step produce two triggers at identical `time`.
2. Muting one lane does not affect the others.

### Modulation tick and lifecycle tests

1. When a step has automated params, the scheduler calls `setBaseValue` **before** `trigger`.
2. After `seq.stop()`, `advance(largeMs)` produces no further triggers.

Out of scope here: that the scheduled `time` is sample-accurate (that is WebAudio's contract, not the scheduler's), and audible behavior (that is layer 3).

## Layer 3 — DSP real (`node-web-audio-api`)

Target: ~25 tests across bass engines + ~30 tests across drum kits = ~55 tests, ~15–30 s total runtime.

### Standard battery per bass engine (TB303, Subtractive, FM, Wavetable, Karplus)

Each engine gets a `<engine>.dsp.test.ts` with five generic tests:

1. **Sounds** — `isSilent(buf) === false` and `peak(buf) > 0.01`.
2. **Doesn't clip** — `peak(buf) < 1.0` with all params at sensible maximums.
3. **Filter opens spectrum** (engines with a filter): render at `filter.cutoff = 0.1` vs `0.9`; `spectralCentroid` of the second is ≥ 2× the first. Karplus is exempt (no filter knob with the same role).
4. **Accent raises RMS** — same trigger with accent off vs on; RMS rises. Engines without a true accent path document the omission.
5. **Note-off cuts** — trigger, wait 100 ms, `noteOff`; RMS of the last 50 ms is < 10% of the first 100 ms.

### Engine-specific extras

- **TB303 slide** — two consecutive triggers, first with `slide: true`, different notes. `freqContour` shows a continuous transition (no discontinuity in zero-crossing rate at the boundary).
- **FM ratio** — changing `op2.ratio` moves the spectral centroid (verifies the modulator operator is wired, not dead).
- **Wavetable position** — sweeping `wave.position` from 0 → 1 moves the centroid.

### Drums (`src/core/drums.dsp.test.ts`)

For every `kit ∈ KITS` and every lane (`kick`, `snare`, `hat`, `clap`, `cowbell`):

- **Sounds and doesn't clip** (parameterized table).

Per lane (kit-independent):

- **Accent raises RMS.**
- **Character coherence** — kick: spectral centroid in the first 50 ms < 200 Hz. Hat: centroid > 2 kHz. Snare: intermediate centroid plus detectable noise component. This is what catches "someone broke the voice's character."

### Robustness rules

- All RMS / centroid assertions use **relative** factors (`2×`, `>`, `<`), never absolute thresholds.
- An absolute threshold in a DSP test is a brittleness smell and must carry a justifying comment.
- If `node-web-audio-api` does not implement a node a given engine needs (rare `AudioWorklet`, exotic `PeriodicWave`), that engine stays at layer 2 until a workaround is found. We discover this when writing the first test per engine.

## Layer 4 — Modulation wiring

Target: ~8 tests.

Setup: real `AudioContext` (not offline — we only need `currentTime` to advance), real `ModulationHost`, real binder, real engine via `registerInstance` with a fake DSP instance whose `params` record is observable.

1. LFO on `filter.cutoff` produces oscillation in `getBaseValue('filter.cutoff')` around the base value.
2. ADSR on `env.amount` follows A→D→S during gate, R after `noteOff`.
3. `amount=0` leaves the destination still.
4. Changing destination at runtime: old destination stops moving, new one starts.
5. Two LFOs on the same destination sum (do not overwrite).
6. Rate-sync to tempo: changing BPM changes LFO frequency when `sync=true`.
7. Disconnecting a voice restores the destination to its base value (no stuck modulation).
8. Voice pointing at a nonexistent engine does not throw (defensive).

The existing `modulation/` tests cover waveform / curve / rate-sync math. These cover the **end-to-end wiring**, which is the gap.

## WAV artifacts for human comparison

Every layer-3 (DSP) test writes the rendered buffer to a WAV file alongside running its assertions. This gives a tangible artifact a human can open in any DAW or audio editor, compare across runs, or commit as a reference.

### Layout

```
test/
  output/      # gitignored — every test run overwrites
  golden/      # committed — reference WAVs, updated deliberately
```

### Naming

`test/output/<engine-or-kit>__<test-name>.wav`, e.g.:

- `test/output/tb303__sounds.wav`
- `test/output/tb303__slide.wav`
- `test/output/drums-808__kick__sounds.wav`
- `test/output/fm__op2-ratio-sweep.wav`

The same name lives in `test/golden/` if a reference has been blessed.

### Mechanics

`renderEngine()` returns the buffer as before; a new helper `writeWav(buf, path, sampleRate)` (~30 lines, uses 16-bit PCM, standard RIFF header) gets called at the end of each DSP test:

```ts
const buf = render({ accent: false });
writeWav(buf, wavPath('tb303__sounds'), 44100);
expect(isSilent(buf)).toBe(false);
```

A tiny convention helper `wavPath(name)` resolves to `test/output/<name>.wav` and ensures the directory exists.

### Comparison workflow

- **Primary assertions stay relative** (RMS, centroid, peak ratios). The WAVs are *not* the regression detector — that role belongs to the relative-tolerance assertions, which survive innocuous DSP refactors.
- **`npm run test:wav-diff`** — separate script that walks `test/output/` and for each file with a matching `test/golden/` reports peak delta, RMS delta, and spectral L2 distance. It does not fail CI; it prints a table. This is the "what changed audibly?" tool when a test fails or a refactor is in flight.
- **`npm run test:wav-bless`** — copies `test/output/` over `test/golden/`. A deliberate action, never automatic.
- **First-run goldens** — after the suite is green, run `test:wav-bless` once and commit `test/golden/`.

### What this is NOT

- Not a golden-file regression test. Byte- or sample-exact comparison of WAVs across CI runs and platforms is brittle (different FFT/biquad denormal handling, slight numeric drift). We do not gate CI on WAV equality.
- Not a substitute for the relative assertions in [Layer 3 — DSP real](#layer-3--dsp-real-node-web-audio-api). Those are the regression net. WAVs are the human-readable signal.

### Phase fit

Add `writeWav` and the `test/output/` directory in phase 2 alongside the rest of the DSP helpers. The `wav-diff` / `wav-bless` scripts can land at the end of phase 4.

## Implementation parallelization

The layer 3 work (per-engine DSP test files) is embarrassingly parallel. Plan should dispatch one subagent per engine once `renderEngine` and `dsp-asserts` exist, each producing its own `.dsp.test.ts`. Zero shared state, no merge conflicts.

Layers 2 and 4 are smaller and best kept in a single pass each.

## Phasing

1. Add `node-web-audio-api` dep, write `test/setup.ts`, wire into `vitest.config.ts`. Verify a trivial `new OfflineAudioContext(...).startRendering()` works.
2. Build `test/render.ts` and `test/dsp-asserts.ts`. Smoke-test with one trigger on TB303 — buffer not silent.
3. Build `test/sequencer-harness.ts`, write the 12 layer-2 tests.
4. **Parallel:** dispatch 5 subagents, one per engine, to write the layer-3 test files. Then drums.
5. Write the 8 layer-4 wiring tests.
6. Add `test:fast` and `test:dsp` scripts.

## Risks

- **`node-web-audio-api` API gaps.** Mitigation: discovered at phase 2 smoke test; fall back to layer 2 for the affected engine and document.
- **DSP test flakiness from FFT noise on short buffers.** Mitigation: window sizes ≥ 4096 samples, hanning window, assertion ratios with tolerance.
- **Sequencer fake clock divergence from real WebAudio scheduling.** Mitigation: tests assert on the harness's recorded `time` values, which come from the same fake clock the scheduler reads from — internally consistent by construction.
