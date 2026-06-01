# Preset is a per-channel property — remove per-scene preset recall

**Date:** 2026-06-01
**Status:** Approved, ready for planning

## Problem

The synth sound was effectively being recalled **per scene**, not owned by the
channel. `SessionScene.presetPerLane` is a `Record<laneId, presetName>` that gets
re-applied to each lane every time a scene is launched
([session-host.ts:467](../../../src/session/session-host.ts#L467), mirrored at
[main.ts:586](../../../src/main.ts#L586)). The `minimal-techno` demo shows the
effect: lane `subtractive-1` is forced to a different preset in each of its four
scenes, so the *same channel* changes sound as you switch scenes.

This contradicts the intended model: **all clips of a channel share one synth
configuration.** Live editing is already lane-centric — a `SessionClip` carries
only `notes`, `envelopes`, and an optional `sample`; the sound lives in
`SessionLane.engineState` + `SessionLane.enginePresetName`. The only thing that
breaks the model is `presetPerLane`, and nothing in the running app ever writes
it — it is produced solely by demo authoring and MIDI import.

## Decision

Remove `presetPerLane` entirely. A channel has exactly one synth configuration
(`lane.engineState` + `lane.enginePresetName`); launching clips or scenes never
changes the sound.

Automatable preset change (a preset that varies over time/arrangement) is
**future work, explicitly not in this change.** When built it will ride on the
automation system, not on `presetPerLane`, so removing the field now does not
block it.

## Out of scope (unchanged)

- **`ClipEnvelope`** — per-clip parameter automation (e.g. a cutoff sweep inside
  a clip) stays exactly as is. That is automation, not a preset.
- **`lane.enginePresetName`** — the per-channel active preset. Kept; still
  applied on load by `applyLoadedSessionState`
  ([session-host.ts:262](../../../src/session/session-host.ts#L262)).
- **`lane.engineState`** — the per-channel synth state. Kept.
- **Saved-state migration** — none. Old saves that contain `presetPerLane`
  simply become inert once nothing reads the field. No code is added to
  `session-migration.ts`.

## Changes

### 1. Data model
Delete `SessionScene.presetPerLane` from
[session.ts](../../../src/session/session.ts). `SessionScene` keeps only
`id`, `name?`, and `clipPerLane`.

### 2. Runtime — scene launch never touches the sound
- Remove the `if (scene.presetPerLane)` block in
  [session-host.ts:467-471](../../../src/session/session-host.ts#L467)
  (`onLaunchScene`).
- Remove its mirror in
  [main.ts:586-592](../../../src/main.ts#L586) (`launchSceneById`).
- The `applyPresetForLane` dep and the `lane.enginePresetName` application in
  `applyLoadedSessionState` stay — that is the correct per-channel path on load.

### 3. MIDI import
[midi-to-session.ts](../../../src/midi/midi-to-session.ts):
- Drop the `presetPerLane` accumulator (line 48), the `presetPerLane[lane.id] =`
  assignment (line 95), and the `presetPerLane` field on the returned scene
  (line 109).
- Keep `lane.enginePresetName = \`factory:${match.presetName}\`` (line 91) — the
  preset is now a pure channel property.

Importer-added lanes bypass `applyLoadedSessionState`, so their
`enginePresetName` was previously applied via `presetPerLane` on scene launch.
Replace that: in `launchSceneById` ([main.ts:582-584](../../../src/main.ts#L582)),
after `ensureLaneResource(...)`, apply each lane's `enginePresetName` once to the
freshly-allocated engine instance (via the existing
`getLaneEngineInstance` + `applyPresetToEngine`). Without this the imported MIDI
tracks would play the engine's default sound instead of their matched GM preset.

### 4. Demos
Delete the `presetPerLane` key from every demo JSON that carries it:
`minimal-techno`, `mgmt-kids`, `lfo-test`, `solid-sessions-janeiro`,
`untitled`, `sweet-dreams`. Each lane already keeps its `enginePresetName`, so no
sound is lost on load. The only audible change is in `minimal-techno`: each
channel now plays one fixed preset across all four scenes (what was Scene 1's
preset) instead of varying per scene.

### 5. Tests
- `session.test.ts` — remove the `describe('SessionScene.presetPerLane')` block.
- `session-host-presets.test.ts` — remove the
  `applies scene.presetPerLane when a scene is launched` test; keep the
  `enginePresetName`-on-load test.
- `midi-to-session.test.ts` — the three assertions on
  `result.scene.presetPerLane?.[...]` now assert the matched lane's
  `enginePresetName` instead.
- No migration test (no migration code).

## Verification

- `npm run build` (tsc + bundle) green.
- `npm run test:unit` green.
- Browser smoke: load `minimal-techno`, launch each scene in turn — the
  subtractive/TB-303 channels keep the same preset across scenes (no sound
  change on scene switch). Import a MIDI file — tracks still play their matched
  GM presets.
