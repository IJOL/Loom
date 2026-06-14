# West Coast synthesis engine — design

**Date:** 2026-06-14
**Status:** Approved (design), pending implementation plan
**Approved mockup:** [2026-06-14-west-coast-engine-mockup.html](./2026-06-14-west-coast-engine-mockup.html)

## Summary

Add a sixth melodic engine, **`westcoast`** (display name **"West"**), implementing
*West Coast / Buchla-style* synthesis: a **complex oscillator** (two oscillators
that cross-modulate via FM + ring/AM, plus a sub-harmonic divider) → a
**wavefolder** ("Timbre") → a **low-pass gate** (vactrol-style), driven by a
built-in **contour** generator.

This is a genuinely new *generation technique* for the project — it builds harmonics
by **folding and cross-modulating**, not by subtractive filtering. It is the maximal
timbral contrast to the existing engines (TB-303, Subtractive, FM, Wavetable, Karplus)
while reusing 100% of the existing plugin infrastructure: registry auto-discovery,
the `EngineParamSpec` param system, the modulation host (LFO/ADSR), JSON presets,
automation, persistence, and undo.

Everything runs in **real time** with Web Audio nodes (no AudioWorklet, no offline
render), so every parameter is live-modulatable. Polyphony is **configurable**
(`VOICES` 1–16); a single voice gives the classic mono West Coast feel.

## Goals

- A new `SynthEngine` (`type: 'polyhost'`, `editor: 'piano-roll'`, `polyphony: 'poly'`)
  that drops into `src/engines/` and is auto-discovered by the build-time glob.
- The complex-oscillator → wavefolder → low-pass-gate signal chain, all in real time.
- Two cross-modulating oscillators: linear FM (native), ring/AM, tunable ratio, and a
  sub-harmonic divider (÷2/÷3/÷4).
- A wavefolder with `FOLD` (amount) and `SYMMETRY` (bias) controls, anti-aliased.
- A low-pass gate with `LP / Gate / Both` modes and a vactrol-like (exponential)
  response.
- A built-in `CONTOUR` AD envelope (`Pluck` / `Sustain` / `Cycle`) that opens the LPG.
- Standard modulation (2 ADSR + 2 LFO) routable to fold / ratio / FM / cutoff / etc.,
  velocity + accent support, JSON presets, full persistence/automation/undo for free.
- Tests across the project's four layers (pure, scheduling, DSP-real, modulation wiring).

## Non-goals (explicitly out of scope)

- **No AudioWorklet.** Through-zero FM (TZFM) is approximated with native linear FM
  (see *Risks*). Introducing the project's first AudioWorklet is deferred.
- **No offline per-note render** (unlike Karplus) — there is no feedback-loop problem
  here, and real-time keeps full live modulation.
- **No new modulation infrastructure.** The built-in `CONTOUR` covers the "function
  generator" role; a full Maths-style multi-stage function generator is not built.
- **No hardware-expression features** (poly aftertouch, ribbon) — not applicable.
- **No user-drawable folding curves / waveshapes.**
- Mixer/master/sidechain interactions, MIDI-import GM mapping nuance, and demo-track
  authoring are unaffected and untouched.

## Background: what we already have vs. what is new

| Engine | Generation technique |
|---|---|
| TB-303 | Subtractive, mono "acid" (slide/accent, resonant filter) |
| Subtractive | Subtractive, poly *East Coast* (2 osc + sub + noise → drive → biquad → ADSR) |
| FM | 4-op frequency/phase modulation (DX7-style, 4 algorithms, feedback) |
| Wavetable | Morph between two `PeriodicWave`s → filter |
| Karplus | Karplus-Strong physical modeling (offline per-note render) |
| Sampler / Audio | Buffer playback (keymap, slicing, WSOLA) |
| **West (new)** | **West Coast: complex osc (FM+ring) → wavefolder → low-pass gate** |

West Coast is *additive-by-folding*: a near-sinusoidal source is enriched by folding
its peaks back on themselves (generating harmonics that scale with amplitude) and by
cross-oscillator modulation (generating inharmonic spectra). The low-pass gate then
shapes both amplitude and brightness together with an organic, percussive decay. None
of the current engines produce this family of timbres.

## Architecture

### Integration with the plugin system

The engine follows the exact shape of `wavetable.ts` / `fm.ts`:

- A `WestEngine implements SynthEngine` with `id='westcoast'`, `name='West'`,
  `type='polyhost'`, `polyphony='poly'`, `editor='piano-roll'`.
- `registerEngine(new WestEngine())` + `registerEngineFactory('westcoast', () => new WestEngine())`
  at module scope; the `import.meta.glob` scan of `src/engines/*` discovers it and it
  appears in the lane engine selector automatically.
- A `PluginFactory` export (`westcoastPlugin`) mirroring the other engines, for the
  plugin manifest path.
- Params declared as `EngineParamSpec[]` with **dot-namespaced ids** (e.g.
  `osc.fmIndex`, `timbre.fold`, `lpg.cutoff`). Scalar state lives in a nested params
  object walked by the same dot-path read/write helpers used by Subtractive
  (`readDotPath`/`writeDotPath`), including discrete index↔string-option conversion.
- A per-engine `ModulationHostImpl` seeded with 2 ADSR + 2 LFO (the project default),
  rendered by `renderModulatorsPanel`.

### Voice model & polyphony

Modeled on `WavetableVoice` / the Wavetable voice manager:

- The engine keeps an `activeVoices` pool. Each note allocates a **`WestVoice`** whose
  audio subgraph is built in its constructor, wired to the shared modulation bus, then
  `trigger()` schedules the note and the voice **self-terminates** (oscillators
  `stop()` + an `ended` listener prunes it from the pool — no perpetual oscillators).
- `poly.voices` (1–16) caps polyphony; oldest-voice stealing on overflow, plus
  same-note stealing (matches Subtractive/PolySynth, prevents MIDI-retrigger pile-up).
- `poly.mode` (poly/mono) gives **real monophony**: in mono the effective voice cap
  collapses to 1 (oldest-voice stealing keeps a single voice sounding). Legato/retrig
  (re-pitching a held voice without re-attacking the contour) requires restructuring
  the voice model and is **deferred to future work** — no `poly.retrig` knob ships in
  v1, to avoid a dead control (decided during Task 2 code review, 2026-06-14).

### Per-voice signal chain (all real-time Web Audio nodes)

```
            ┌─────────── Complex Oscillator ───────────┐
 modOsc ──► fmDepth(gain) ──► mainOsc.frequency          │   (linear FM)
 modOsc ──► ringMod.gain                                  │   (ring/AM)
 mainOsc ─┬─► mainGain ───────────────────────────┐      │   (dry)
          └─► ringMod(gain=0) ─► ringGain ─────────┤      │   (ring/AM mix)
 subOsc ───► subGain ─────────────────────────────┤      │   (sub-harmonic ÷)
                                                    ▼      │
                                            (sum) + bias(DC) ──► foldDrive(gain)
            ┌──────── Timbre · Wavefolder ────────┐
                          foldDrive ──► folder(WaveShaper, oversample '4x')
            ┌──────── Low-Pass Gate ──────────────┐
                          folder ──► lpgFilter(LP) ──► lpgVCA(gain) ──► ampOut ──► output
```

**Complex oscillator**
- `mainOsc` (`OscillatorNode`): waveform from `osc.mainWave` (sine/triangle/sawtooth),
  `frequency = noteFreq` (with `osc.detune` cents + `master.tune`).
- `modOsc` (`OscillatorNode`): waveform from `osc.modWave` (sine/triangle),
  `frequency = noteFreq * osc.ratio`.
- **FM (linear, native):** `modOsc → fmDepth(GainNode) → mainOsc.frequency`. The gain
  scales with note frequency so the modulation index `osc.fmIndex` keeps a constant
  character across the register (deviation = index × modFreq). `fmDepth.gain` is a live
  AudioParam (modulatable).
- **Ring/AM:** `mainOsc → ringMod(GainNode, base gain 0)`; `modOsc → ringMod.gain`
  yields a bipolar product (ring modulation). `osc.ring` (0..1) cross-fades the dry
  `mainGain` path against the `ringGain` path into the folder input.
- **Sub-harmonic divider:** `subOsc` (sine) at `noteFreq / div`, `div ∈ {2,3,4}` per
  `osc.subDiv` (off = no sub), level `osc.subLevel`.

**Wavefolder ("Timbre")**
- `bias` (`ConstantSourceNode`): `offset = timbre.symmetry` summed into the folder
  input (DC offset → asymmetric folding → even harmonics).
- `foldDrive` (`GainNode`): `gain = 1 + timbre.fold × K` — the pre-shaper boost; more
  drive pushes the signal through more fold stages = more harmonics. Live AudioParam.
- `folder` (`WaveShaperNode`): a multi-stage sinusoidal **folding** curve (a sine of
  the input scaled across a wide domain, so peaks wrap back), `oversample = '4x'` to
  tame the broadband aliasing that folding generates. (The curve is built once,
  analogous to `makeDriveCurve` in `polysynth.ts` but folding rather than saturating.)

**Low-pass gate**
- `lpgFilter` (`BiquadFilterNode`, lowpass): base `frequency` from `lpg.cutoff`
  (`60·220^cutoff` Hz, as elsewhere), `Q` from `lpg.resonance`.
- `lpgVCA` (`GainNode`): amplitude gate.
- The **contour** drives the LPG depending on `lpg.mode`:
  - `LP` — contour → `lpgFilter.frequency` (Hz contribution); VCA held open.
  - `Gate` — contour → `lpgVCA.gain`; filter held at base cutoff.
  - `Both` (default) — contour drives **both** (volume + brightness fall together —
    the canonical organic "pluck").
- **Vactrol response:** the contour's ramps use exponential shapes
  (`setTargetAtTime`-style time constants) rather than linear, for the slow organic
  decay that defines the sound.

**Contour generator**
- A `ConstantSourceNode` (`contourSrc`) generating an AD envelope, scaled by
  `contour.amount` into the LPG destination(s).
- `contour.mode`:
  - `Pluck` (default) — fast attack → exponential decay; **percussive, ignores note
    length** (classic West Coast).
  - `Sustain` — attack → hold at `amount` for the note's gate → release.
- `contour.cycle` (off/on) — when on, the AD re-triggers on a loop (period ≈
  attack+decay), turning the contour into a free-running LFO-like source.
- `contour.attack`, `contour.decay` set the shape.

**Output / amp**
- `ampOut` (`GainNode`): output level (`amp.level`) and the summing point for the
  shared `amp.gain` modulation bus, scaled by velocity/accent. An `OUTPUT_TRIM`
  (~0.5, as in `wavetable.ts`/`fm.ts`) keeps the post-fold peak below 0 dBFS.

### Modulation

- `getAudioParams()` (per-voice) exposes, with native ranges via `getAudioParamRange`:
  `amp.gain` (0..1), `lpg.cutoff` (filter Hz, ±), `lpg.resonance` (Q, ±),
  `timbre.fold` (foldDrive gain ×), `timbre.symmetry` (bias ±), `osc.fmIndex`
  (fmDepth ±), `osc.ring` (0..1), `osc.detune` (cents ±), `master.tune` (cents ±).
- `getSharedAudioParams()` exposes a shared `modBus` (one `ConstantSourceNode` per
  param, summed into each live voice — same pattern as PolySynth/Wavetable) for:
  `lpg.cutoff`, `lpg.resonance`, `amp.gain`, `timbre.fold`. A shared LFO on
  `timbre.fold` produces the signature evolving West Coast timbre.
- 2 ADSR + 2 LFO default modulators, bound via the existing engine/per-voice binders
  (`bindEngineModulators` / `bindVoiceModulators`). Default connection depths are 0
  (visible but inert) so the built-in contour stays authoritative until the user dials
  a modulator in — mirroring Subtractive's `depth:0` defaults.

### Velocity & accent

Via the shared `velGain` seam (`core/velocity-gain.ts`): velocity and accent raise
**fold + output level** (brighter + louder on harder hits), consistent with the
project's velocity model.

## Parameters

All `continuous` unless marked discrete. Ids are dot-namespaced.

| id | label | kind | min | max | default | unit |
|---|---|---|---|---|---|---|
| `osc.mainWave` | Princ Wave | discrete | 0 | 2 | 0 (sine) | sine/tri/saw |
| `osc.modWave` | Mod Wave | discrete | 0 | 1 | 0 (sine) | sine/tri |
| `osc.ratio` | Ratio | continuous | 0.25 | 16 | 2 | × |
| `osc.fmIndex` | FM Index | continuous | 0 | 1 | 0.2 | |
| `osc.ring` | Ring/AM | continuous | 0 | 1 | 0 | |
| `osc.subDiv` | Sub ÷ | discrete | 0 | 3 | 0 (off) | off/2/3/4 |
| `osc.subLevel` | Sub Lvl | continuous | 0 | 1 | 0.3 | |
| `osc.detune` | Detune | continuous | -50 | 50 | 0 | ¢ |
| `timbre.fold` | Fold | continuous | 0 | 1 | 0.5 | |
| `timbre.symmetry` | Symmetry | continuous | -1 | 1 | 0 | |
| `lpg.mode` | Mode | discrete | 0 | 2 | 2 (Both) | LP/Gate/Both |
| `lpg.cutoff` | Cutoff | continuous | 0 | 1 | 0.6 | |
| `lpg.resonance` | Resonance | continuous | 0 | 1 | 0.2 | |
| `contour.mode` | Mode | discrete | 0 | 1 | 0 (Pluck) | Pluck/Sustain |
| `contour.attack` | Attack | continuous | 0.001 | 2 | 0.005 | s |
| `contour.decay` | Decay | continuous | 0.005 | 4 | 0.4 | s |
| `contour.amount` | Amount | continuous | 0 | 1 | 0.9 | |
| `contour.cycle` | Cycle | discrete | 0 | 1 | 0 (off) | off/on |
| `amp.level` | Level | continuous | 0 | 1 | 0.8 | |
| `master.tune` | Tune | continuous | -12 | 12 | 0 | st |
| `poly.voices` | Voices | continuous | 1 | 16 | 8 | |
| `poly.mode` | Mode | discrete | 0 | 1 | 0 (poly) | poly/mono (mono = cap 1) |

## UI

`buildParamUI` follows the Subtractive layout: a POLY header row (Mode/Retrig/Voices),
then per-section rows for **Complex Oscillator**, **Timbre**, **Low-Pass Gate**,
**Contour**, then the standard modulators panel. Knobs use `createKnob`; discrete
params use `createSelectControl` / `radio-strip` (with waveform glyphs for the wave
selectors). Per-section knob accent colours reuse the existing palette (cyan / orange /
purple / red). Layout matches the **[approved mockup](./2026-06-14-west-coast-engine-mockup.html)**;
visual parity against that mockup is an acceptance criterion (load the real panel and
compare).

## Presets

A new `public/presets/westcoast.json` with ~16–20 presets exercising the engine's
range (e.g. *Buchla Bongo*, *Fold Bass*, *Metallic Bell*, *Gong*, *Wood Pluck*,
*Drone Pad*, *Sci-Fi Sweep*, *Ring Lead*), with GM program tags where reasonable.
Loaded/validated by the existing `preset-loader.ts`; applied via `applyPreset`
(dot-path `setBaseValue` + `modHost.deserialize`), exactly like Subtractive.

## Persistence, automation, undo

All free via the existing infrastructure: knob edits mirror into
`lane.engineState.params` (`mirrorParamChange`), every knob/select registers under
`<laneId>.<spec.id>` for automation, and `attachKnobUndo` brackets edits as undo
entries. No save-schema change (engine state is generic).

## Testing plan

Four layers, per project convention; **assertions relative (ratios), never absolute**:

1. **Pure** (`west.test.ts`): param get/set round-trips through dot-paths; discrete
   index↔string conversion; defaults; `applyPreset` writes the expected scalar state
   and modulators.
2. **DSP-real** (`west.dsp.test.ts`): render through `OfflineAudioContext` via
   `runStandardEngineBattery` (produces sound, doesn't clip, decays). Plus targeted
   relative checks: `timbre.fold` up → richer spectrum (more high-frequency energy)
   than fold=0; `lpg.mode=Both` with a short contour → both level and brightness fall
   vs. a long contour; `osc.ring`/`osc.fmIndex` up → more inharmonic content. WAVs to
   `test/output/` for audible inspection; golden left unblessed until human review.
3. **Modulation wiring** (`west-shared-mods.test.ts` / `.wiring.test.ts`): a shared LFO
   on `lpg.cutoff` produces a measurable sweep; a per-voice ADSR on `timbre.fold`
   modulates the spectrum; verify via `_getEngineBindingForTesting` /
   `_getLaneBindingForTesting` like the other engines.
4. **Registry** (extend `registry-boot.test.ts`): `westcoast` registers and appears in
   `listEngines()`.

## Risks & limitations

- **FM is native linear, not true through-zero.** With a sine/triangle carrier the
  audible result is very close to TZFM; with a sawtooth carrier at high index it can
  diverge from a real Buchla. Mitigation: sine default carrier; documented. A true
  TZFM oscillator (AudioWorklet) is a future option.
- **Wavefolding aliases.** Folding generates broadband harmonics; `oversample='4x'`
  tames most of it, but the extreme top of the register may still alias slightly.
  Acceptable for a creative engine; noted.
- **Contour `Cycle` (LFO mode)** relies on periodic re-scheduling; under heavy tab
  throttling the cycle period may jitter (same class of caveat as the visual playhead).
- **CPU:** each voice has ~8–12 nodes plus a 4× oversampled `WaveShaper`; at 16 voices
  this is heavier than Subtractive but within budget for a single lane. `poly.voices`
  lets the user trade polyphony for headroom.

## Future work (not now)

- True through-zero FM oscillator via AudioWorklet.
- A second wavefolder stage in series (deeper Buchla 259 timbres).
- A random / sample-and-hold modulation source.
- Dedicated West Coast demo track once the engine lands.
