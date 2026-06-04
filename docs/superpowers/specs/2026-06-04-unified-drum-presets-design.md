# Unified drum kits — Drums embeds a complete Sampler; the preset picks synth vs sample

**Date:** 2026-06-04
**Status:** Design approved (reviewed against real source via workflow `wf_7952dda4-7d0` — 13 findings folded in)
**Area:** `drums-machine` engine (`src/engines/drums-engine.ts`), the drums preset dropdown + loader, persistence, the embedded `SamplerEngine`
**Part of:** the drums redesign. **Spec A** (sampler per-pad control) is DONE/merged. This is **Spec B**.

## The idea (plainly)

The **Drums** lane stays **one engine** the whole time (`drums-machine`). That engine **embeds a complete `SamplerEngine` instance** inside it. A **unified preset** decides which of the two internal sources sounds:

- **synth kit** (909/808…) → the existing synthesized `DrumMachine` plays.
- **sample kit** (TR-808 WAVs, Acoustic…) → the **embedded Sampler** plays — the *whole* sampler: drumkit loading, the 8-column per-pad rack, per-pad TUNE/CUTOFF/DECAY/sends, loop/retrigger, mute/solo, even custom file drop.

**No engine swap. No engine selector. No DSP extraction.** We reuse the existing `SamplerEngine` class *as-is*, embedded; we only **refactor `DrumsEngine` into a façade** that forwards to whichever source the preset selected. Same drum-grid editor in both modes (the lane id never changes).

## Why this is clean

[trigger-dispatch.ts:26-28](../../../src/app/trigger-dispatch.ts) fires every note uniformly: `const v = engine.createVoice(ctx, strip.input); v.trigger(midi, …)`. Drums and Sampler are both `type: 'polyhost'` and both already follow this per-note `createVoice → trigger` shape. So the façade delegates at exactly one seam — `createVoice` — and the drum-grid's GM-note `NoteEvent`s land on the embedded sampler's drumkit pads (a kit pins each voice to its GM note).

The embedded sampler already does everything we need for sample drums: Spec A gave it the per-pad rack (`getRackLayout`), the `getDrumVoice*` mute/solo contract, per-pad params keyed by note, and drumkit loading. We are wiring it in, not rebuilding it.

## Goals

1. `DrumsEngine` becomes a **façade** over two internal sources: the synth `DrumMachine` path (unchanged) and an eagerly-constructed embedded `SamplerEngine` (`private sampler = new SamplerEngine()`), selected by `kitMode: 'synth' | 'sample'`.
2. A single **unified Drums preset list** (one curated JSON) spanning synth kits + sample kits, populating the drums-page picker.
3. Picking a Drums preset sets `kitMode` and **loads that kit** into the active source, in place.
4. In **sample mode** the Drums inspector engine-body shows the **complete embedded sampler UI**; in **synth mode** it shows today's synth rack + modulators.
5. `kitMode` + kit + per-source edits **persist** across save/load; sample WAVs self-heal by id.
6. **Back-compat preserved:** MIDI import, the GM lookup, the bundled demos, and `drums-machine.json` keep working unchanged.

## Non-goals

- **The standalone `SamplerEngine` on the Poly lane stays unchanged** (melodic pitched sampling). We embed *another instance* of the same class inside Drums; we do not remove or fork the engine.
- No DSP extraction / no refactor of `SamplerVoice`.
- No engine swap, no engine selector (rejected).
- **`drums-machine.json` is NOT retired.** It stays as the GM-tagged source for MIDI import + GM lookup + demos (and `preset-sanity.test.ts` requires ≥ 8 entries). The new `drum-kits.json` is an *additional* curated list that drives only the drums-page picker.
- No new bundled kits or samples (reuse `public/drumkits/*`).
- No per-scene presets (preset is per-lane — [[project_preset_per_channel]]).

## Architecture

### 1. `DrumsEngine` becomes a façade

`DrumsEngine` ([src/engines/drums-engine.ts](../../../src/engines/drums-engine.ts)) gains:

- `private sampler = new SamplerEngine()` — the embedded, complete sampler, **constructed eagerly** (a plain field) so host-wiring can forward to it immediately.
- `kitMode: 'synth' | 'sample' = 'synth'`; `getKitMode()` / `setKitMode(m)`.
- `private active()` → returns the surface to forward to for the current mode.

**Host-wiring setters forward to the embedded sampler eagerly** (the sampler reads `fx`/output only at voice construction, and a missing `fx` fails *silently* — no throw — unlike the synth `DrumMachine`, [drums-engine.ts:347-349](../../../src/engines/drums-engine.ts)):

- `setSharedFx(fx)`: keep today's behavior **and immediately** `this.sampler.setSharedFx(fx)`. Because the embedded sampler is an eager field and `lane-allocator` forwards `setSharedFx` before the first `createVoice` ([lane-allocator.ts:142-149](../../../src/app/lane-allocator.ts)), the embedded sampler always has `fx` before its first sample-mode `createVoice`.
- `setOutputTarget(n)` / the `output` arg: the embedded sampler's `createVoice(ctx, target)` receives the **same routing target** (insert-chain input, else `busStrip.input`), so both sources feed the lane bus strip → inserts identically.
- `setBusStrip(strip)`: unchanged — the synth path's `bus.*` params and the lane modulators bind to this strip in both modes.

**`createVoice(ctx, output)`** routes by mode:

- `synth` → today's path (reuse/create the `DrumMachine` keyed by routing target, return a `DrumsVoice`).
- `sample` → `return this.sampler.createVoice(ctx, routingTarget)` (a `SamplerVoice` for this note).
- In **both** modes, ensure the one-shot **bus modulator binding** still fires once for the lane (the `engineModVoices` + `bindEngineModulators` block targets the bus strip, independent of the sound source) so an LFO on `bus.pan` keeps working in sample mode.

**Surface forwarding (mode-dependent unless noted):**

| Method | synth mode | sample mode |
|---|---|---|
| `get params` | `DRUM_PARAMS` (today) | `this.sampler.params` |
| `getBaseValue` / `setBaseValue` | today's DrumMachine path | `this.sampler.getBaseValue/setBaseValue` |
| `buildParamUI` | rack + modulators (today) | `this.sampler.buildParamUI(container, ctx)` |
| `getRackLayout` | today | `this.sampler.getRackLayout()` |
| `getDrumVoiceMute/Solo/...` + `setDrumVoiceMutes` | live `DrumMachine` (today) | embedded `this.sampler` |
| `setKeymap` / `getKeymap` | → `this.sampler` (always) | → `this.sampler` |
| `setPadStore` / `getPadStore` | → `this.sampler` (always) | → `this.sampler` |
| `setKitMode` / `getKitMode` | own field | own field |

Two forwarding details the review surfaced:

- **`getDrumVoice*` / `setDrumVoiceMutes` must route through `active()`**, not the hard-coded `this.lastInstance` they use today ([drums-engine.ts:261-267](../../../src/engines/drums-engine.ts)) — otherwise per-pad mute restore/edits in sample mode hit the synth `DrumMachine`, the wrong source.
- **`setKeymap`/`getKeymap`/`setPadStore`/`getPadStore` must exist on the façade and forward to `this.sampler` unconditionally.** The load-time restore in `applyEngineState` feature-detects these *on the lane engine* (the façade) — see §5. They are inert for a synth lane (no `engineState.sampler` to restore), so always-forwarding is safe.

`getSharedAudioParams` / `DrumsVoice.getAudioParams` stay bus-only in both modes (modulation targets the shared strip).

### 2. Two apply paths: interactive (ctx-aware) vs load-recall (sync)

The existing `applyPreset(name): void` seam is **synchronous and ctx-less** ([preset-apply.ts:28-50](../../../src/presets/preset-apply.ts) → `engine.applyPreset(bare)`), but a sample kit's load needs an `AudioContext` for `loadDrumkit` (`decodeAudioData`) and is async. We therefore split the two responsibilities instead of overloading the sync method:

**(a) `applyPreset(name): void`** — the SynthEngine method, recalled on load and used for synth picks. Signature unchanged. It must:
1. Resolve `name` against the unified list (loaded once); **on a miss, fall back to the legacy `drums-machine.json` lookup** (`this.presets` → `kitId`) and then the bare-kit-name fallback — this keeps GM-import / demo names like `KIT Power` / `KIT Standard` resolving (§ back-compat).
2. **Set `kitMode` first, unconditionally** — do NOT keep today's top-of-method `if (!this.lastInstance) return` guard ahead of the `kitMode` assignment. (Today's guard makes `applyPreset` a no-op on load because `lastInstance` is null until the first `createVoice`; the synth path survives only because `applyEngineState` replays per-voice params afterward. The TB-303 had the same bug class — see `tb303-preset-apply.test.ts`.)
3. **synth kit:** if `lastInstance`, `loadKitDefaults(kitId)` + re-apply numeric overrides (guard *only this* on `lastInstance` — harmless, params replay via `engineState`).
4. **sample kit:** set `kitMode='sample'` and mirror `drumkitId` into `engineState.sampler` only — **no decode here** (no ctx). The decode is owned elsewhere (interactive path below for live picks; the `drumkitId` self-heal for load — §5).

**(b) The interactive orchestrator (ctx-aware, async)** — owns the live pick from the drums-page dropdown / Load / 🎲. It lives in **session-host** (which holds `this.deps.ctx`, `this.state`, and the inspector-body rebuild), e.g. `applyDrumPreset(laneId, name)`:
- Resolve the unified entry.
- **synth:** `engine.applyPreset(name)` (sync).
- **sample:** `fetchDrumkitManifest(drumkitId)` → `loadDrumkit(manifest, this.deps.ctx)` → `engine.setKeymap(km)` + `mirrorKeymapChange` + `mirrorDrumkitId`; set `engine.setKitMode('sample')`.
- Then **rebuild the inspector engine-body** for that lane (§6) and `refreshLaneKnobs`.

This keeps the `AudioContext` in session-host (where it already is) rather than threading it through the engine.

### 3. Unified preset JSON + its loader

`public/presets/drum-kits.json`. **The Synth group preserves the EXISTING synth drum presets** (the GM-named `KIT *` entries, same names + kitIds as `drums-machine.json`) so nothing the user had disappears — "unified" = the existing presets **plus** the sample kits, not a curated replacement:

```json
{ "presets": [
  { "name": "KIT Standard",      "group": "Synth",   "kind": "synth",  "kitId": "909" },
  { "name": "KIT Room",          "group": "Synth",   "kind": "synth",  "kitId": "linn" },
  { "name": "KIT Power",         "group": "Synth",   "kind": "synth",  "kitId": "909" },
  { "name": "KIT Electronic",    "group": "Synth",   "kind": "synth",  "kitId": "606" },
  { "name": "KIT TR-808",        "group": "Synth",   "kind": "synth",  "kitId": "808" },
  { "name": "KIT Jazz",          "group": "Synth",   "kind": "synth",  "kitId": "78" },
  { "name": "KIT Brush",         "group": "Synth",   "kind": "synth",  "kitId": "78" },
  { "name": "KIT Orchestra",     "group": "Synth",   "kind": "synth",  "kitId": "linn" },
  { "name": "TR-808 (samples)",  "group": "Samples", "kind": "sample", "drumkitId": "tr808" },
  { "name": "Acoustic (samples)","group": "Samples", "kind": "sample", "drumkitId": "acoustic" }
] }
```

Schema per entry: `name`, `group` (display heading), `kind` (`'synth'` | `'sample'`), and `kitId` (synth) / `drumkitId` (sample). (The names match `drums-machine.json`, so MIDI-import / `gm-lookup` recall — `factory:KIT Power` etc. — keeps resolving through the same unified lookup.)

**Loader wiring (review finding):** `drum-kits` is not a plugin id, so the existing `loadAllPresets(ENGINE_IDS_FOR_PRESETS)` ([main.ts:86-87](../../../src/main.ts)) never fetches it, and its schema fails `validatePresetEntry` (which requires `gm[]` + `params{}`). So add a **bespoke `drum-kits-loader.ts`** with `loadDrumKits()` that fetches + validates `drum-kits.json` into its **own cache** (not the `EnginePreset` cache). Boot must start it **alongside** `loadAllPresets(...)` and the drums `<select>` must be populated only after it resolves (await it before the first `mountDrumsPresetSelect`, or re-render on resolve) — otherwise the dropdown is empty/racy on the first drums-tab render.

### 4. Editor routing is unchanged

The lane id stays `drums-machine` in both modes, so `chooseClipEditor` keeps routing it to the **drum-grid** editor and `showLaneEditor`/`pageForLane` keep it on the **drums** page. A sample kit's drumkit pins to the same GM drum notes the drum-grid already uses, so the grid drives the embedded sampler with no editor change.

### 5. Persistence

- **New schema field:** add `kitMode?: 'synth' | 'sample'` to `SessionLane.engineState` ([session.ts:50-57](../../../src/session/session.ts)). Additive/optional → round-trips verbatim via `cloneSessionState` (JSON deep clone) with no save-schema bump and no migration step. **Absent ⇒ `'synth'`** on load (matches the façade default), so existing sessions restore unchanged.
- In **synth** mode the existing synth persistence applies (per-voice ids + `drumMutes`). In **sample** mode the embedded sampler mirrors its sub-state into `engineState.sampler` (`drumkitId` + `keymap` + `padParams`) via the same `mirror*` hooks `buildParamUI` installs.
- **Load-time restore reaches the embedded sampler through the façade.** `applyEngineState` ([session-host.ts:301-345](../../../src/session/session-host.ts)) feature-detects `setKeymap`/`setPadStore`/`setDrumVoiceMutes` **on the lane engine** (the façade) and restores the drumkit via `reloadDrumkit`. Because §1 makes the façade forward those methods to `this.sampler`, the existing restore path drives the embedded sampler unchanged. `applyEngineState` should also **restore `kitMode` first** (from `engineState.kitMode`, via `setKitMode`) so `active()` points at the right source before the keymap/padStore/mutes restore runs.
- **Single owner for the sample-kit decode on load.** The load path recalls the preset ([session-host.ts:266-268](../../../src/session/session-host.ts)) *before* `applyEngineState` (:270), and `applyEngineState` independently fires `reloadDrumkit` off `engineState.sampler.drumkitId` (ctx-bearing). To avoid a double/racing decode: **the `drumkitId` self-heal is the sole load-time decoder.** Per §2(a), the recalled `applyPreset` for a sample kit does *not* fetch/decode — it only sets `kitMode` + mirrors `drumkitId`. `enginePresetName` is restored to drive the dropdown label, not a second decode.

### 6. UI

The drums page keeps its single PRESET `<select>` + Load + 🎲.

- **Populate (review finding):** the existing `mountDrumsPresetSelect` → `populateEnginePresetSelectById` reads `DrumsEngine.presets` (flat, `engine:<name>` option values, no groups). Replace it **for this select** with a custom populator that reads `drum-kits.json` and builds `<optgroup>`s by `group`. Keep option values `engine:<unified name>` so the existing `wireEnginePresetSelectById` change/Load listener still fires; its `change`/Load handler for the drums select routes to the **session-host interactive orchestrator** (§2b, ctx-aware) — not the generic ctx-less `applyEnginePresetForLane`.
- **Panel swap (review finding):** the swap is confined to the inspector **engine-body** — the container `DrumsEngine.buildParamUI` owns (where the 8-column drum-synth voice rack renders today). In sample mode that exact container instead renders `this.sampler.buildParamUI` (the complete sampler panel: rack + keymap + drumkit picker + file drop). **`refreshLaneKnobs` does NOT rebuild this body** (it only re-pushes knob values); today the body rebuilds only on lane re-select (`showLaneEditor → injectEngineModulatorPanel`). So the interactive orchestrator (§2b) must **explicitly rebuild the engine-body** for the active lane after `kitMode` flips, or the panel won't swap until re-select.
- **Everything else stays in both modes:** the static **drum-master strip** (`#drum-master-knobs` — `DRUM VOL/PAN/REV/DLY/LO/MID/HI`, mounted by `wireDrumMasterUI`) and the **drum-grid** step editor. The note-FX panel stays correctly skipped (the façade keeps `id: 'drums-machine'`).
- **🎲 rewire (review finding):** the 🎲 `#drums-random-sound` today calls `drums.listKits()` + `loadKitDefaults` directly ([randomize-ui.ts:33-42](../../../src/core/randomize-ui.ts)) — synth-only, bypassing `kitMode`. Re-point it to pick a random entry from `drum-kits.json` and apply it through the §2b orchestrator so it can select sample kits and set `kitMode`.

**No engine selector, no page change.**

## Testing

1. **Pure (façade routing):** with injected doubles, `kitMode='synth'` forwards `params`/`getBaseValue`/`getRackLayout`/`getDrumVoiceMute` to the synth path; `kitMode='sample'` forwards them to the embedded sampler. `setKeymap/getKeymap/setPadStore/getPadStore` forward to `this.sampler` in both modes.
2. **applyPreset instance-less:** `applyPreset('TR-808 (samples)')` with NO prior `createVoice` sets `kitMode='sample'` + mirrors `drumkitId` (does not early-return). `applyPreset('TR-909')` → `kitMode='synth'`.
3. **Back-compat:** `applyPreset('KIT Power')` and `applyPreset('KIT Standard')` (legacy GM names from `drums-machine.json` / `drumFallback`) still resolve to a synth kit (`loadKitDefaults`). `drums-machine.json` keeps ≥ 8 presets (`preset-sanity.test.ts`).
4. **Preset JSON + loader:** load/validate `drum-kits.json` (kind ∈ {synth,sample}; matching id present). The drums dropdown is non-empty after the loader resolves.
5. **createVoice delegation:** in sample mode `createVoice(ctx, out).trigger(GM kick note)` plays through the embedded sampler (assert against a spy/struct).
6. **DSP real:** a sample-mode drums lane renders the kit (not silence); per-pad TUNE on the kick is independent of the snare — relative assertions.
7. **Persistence round-trip:** a session with a sample kit restores `kitMode='sample'`, and **the embedded sampler ends up with the restored keymap + padStore (and `reloadDrumkit` fired once)** — not merely `kitMode='sample'`. Assert the decode is not double-fired.
8. **Browser smoke (controller):** on Drums pick "TR-808 (samples)" → the grid plays the sampled kit and the inspector body swaps to the full sampler UI **immediately** (panel rebuild on flip); tweak a pad; 🎲 can land on a sample kit; pick "TR-909" → back to synth; save/reload keeps the kit + edits.

## Risk / blast radius

- **Façade forwarding completeness is load-bearing for persistence.** If `setKeymap`/`setPadStore`/`setDrumVoiceMutes` aren't forwarded, the existing feature-detected restore silently skips and a sample kit reloads mute/default. Covered by §1 + Testing 7.
- **Single decode owner on load.** The recalled `applyPreset` must not decode (only the `drumkitId` self-heal does), or sample kits decode twice and race. Covered by §5.
- **Host-wiring forwarding + silent fx failure.** `setSharedFx` must forward to the eager embedded sampler before its first `createVoice`; a null `fx` drops the per-pad sends *silently* (no throw). Covered by §1 + a wiring assertion mirroring `lane-allocator.test.ts`'s ordering test.
- **Inspector body does not auto-rebuild on preset apply.** `refreshLaneKnobs` ≠ `buildParamUI`; the orchestrator must rebuild the engine-body on `kitMode` flip or the panel swap (Goal 4) silently fails until re-select. Covered by §6 + Testing 8.
- **Back-compat for GM/MIDI names.** Keep `drums-machine.json` + the GM lookup; `applyPreset` resolves unified → legacy. Covered by §2 + Testing 3.
- **`params` becomes mode-dependent:** the automation registry + rack must re-render when the mode flips (the orchestrator's body rebuild handles this).
- **drum-grid voice rows:** confirm the drum-grid editor for a `drums-machine` lane shows the right rows when the embedded sampler holds the kit (kits map to the same GM voices, so the existing 8-voice grid applies).
- **Two sampler instances of one class:** the standalone Poly sampler and the embedded drums sampler are independent instances — no shared mutable statics (the only singletons are the global sample store/cache, intentionally shared).
- **WAV self-heal is async:** sample kits decode on load; the grid is silent until decode completes (acceptable; mirrors the standalone sampler). Kit WAVs are gitignored, so DSP tests needing real WAVs stay environment-dependent (as `drumkit-loader.dsp.test.ts` already is).
