# Synth FX panel — relocate COMP+SC UI

Status: design proposed · 2026-05-29
Related: `2026-05-29-sidechain-compressor-design.md` (the source of the mechanism we're relocating)

## Goal

Move the per-lane COMP + SC ducker UI **out of the mixer column** and into a new **"FX" section inside the synth panel** of each lane. The underlying audio mechanism (`CompBlock`, `duckGain`, `sidechainTap`, `SidechainBus`, master compressor) stays exactly where it is and continues to work; only the controls relocate. The new panel is also the mount point for future per-lane effects.

## Non-goals

- Removing or replacing any DSP node. `ChannelStrip` is not touched.
- Changing the audio graph. The signal path is unchanged.
- Adding new effects right now. The panel is shaped to admit them; nothing new is wired.
- Adding a per-lane LP filter, distortion, or other novel FX in this iteration.
- Touching the master compressor UI on the FX page — it stays.

## Behaviour summary

| Surface | Before | After |
|---|---|---|
| Mixer column | EQ / SEND / COMP (6 knobs + BYP) / SC (SRC + 3 knobs) / PAN / M+S / Fader | EQ / SEND / PAN / M+S / Fader (original layout) |
| Synth panel for a lane | engine-specific knobs only | engine knobs + new "FX" section with COMP + SC controls |
| Audio graph | `input → eq → comp → makeup → level → pan → mute → duck → {dry, sends}` + `sidechainTap` off muteGain | identical |
| Automation registry ids | `mix.<trackId>.comp.thr`, `mix.<trackId>.sc.depth`, … | `<laneId>.fx.comp.thr`, `<laneId>.fx.sc.depth`, … |
| Modulator destination dropdown | COMP/SC params not shown (mix.* prefix didn't match laneId filter) | COMP/SC params shown under each lane (`<laneId>.fx.*` matches the existing filter) |

## Why move it

1. **The mixer column was too tall**: 6 stacked knobs + bypass + 4 SC controls pushed the fader off the natural eye-line.
2. **The SC SRC dropdown rendered broken** in the narrow column (radio-strip overflow because `createSelectControl` switches to radios with ≤4 options).
3. **The labels were stale and inconsistent** (BASS / POLY / DRUMS hardcoded at registration time vs. the live lane-display names "303 1", "Sub 1").
4. **Mixer is for mixing.** Per-lane creative-effect tweaking lives more naturally in the per-lane synth panel, alongside the engine's own knobs.
5. **Future-proofs the synth panel** as the home for new per-lane effects — a per-lane LP, distortion, etc., would all mount into the same "FX" section.

## Architecture

### Audio (unchanged)

`ChannelStrip` keeps everything from the sidechain-compressor work:
- `CompBlock` between EQ and level.
- `duckGain` between mute and sends.
- `sidechainTap` off muteGain.
- `SidechainBus` registration on construction.
- `setCompState` / `getCompState` / `setSidechain` / `getSidechain` API.

`MasterCompressor` on the master bus, with its panel on the FX page, stays.

No new audio nodes. No rewiring.

### UI

Two changes:

**1. `src/core/mixer.ts` reverts.** `buildMixerColumn` returns to the pre-COMP/SC layout. `buildCompSection`, `buildSidechainSection`, the local `fmtRatio` helper, and the two `appendChild` calls are deleted. Dead imports (`createSelectControl`, `DEFAULT_SIDECHAIN_STATE`, `CompState`, `SidechainState`) and the now-unused `sidechainBus` field on `MixerColumnDeps` are removed.

**2. New module `src/core/lane-fx-panel.ts`.** A single function:

```ts
export interface LaneFxPanelOpts {
  laneId: string;
  strip: ChannelStrip;
  bus: SidechainBus;
  parent: HTMLElement;
  registerKnob: (k: KnobHandle) => void;
  historyDeps?: HistoryDeps;
  lookupLabel?: (laneId: string) => string | undefined;
}

export function mountLaneFxPanel(opts: LaneFxPanelOpts): void;
```

The function clears `parent` and rebuilds:
- A `COMP` subsection (horizontal knob-row): THR / RAT / ATK / REL / KNEE / MKUP knobs + a BYP toggle.
- An `SC` subsection (horizontal knob-row): a native `<select>` for the source + DEPTH / SC ATK / SC REL knobs. The three knobs hide when the source is `off`.

The SC SRC select is a plain `<select>` (not `createSelectControl`) — avoids the radio-strip overflow seen in the mixer columns and gives consistent native-dropdown behaviour regardless of source count. The labels in the dropdown come from `opts.lookupLabel(sourceId)` when available (so they match the live lane display name "303 1" instead of the hardcoded "BASS").

Knob ids follow `<laneId>.fx.comp.<thr|rat|atk|rel|knee|mkup>` and `<laneId>.fx.sc.<depth|atk|rel>` and the SRC select id is `<laneId>.fx.sc.src`. The `<laneId>.fx.` prefix means they appear in lane `<laneId>`'s modulator destination dropdown (which filters by `${laneId}.` and excludes `.mod.`) and in the automation lane painter (which groups by first dot-segment).

### DOM mount

Three new `<div>` slots in `index.html`, one inside each synth page:
- `[data-page="303"]` (bass)
- `[data-page="poly"]` (subtractive + wavetable + fm + karplus)
- `[data-page="drums"]`

Shape:
```html
<div class="row poly-section">
  <div class="section-label">FX</div>
  <div class="lane-fx-knobs knob-row"></div>
</div>
```

The class-based selector (`.lane-fx-knobs`) avoids duplicate-id violations across three pages. `mountLaneFxPanel` queries `'.page:not([hidden]) .lane-fx-knobs'` so it always targets the slot in the currently visible page.

### Lifecycle

The lifecycle mirrors `mountSubtractiveLaneKnobs` and `mountDrumMasterLaneKnobs`:
- Boot: call `mountLaneFxPanel(activeLaneId)` for each visible page (one of the bass/poly/drums depending on which page is initially open).
- Lane switch: alongside the existing `mountSubtractiveLaneKnobs(activeLaneId)` and `mountDrumMasterLaneKnobs(active)` calls in main.ts and in the `rebuildEngineParamUI` hook, add a `mountLaneFxPanel(activeLaneId)` call. The existing `unregisterKnobsByPrefix` path already evicts stale `<laneId>.fx.*` entries on each rebuild (it strips by the lane prefix).

### Knob mount helper

`src/app/knob-mounting.ts` grows one method:
```ts
mountLaneFxPanel(laneId: string): void
```
Implementation: look up the strip via `deps.laneResources.get(laneId)?.strip`, look up the bus from a new `KnobMounterDeps.sidechainBus` field, find the active page's `.lane-fx-knobs` container, then call `mountLaneFxPanel(...)` from `lane-fx-panel.ts`.

## State and serialization

Unchanged. The strip's `comp` and `sidechain` state already round-trips through `ChannelStrip.serialize()` / `restore()`; the UI just reads and writes the same setters.

## Knob ID migration

The mixer-prefixed ids (`mix.<trackId>.comp.thr`, etc.) disappear. Any saved automation curves pointing at those ids will silently no-op on load (the registry won't resolve them). This is acceptable because:
- The mechanism only landed in the previous session; no published patterns rely on those ids.
- The new ids (`<laneId>.fx.comp.thr`, etc.) are the canonical path going forward and integrate with the per-lane modulator/automation infrastructure.

## Future FX

The synth panel's "FX" section is the mount point for any future per-lane effect:
- Per-lane LP filter — would add cutoff/Q knobs alongside COMP and SC, plus the corresponding DSP work on ChannelStrip (separate spec).
- Distortion, bitcrush, per-lane reverb send modulation, etc. — same pattern.

This iteration only relocates COMP+SC. New effects are out of scope.

## Testing strategy

- **Pure**: existing `comp-state.test.ts` and `sidechain-bus.test.ts` continue to cover the mechanism. No new pure tests required for the relocation.
- **Audio (DSP)**: unchanged — `comp-block.dsp.test.ts`, `strip-ducker.dsp.test.ts`, `master-comp.dsp.test.ts` all still pass without touching ChannelStrip.
- **UI / wiring**: a small new test in `src/core/lane-fx-panel.test.ts` constructs a fake DOM, a real ChannelStrip + bus, calls `mountLaneFxPanel`, and asserts: (a) the knobs are appended; (b) the COMP THR knob's onChange writes through to `strip.getCompState().threshold`; (c) the SC SRC dropdown's onChange writes through to `strip.getSidechain()?.source`; (d) the BYP button toggles `strip.getCompState().bypass`.
- **Manual smoke (Playwright)**: navigate to the dev URL, switch between bass/poly/drums tabs, confirm the mixer columns are short (no COMP/SC) and the synth pages show the new FX section.

## Risks

- **Stale automation curves**: described above; acceptable.
- **Lane-switch ordering**: if `mountLaneFxPanel(activeLaneId)` runs BEFORE `unregisterKnobsByPrefix(<oldLaneId>.)`, we'd double-register. Order matters — mount AFTER unregister, same as the subtractive flow already does.
- **SidechainBus subscribe leak**: not reintroduced. The new panel does not subscribe to the bus — labels are baked at mount time, and the panel rebuilds on lane switch anyway.
