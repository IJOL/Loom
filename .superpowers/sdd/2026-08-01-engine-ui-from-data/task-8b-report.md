# Task 8b report — one rule for every discrete control

## Decision: `selectStyle: 'radio'` removed from the type (not kept as a no-op)

`'radio'` used to be the opt-in that switched a discrete param from the
grouped grid's knob branch to a select control. That branch is now deleted —
every discrete param is a select control by default — so `'radio'` had
nothing left to mean. Keeping it in the type as an accepted-but-ignored value
would invite a future contributor to write `selectStyle: 'radio'` believing
it does something. I removed it from `EngineParamSpec.selectStyle` (now
`'dropdown' | undefined`) and deleted its four usages in
`src/engines/subtractive-params.ts` (Osc1 Wave, Osc2 Wave, Filter Model,
Filter Type) — those params keep rendering exactly as before (Osc waves have
5 options so they were already native selects; Filter Model/Type have ≤4 so
they were already strips), because the default now covers what `'radio'`
used to force.

## Files changed

- `src/engines/engine-params.ts` — `selectStyle?: 'dropdown'` (was
  `'radio' | 'dropdown'`); doc comment states the three-way rule and that it
  covers every surface including the FX rack.
- `src/engines/subtractive-params.ts` — dropped the 4 now-meaningless
  `selectStyle: 'radio'` declarations.
- `src/engines/engine-param-grid.ts` — `buildControl`'s discrete branch is no
  longer gated on `flat || selectStyle === 'dropdown' || selectStyle ===
  'radio'`; it's just `if (discrete)`. The knob branch's discrete-specific
  code (`step: discrete ? 1 : …`, the discrete `format`) is deleted — a knob
  is only ever built for a continuous param now. Header comment and
  `BuildGridOpts.layout` doc rewritten: the discrete rule is stated once,
  applies to both layouts and the FX rack, and the stale "the subtractive
  page" line (a flat-layout consumer, no longer true since the previous
  task's refactor put Subtractive on the grouped grid) is gone from both the
  file header and the `layout` doc comment.
- `src/core/select-control.ts` — doc header updated: "horizontal radio strip"
  → "vertical radio strip, sized to match a knob's footprint (~50px)"; notes
  this is the one rule for every surface including the FX rack.
- `src/styles/_knob.scss` — `.radio-strip`: `flex-direction: column`, fixed
  `width: 50px`. `.radio-btn`: `height: 15px`, `width: 100%` (was
  `min-width: 28px; height: 22px`, no direction = row), gap reduced to `1px`,
  font-size 10px → 9px, horizontal padding 6px → 4px (kept inside the 50px
  strip with border/padding).
- `src/session/lane-insert-ui.ts` — `buildUnitWidgets`'s discrete branch no
  longer hand-rolls `<select class="insert-sel">`; it calls
  `createSelectControl` (same import used by `engine-param-grid.ts`) with the
  spec's real `options`/`value`s (previously the hand-rolled version ignored
  `opt.value` and used the array index as the DOM value — functionally
  equivalent since it only ever read `sel.selectedIndex` back, but now it
  goes through the exact same code path everyone else does). The returned
  element gets `.insert-sel` (spacing only now, see CSS below) and a `title`
  for the tooltip the old inline attribute gave it. `UnitWidgets.discretes`
  type changed from `HTMLSelectElement[]` to `HTMLElement[]` since the
  control may now be a `.radio-strip` div.
- `src/styles/_fx.scss` — `.insert-sel` split: the bare class now only
  contributes `margin-left: 2px` (works for either element the builder
  returns); the full themed look (fx-color text, border, padding) moved to
  `select.insert-sel` so it doesn't collide with `.radio-strip`'s own compact
  chrome when the control is a strip instead of a `<select>`.
- `src/session/engine-param-persistence.test.ts` — fixed the stale comment
  naming the deleted `knob-mounting.mountSubtractiveLaneKnobs`.
- Tests: `src/engines/engine-param-grid.test.ts`,
  `src/core/select-control.test.ts`, `src/session/lane-insert-ui.test.ts` —
  see below.

## The six required tests

1. **≤4 options → strip, not knob, both layouts** —
   `engine-param-grid.test.ts`: "renders a discrete spec with ≤4 options and
   no selectStyle as a radio strip, not a knob (grouped layout)" (new,
   replaces the old grouped "…renders as a knob" test) +
   "layout:'flat' > renders a discrete spec with no selectStyle as a select
   control, not a knob" (pre-existing, still correct under the new rule).
2. **>4 options → native select, both layouts** —
   `engine-param-grid.test.ts`: new grouped test + new flat test
   ("renders a discrete spec with >4 options as a native `<select>`, not a
   knob or a strip").
3. **`selectStyle: 'dropdown'` forces select at any count** —
   `engine-param-grid.test.ts`: "selectStyle: 'dropdown' forces a native
   `<select>` even at 2 options (grouped layout)" (new) + the pre-existing
   flat dropdown test.
4. **The strip is `flex-direction: column`** —
   `select-control.test.ts`, new `describe('.radio-strip layout (CSS, read
   from the stylesheet)')`. jsdom runs no layout engine, so this reads
   `src/styles/_knob.scss`'s source text directly (same `scssBlock` pattern
   already used in `src/core/lane-fx-panel.test.ts`) and regex-matches the
   `.radio-strip` rule for `flex-direction: column`. Two more tests in the
   same block pin `width: 50px` and `.radio-btn`'s `height: 15px` from the
   same source — **these three are CSS-source checks, not rendered-box
   measurements; a real pixel check needs a real browser** (the
   coordinator's Chrome pass).
5. **FX insert 4-option param renders the same control as an engine 4-option
   param** — `lane-insert-ui.test.ts`, new `describe('buildLaneInsertUI —
   the FX rack obeys the one select-control rule')`. Bumped the test
   plugin's `mode` param from 3 to 4 options (A/B/C/D, `MODE_OPTIONS`
   constant) so the option count matches the brief's boundary exactly. One
   test asserts the insert rack draws `.insert-unit-head .radio-strip` and
   no `<select>`/`.knob`; a second builds the identical-shape discrete spec
   through `buildEngineParamGrid` in both layouts and asserts all three
   paths produce `.radio-strip`.
6. **No discrete param anywhere produces a `.knob`** —
   `engine-param-grid.test.ts`: "no discrete param, at any option count or
   selectStyle, ever produces a .knob element — grouped or flat" walks 2, 3,
   5-option and dropdown specs through both layouts. Combined with test 5's
   assertion that the FX rack's `.insert-unit-head` has no `.knob`, this
   covers all three render paths.

## Test output

Before implementation (all 8 touched/new tests failing for the right
reason — old knob branch and old horizontal/22px CSS still in place):

```
 × buildLaneInsertUI — the FX rack obeys the one select-control rule > a 4-option FX insert param renders a .radio-strip, not a hand-rolled <select>
    AssertionError: expected null not to be null   (queried .insert-unit-head .radio-strip — old code built a plain <select>)
 × buildLaneInsertUI — the FX rack obeys the one select-control rule > renders the same control (.radio-strip) as an engine param of the identical 4-option shape
    AssertionError: expected null not to be null
 × buildEngineParamGrid > renders a discrete spec with ≤4 options and no selectStyle as a radio strip, not a knob (grouped layout)
    (old grouped branch drew a knob — .radio-strip absent)
 × buildEngineParamGrid > renders a discrete spec with >4 options and no selectStyle as a native <select>, not a knob (grouped layout)
 × buildEngineParamGrid > no discrete param, at any option count or selectStyle, ever produces a .knob element — grouped or flat
    (layout grouped drew a knob for the plain 3-option spec)
 × .radio-strip layout (CSS, read from the stylesheet) > stacks vertically: flex-direction: column
    AssertionError: expected '.radio-strip {\n  display: inline-fle…' to match /flex-direction:\s*column/
 × .radio-strip layout (CSS, read from the stylesheet) > is ~50px wide, matching a default knob so a mixed row aligns
    AssertionError: — .radio-strip had no width declared
 × .radio-strip layout (CSS, read from the stylesheet) > .radio-btn is ~15px tall, so a 4-option strip stays under a 68px knob
    AssertionError: expected '.radio-btn {\n  display: inline-flex;…' to match /height:\s*15px/ (was 22px)

 Test Files  3 failed (3)
      Tests  8 failed | 31 passed (39)
```

After implementation:

```
 RUN  v3.2.4
 ✓ src/session/engine-param-persistence.test.ts (5 tests) 152ms
 ✓ src/session/lane-insert-ui.test.ts (11 tests) 123ms
 ✓ src/engines/engine-param-grid.test.ts (22 tests) 100ms
 ✓ src/engines/subtractive-layout.test.ts (4 tests) 3ms
 ✓ src/core/select-control.test.ts (6 tests) 3ms

 Test Files  5 passed (5)
      Tests  48 passed (48)
   Duration  6.97s
```

Broader sanity pass (not in the required gate list, run anyway since
`buildControl`/`buildEngineParamGrid` are shared by every worklet-lane page —
`worklet-lane-engine.test.ts`, `lane-editor-mount.test.ts`,
`session-inspector-registerknob.test.ts`, `session-host-lane-editor.test.ts`,
`clip-editor-router-registerknob.test.ts`, `voice-mod-binding.test.ts`,
`modulation-ui*.test.ts`, `sampler-editor-ui.test.ts`,
`refresh-lane-knobs-mirror.test.ts`, `performance-automation-mirror.test.ts`,
`engine-selector-ui.test.ts`, `lane-allocator.test.ts`): **109/109 passed.**

`npx tsc --noEmit`: clean, no output.

`mcp__gitnexus__detect_changes({scope:'all'})`: `risk_level: "high"` —
expected and correct: `buildControl`/`buildEngineParamGrid` are the shared
builder every worklet-lane engine page routes through, so touching them is
by design a wide blast radius (that is the entire point of "one rule for
every discrete control"). The affected-process names it lists
(`MountSubtractiveLaneKnobs → …`) reference a function deleted in an earlier
task in this same plan — a stale index label, not a real dependency (the
project's own GitNexus notes flag "index stale" as cosmetic).

## Numbers ended up with

- Knob: unchanged, 40px SVG + label + value text ≈ 68px tall (per brief,
  unverified independently — not part of this task's changes).
- `.radio-strip`: `width: 50px` (fixed, matching `createKnob`'s own
  footprint), `flex-direction: column`, `gap: 1px`, `padding: 1px`,
  `border: 1px solid`.
- `.radio-btn`: `height: 15px`, `width: 100%` (fills the strip), no
  horizontal gap between buttons other than the 1px inter-button gap.
- **Computed heights** (declared CSS, arithmetic — NOT a jsdom-measured
  render; jsdom has no layout engine, so this is a hand computation from the
  declared values, cross-checked against the brief's own table):
  `N*15 + (N-1)*1(gap) + 2*1(padding) + 2*1(border)` → N=2: 35px, N=3: 51px,
  N=4: 67px. All comfortably under the knob's 68px, satisfying the
  verification criterion ("height ≤ a knob's for ≤4 options"). These are
  **not** identical to the brief's own worked table (32/47/62 for a 15px
  button) because the brief's formula implicitly assumed a different
  padding/border/gap allocation; I picked concrete values that reproduce a
  vertical, bordered, gapped strip and checked the arithmetic myself rather
  than trusting the brief's numbers, per the brief's own instruction to
  verify. The real per-pixel render is unverified in this task — it needs a
  browser, which is the coordinator's job.

## Params whose appearance changes

Per the brief's own "Scope of visible change," now implemented:

- **Westcoast** (6 params): `osc.mainWave` (3→strip), `osc.modWave`
  (2→strip), `osc.subDiv` (4→strip), `lpg.mode` (3→strip), `contour.mode`
  (2→strip), `contour.cycle` (2→strip) — all were knobs, now vertical
  strips.
- **Wavetable** (3 params): `osc.waveA` (8→native select), `osc.waveB`
  (8→native select), `amp.builtinEnv` (2→strip) — waveA/B were knobs (a
  rotary through 8 waveforms), now dropdowns; builtinEnv was a knob, now a
  strip.
- **TB-303** (1 param): `osc.wave` (2→strip) — was a knob, now a strip.
- **FX insert rack**: Reverb `type` (4→strip), Multifilter `type`
  (4→strip), Tremolo `shape` (4→strip) — were hand-rolled inline
  `<select>`s in the unit header, now vertical strips (taller than the old
  one-line mini-select; the header row will grow to accommodate them — this
  is the deliberate cost the brief calls out). Delay `sync` (7→native
  select) and Tremolo `sync` (7→native select) keep rendering as selects,
  now via `createSelectControl` instead of the hand-rolled version (visually
  near-identical, un-themed by fx-color unless the `select.insert-sel` CSS
  rule matches, which it does).
- **Subtractive** (4 params, no visible change): Osc1/Osc2 Wave (5 options,
  already native selects), Filter Model/Type (≤4, already strips) — the
  removed `selectStyle: 'radio'` was already a no-op for these once
  Subtractive moved to the grouped grid in the prior task's fix round.
- **Drums/Sampler CHOKE and everything already using `selectStyle:
  'dropdown'`**: unchanged (still forced selects).
- **Every existing ≤4-option strip everywhere else in the app** (LFO/OSC
  waveform strips, drum WAVE, etc.): re-oriented from horizontal to
  vertical, same option sets, same width class change (`.radio-btn` height
  22px→15px). Not itemized individually — this is the CSS-level
  reorientation the brief describes as automatic, not a per-param decision.

## Concerns / things the coordinator should check in Chrome

- The FX insert header (`.insert-unit-head`) is a `display:flex;
  align-items:center` row; a 4-option strip is now ~67px tall sitting next
  to single-line text (dot + plugin name). This will visually stretch that
  row far taller than before for Reverb/Multifilter/Tremolo. The brief
  explicitly anticipates and accepts this ("Reverb / Multifilter / Tremolo
  gain strips … this is deliberate"), so I did not redesign the header
  layout to compensate — I judged that "resolvable" rather than "BLOCKED",
  since nothing is broken, only taller. Worth a look to confirm it reads
  acceptably, not just functions.
- The `.radio-btn` glyph SVGs (sine/triangle/square/saw shapes, 24×14px)
  now render inside a 15px-tall, ~38-46px-wide button — tighter than before
  but should still fit; worth a visual spot-check on an OSC waveform strip.
