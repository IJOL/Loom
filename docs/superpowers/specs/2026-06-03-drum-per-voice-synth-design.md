# Per-voice drum synthesis: actuatable params + independent FX sends

**Date:** 2026-06-03
**Status:** Design approved (pending written-spec review)
**Area:** `src/core/drums.ts`, `src/engines/drums-engine.ts`, drum inspector UI

## Problem

The synthesized drum machine hides all of its per-sound character behind kit
constants. The synthesis parameters for each voice (kick start/end freq, snare
snappy/tone, hat tune/decay, …) live as read-only number bags in `KITS`
([src/core/drums.ts](../../../src/core/drums.ts)) and are read fresh inside each
`play*` method. There is **no UI** to shape an individual drum, and no
persistence of per-voice tweaks. The only surfaced drum controls are the
**single bus strip** (`DRUM VOL/PAN/REV/DLY/LO/MID/HI`) exposed by
`drum-master-ui.ts` and the modulators panel.

This violates the project's own rule that hard-coded sound params must have a UI
surface or be removed.

We want, per the user's request, to **imitate a 909/808/modern drum synth**:
each of the 8 voices gets its own column of actuatable knobs (tune, decay,
character) plus **independent reverb/delay sends**, arranged as a compact
mini-mixer inside the Drums view.

## Key prior finding (changes the design)

Each drum voice **already has its own `ChannelStrip`** in the audio graph
(`DrumMachine.channels`, [src/core/drums.ts:107-109](../../../src/core/drums.ts)),
routed via `setOutputTarget(inserts.inputNode)`
([src/app/lane-allocator.ts:145](../../../src/app/lane-allocator.ts)). Every
per-voice strip already has EQ + level + pan + **reverbSend/delaySend wired to
the shared `FxBus`** — they are simply pinned at default (sends = 0) with no knob
and no persistence. So **independent per-voice FX sends are already audio-wired**;
this work surfaces, persists, and defaults them.

What does *not* exist yet: any way to read/edit the per-voice **synthesis**
params. Those are kit constants read at trigger time.

## Goals

1. Expose a curated, hardware-style set of synthesis knobs **per voice**, with a
   `▸ advanced` expander revealing the raw DSP params.
2. Surface **per-voice mixer controls**: LEVEL, REV send, DLY send (curated);
   PAN + EQ LO/MID/HI (advanced).
3. Lay it out as a compact 8-column mini-mixer **inside the Drums inspector**,
   positioned between the existing master-strip knob block and the modulators
   panel.
4. Persist every per-voice edit across tab switches and save/load.
5. Kit selection = **preset of departure**: loading a kit repopulates all
   per-voice defaults (overwrites tweaks).

## Non-goals (YAGNI)

- Per-voice synthesis params are **not** audio-rate modulation destinations
  (they are trigger-time scalars, not `AudioParam`s). Knob control + value
  automation recording is in scope; LFO/ADSR routing onto them is not.
- Per-voice mixer params are **not** added to the LFO/ADSR destination dropdown
  by default (would add 32 entries; revisit later if wanted). They remain
  automatable via the knob registry.
- No new drum *voices*, no sample layering, no choke groups.

## Approach (chosen): first-class engine params

Model every per-voice control as an `EngineParamSpec` with a dotted id
`<voice>.<param>` (e.g. `kick.tune`, `snare.snap`, `kick.level`, `kick.rev`).
This reuses the entire existing machinery — `createKnob`, the automation
registry, undo (`attachKnobUndo`), and the `lane.engineState.params[...]` mirror
([src/session/session-engine-state.ts:28](../../../src/session/session-engine-state.ts))
that already persists engine knob values across save/load and demos.

Two backing stores, dispatched by `setBaseValue`/`getBaseValue` on the id:

- **Mixer params** (`<voice>.level|pan|rev|dly|eq.low|eq.mid|eq.high`) → write
  straight to the matching `AudioParam` on the voice's existing `ChannelStrip`.
  Real `AudioParam`s → sample-accurate, automation-ready.
- **Synthesis params** (`<voice>.tune|decay|…`) → write to a per-voice scalar
  store (`Record<DrumVoice, VoiceSynthParams>`) that each `play*` reads **at
  trigger time** (consistent with the existing "live tweaks apply to the next
  trigger" behavior).

Rejected alternative — a bespoke per-voice "patch" object with custom UI and
custom persistence: more layout freedom but reinvents persistence/automation/
undo and diverges from how every other engine works. Not worth it.

### Why this fits the codebase

The repo's spine is "everything is a plugin behind a registry; params are
declared `EngineParamSpec[]`; voices/engines expose them so modulation +
automation work for free." Declaring per-voice params the same way keeps drums
consistent with the 6 other engines.

## Data model

### Per-voice synthesis store

Move `KITS` from read-only constants to the **source of defaults**. Introduce a
live per-lane store the `DrumMachine` reads at trigger time:

```ts
// One editable record per voice, seeded from the active kit.
interface VoiceSynthState {
  // values are stored ABSOLUTE where there is a single underlying field,
  // and as a MULTIPLIER (default 1.0) for "tune" which transposes >1 freq field.
  [paramId: string]: number;
}
type DrumSynthState = Record<DrumVoice, VoiceSynthState>;
```

`DrumMachine` gains:
- `setVoiceParam(voice, paramId, value)` / `getVoiceParam(voice, paramId)`
- `loadKitDefaults(kitId)` — copies `KITS[kitId]` into the synth store + resets
  per-voice mixer to neutral (level=1, pan=0, rev=0, dly=0, eq=0).
- Each `play*` reads from the store instead of the passed kit bag.

**Tune convention:** `TUNE` is a transpose multiplier over the voice's base
frequencies (12 o'clock = ×1.0). Advanced absolute freq fields define the base;
final freq = `baseFreq × tuneMul`. This matches how `hat.tune` / `ride.tune`
already work. `DECAY`/`ATTACK`/etc. map 1:1 to their absolute field.

### CH/OH independence

Today closed + open hats share one `HatParams` (`decay` for closed, `openDecay`
for open, one shared `tune`). To make CH and OH genuinely independent columns,
split per voice: `closedHat` carries its own `tune`+`decay`; `openHat` carries
its own `tune`+`decay`. Small change in `playHat` to read the per-voice tune
rather than the shared one.

### Engine param specs

`DRUM_PARAMS` in [src/engines/drums-engine.ts](../../../src/engines/drums-engine.ts)
gains, for each voice, the curated + advanced + mixer ids below. The existing
`bus.*` params stay (master strip). Per-voice `level/pan/rev/dly/eq.*` map to the
voice `ChannelStrip`; synthesis ids map to the `DrumMachine` synth store.

## Per-voice knob map (imitating 909/808 + modern)

Each column: **CURATED** (visible) + **▸ ADVANCED** (collapsed) + **MIXER**.

| Voice | CURATED (synth) | ▸ ADVANCED (synth) | Underlying `KITS` fields |
|---|---|---|---|
| **KICK** | TUNE · ATTACK · DECAY | START · END · SWEEP · WAVE | startFreq, endFreq, clickAmount, ampDecay, pitchDecay, tone |
| **SNARE** | TUNE · TONE · SNAP | BODY DEC · NOISE DEC · NOISE TONE | tone1, tone2, toneAmount, noiseAmount, toneDecay, noiseDecay, noiseFilter |
| **CH** | TUNE · DECAY | FILTER | hat tune(closed), decay |
| **OH** | TUNE · DECAY | FILTER | hat tune(open), openDecay |
| **CLAP** | TONE · DECAY | SHARP (Q) | filterFreq, decay, filterQ |
| **TOM** | TUNE · DECAY | SWEEP · END | startFreq, endFreq, ampDecay, pitchDecay |
| **COWBELL** | TUNE · DECAY | DETUNE | freq1, freq2, decay |
| **RIDE** | TUNE · DECAY | — | tune, decay |
| **(all voices)** | LEVEL · REV · DLY | PAN · EQ LO/MID/HI | per-voice `ChannelStrip` |

Param-id naming (examples): `kick.tune`, `kick.attack`, `kick.decay`,
`kick.startFreq`, `kick.endFreq`, `kick.sweep`, `kick.wave`, `kick.level`,
`kick.pan`, `kick.rev`, `kick.dly`, `kick.eq.low|mid|high`; analogous for the
other 7 voices.

Ranges/units are defined per spec in the implementation plan (musical ranges for
curated; absolute Hz/seconds for advanced). `WAVE` is a discrete select
(sine/triangle/square) — rendered as a `select-control`, not a knob.

## UI: the per-voice mini-mixer rack

A new renderer (e.g. `renderDrumVoiceRack(container, deps)`) draws an 8-column
rack. Each column:

```
┌ KICK ──┐
│  TUNE  │   ← curated synth knobs (compact, ~36px)
│ ATTACK │
│  DECAY │
│ ─────  │
│ LEVEL  │   ← curated mixer
│  REV   │
│  DLY   │
│ ▸ adv  │   ← expander: START/END/SWEEP/WAVE + PAN + EQ LO/MID/HI
└────────┘
```

- Mounted at the **top of `DrumsEngine.buildParamUI`**, before
  `renderModulatorsPanel`. Because `.engine-mod-host` already sits between
  `#drum-master-knobs` and the FX row
  ([src/session/session-host.ts:639-651](../../../src/session/session-host.ts)),
  the rack lands exactly between the master strip and the modulators — no
  `index.html` change.
- Each knob is built with `createKnob`, registered via `ctx.registerKnob`
  (→ automation), wrapped with `attachKnobUndo` (→ undo), and its `onChange`
  calls `engine.setBaseValue(id, v)` + mirrors to `engineState` (the standard
  path used by `wireDrumMasterUI`).
- The `▸ advanced` expander toggles a per-column hidden block; expansion state is
  view-only (not persisted) — defaults collapsed.
- Re-rendered per active drum lane (multiple drum lanes each get their own rack,
  retargeting ids by `laneId` prefix exactly like the master strip).

## Persistence & kit behavior

- Every per-voice param flows through `engine.setBaseValue` → mirrored to
  `lane.engineState.params[<laneId-stripped id>]` via the existing
  `mirrorParamChange` path, so it survives tab switch + save/load + demos.
- On load, persisted params are re-applied via `engine.setBaseValue` (same path
  the bus params already use).
- **Kit = preset of departure**: `applyPreset(kitId)` /
  kit-selector change calls `DrumMachine.loadKitDefaults(kitId)`, which
  repopulates the synth store and resets per-voice mixer to neutral, then the UI
  re-reads via `getBaseValue` to refresh knob positions. Existing tweaks are
  overwritten (intended).
- Interaction order: kit load writes defaults first; persisted `engineState`
  params (if any) are applied **after**, so a saved session restores the user's
  tweaks on top of the kit baseline.

## Presets

A drum preset becomes a **full patch = kit + per-voice overrides**, reusing the
existing flat `EnginePreset.params` map (same pattern as tb303/fm/karplus). This
is backward compatible: today's `params` is already a free `id→value` object
([public/presets/drums-machine.json](../../../public/presets/drums-machine.json)),
so the current 8 kit-only presets keep working untouched.

Preset shape:

```json
{ "name": "Techno Punch", "gm": [24],
  "params": { "kitId": "909", "kick.tune": 0.9, "kick.decay": 0.6,
              "kick.attack": 0.8, "closedHat.decay": 0.04, "snare.snap": 0.8 } }
```

`DrumsEngine.applyPreset(name)` ([src/engines/drums-engine.ts:253](../../../src/engines/drums-engine.ts)):
1. If `params.kitId` is present → `DrumMachine.loadKitDefaults(kitId)` sets the
   **departure point** (kit defaults + neutral per-voice mixer).
2. Apply every remaining `params["<voice>.<param>"]` via `setBaseValue` — the
   overrides baked into the preset, layered on top.
3. The caller (session-host preset wiring) re-reads `getBaseValue` for each rack
   knob to reposition it and mirrors the resulting values into `engineState`
   (identical to how the master strip + other engines refresh after a preset).

Compatibility / ordering:
- A kit-only preset (`{ "kitId": "808" }`) applies step 1 and zero overrides →
  identical to today.
- The existing 8 factory presets are left **unchanged**; the schema now *permits*
  richer character presets, which can be added later as plain JSON.

**No user "Save As" for drums in this scope.** The drums page keeps `Load` + 🎲
only. The per-voice sound is still fully persisted **with the project** via
`lane.engineState.params` (session save/load) — it is just not separately
reusable as a named user preset. A drums Save As (user presets in localStorage,
like the poly page) is a deferred follow-up.

**Discrete params:** `WAVE` (sine/triangle/square) is non-numeric. In a preset
it is stored as a key/index; `setBaseValue` (currently `number`-only) needs a
small encoding for discrete ids (e.g. an index into the wave list) so presets and
the `select-control` agree. Flagged for the implementation plan.

## Testing

Following the four-layer convention:

1. **Pure / unit** (`drums-*.test.ts`):
   - `loadKitDefaults` seeds the synth store from `KITS` and resets mixer to
     neutral.
   - `setVoiceParam`/`getVoiceParam` round-trip; tune multiplier composition
     (`finalFreq = base × tuneMul`).
   - CH/OH independence: editing `closedHat.tune` does not change `openHat.tune`.
   - `setBaseValue('kick.rev', x)` writes the kick `ChannelStrip.reverbSend` gain
     (assert via `getAudioParams`/serialize), independent from other voices.
   - Param mirror: a `setBaseValue` lands in `engineState.params`.
2. **DSP real** (`drums*.dsp.test.ts`): extend the existing drum battery — render
   a kick at TUNE high vs low and assert a **relative** spectral-centroid /
   pitch shift; render with REV send up vs 0 and assert relatively more energy in
   the reverb tail. Assertions stay ratio-based per the repo rule.
3. **UI smoke** (jsdom): `renderDrumVoiceRack` builds 8 columns, registers the
   expected knob ids for a given laneId, and `onChange` calls `setBaseValue`.

## Risk / blast radius

- `KITS` shifts from constant to defaults source — verify all 5 kits still load
  and the existing DSP battery stays green (run `gitnexus_impact` on
  `DrumMachine.trigger` / `play*` before editing; report blast radius).
- `playHat` signature/behavior change (CH/OH split) — covered by the hat DSP
  test.
- `DRUM_PARAMS` grows substantially; confirm the modulation destination dropdown
  and automation list don't accidentally surface per-voice synth ids (they are
  not `AudioParam`s, so they must be excluded from `getSharedAudioParams`).

## Open questions resolved during brainstorm

- Depth → **hybrid** (curated + `▸ advanced`).
- Location → **inside Drums inspector**, mini-mixer between master knobs and
  modulators.
- Kit relation → **kit = preset of departure** (reload overwrites tweaks).
- CH/OH → **independent** tune+decay.
- Per-voice mixer as mod destinations → **out of scope** for now.
- EQ per voice → **advanced** only.
