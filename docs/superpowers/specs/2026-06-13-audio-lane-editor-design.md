# Phase 2a — Audio lane editor: not an instrument

Status: design approved (awaiting spec review). Date: 2026-06-13.

## Problem

Opening an AUDIO-engine lane (e.g. an imported stem) shows the full **instrument**
editor: an engine selector (FM/Karplus/Subtractive/TB-303/Wavetable), a PRESET
selector + Load/Save/Delete, a 🎲 Sound randomiser, a Gain knob, a NOTE FX section,
and the insert/FX chain. **An audio lane is not an instrument** — most of that chrome
is meaningless (you can't give a recorded stem a synth preset or an arpeggiator). The
few controls that do apply (Gain, Warp) should sit **next to the sample, in the clip
editing window** where the waveform is.

## Decision (user-approved)

- Strip the instrument chrome from an audio lane's editor: **no** engine selector,
  preset, 🎲 Sound, or NOTE FX.
- **Keep** the per-lane **insert FX** chain (a stem may want its own filter/reverb).
- Move **Gain** (and **Warp**, already there) into the **clip editing window**, in a
  compact toolbar above the waveform.
- The **mixer strip** (EQ / sends / pan / mute-solo / volume) is unchanged.

## Design

### 1. Clip editing window gets the controls
`renderAudioClipEditor` (`src/session/clip-editors/clip-waveform-header.ts`) already
renders a toolbar (Warp toggle) above the waveform. Add the audio engine's **Gain**
knob to that toolbar, mounted as an automatable knob (same registration the lane editor
uses today via `wireEngineParams`/`buildParamUI`). This requires threading an
engine-UI/automation context from `renderClipEditor` (`clip-editor-router.ts`) down to
`renderAudioClipEditor` (it currently only receives `getPlayheadFrac`). Layout: a single
control row — `[Gain] [♺ Warp]` — above the waveform/ruler/playhead. (Phase 2b adds trim
+ beat/warp markers to this same toolbar.)

### 2. Lane editor strips instrument chrome for audio lanes
`injectEngineModulatorPanel` (`src/session/session-host-lane-editor.ts`) currently, for
every lane, calls `buildParamUI`, renders NOTE FX (guarded only against `drums-machine`),
mounts inserts, and populates a preset dropdown. For `lane.engineId === 'audio'`:
- skip `buildParamUI` (the Gain knob now lives in the clip editor),
- skip the NOTE FX panel,
- skip preset-dropdown population,
- **keep** `mountLaneInserts` (the FX chain).

### 3. Engine selector hidden for audio lanes
The engine selector (`#engine-select`, wired in `engine-selector-ui.ts`) lets you swap a
lane's engine. An audio channel can't become a synth, so hide/disable it when the active
lane is `audio` (and the swap guard in `engine-swap.ts` should reject `audio` as source
or target — audio's `editor` is `'piano-roll'`, so it isn't rejected today).

### 4. Mixer
Unchanged. Per-lane EQ/sends/pan/mute-solo/volume stay in the mixer strip.

## Components / seams

- `src/session/clip-editors/clip-waveform-header.ts` — `renderAudioClipEditor`: add the
  Gain knob to the toolbar; accept an engine-UI context dep.
- `src/session/clip-editors/clip-editor-router.ts` — `renderClipEditor`: thread the
  engine-UI/automation context into `renderAudioClipEditor`.
- `src/session/session-host-lane-editor.ts` — `injectEngineModulatorPanel`: `engineId
  === 'audio'` guard (skip params/NOTE-FX/preset, keep inserts).
- `src/engines/engine-selector-ui.ts` (+ `src/app/engine-swap.ts`) — hide/disable the
  selector for audio lanes and reject `audio` swaps.

## Reuse vs new

- Reuse: `wireEngineParams` (the same Gain-knob wiring that `audio.ts buildParamUI` uses
  today) + the existing automation-registry knob mounting; `mountLaneInserts`; the
  waveform header.
- New (small): a tiny pure predicate (e.g. `audioLaneShowsInstrumentChrome(engineId)` →
  false for `'audio'`) so the lane-editor guard is testable; the context threading; the
  selector-hide.

## Testing / acceptance

- **Unit:** a pure predicate that says an `'audio'` lane shows no instrument chrome
  (engine selector / preset / NOTE FX / engine-param panel) but keeps inserts; melodic
  engines unchanged. (Relative/boolean assertions.)
- **Live (acceptance):** open an audio (stem) lane → editor shows **only the FX inserts**
  (no engine selector, preset, 🎲, NOTE FX, Gain). Open its clip → waveform with a
  toolbar **[Gain] [Warp]**; the Gain knob still works and is automatable. A melodic lane
  is unchanged (full instrument editor).

## Out of scope (Phase 2b)

Beat detection + draggable warp markers + piecewise time-stretch to lock the audio to the
grid. Those land in this same clip-editor toolbar/window in the next spec.

## Risks / notes

- The Gain knob is the **engine** (lane-level) param shown inside the per-clip window;
  fine because an audio lane normally has a single clip. (If a lane ever holds several
  audio clips they share that Gain — acceptable.)
- Threading the engine-UI context into the clip editor is the main wiring change; keep it
  optional so non-audio clips (which don't use it) are unaffected.
