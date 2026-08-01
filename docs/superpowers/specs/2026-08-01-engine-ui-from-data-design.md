# Engine UI from data — one mounting path for every engine

Status: approved design, 2026-08-01. Supersedes the "latent Subtractive UI"
entry in [REMAINING-WORK.md](../REMAINING-WORK.md), which recorded the symptom
without deciding anything.

## The problem, measured

Subtractive is the only engine whose editor scaffolding is **static markup**:
three `data-engine="subtractive"` rows holding seven empty divs and their
hardcoded titles (`index.html`), plus the prefix→div map in
`app/knob-mounting.ts:mountSubtractiveLaneKnobs`. Its *knobs* do come from the
declared spec — what is hand-written is the **layout**: which sections exist,
what they are called, what order they are in, and which of them share a line.

Every other engine builds its whole editor from `EngineParamSpec[]` through
`buildEngineParamGrid` into `.engine-mod-host`, which
`injectEngineModulatorPanel` wipes and refills on every lane switch.

Four consequences, all verified on 2026-08-01:

1. **Leaving a subtractive lane hides its rows, it does not empty them.** A
   TB-303 lane leaves 35 `.knob-label` elements on the poly page, the first 19
   of them Subtractive's. The page holds two knobs labelled "Cutoff" and the
   first in DOM order is invisible, so every e2e knob locator needs `:visible`.
2. **Two `if (engineId === 'subtractive')` branches** exist only because of
   this: `engines/engine-selector-ui.ts` and
   `session/session-host-lane-editor.ts`, plus the `remountSubtractiveLaneKnobs`
   hook that exists to repair what the branch breaks.
3. **The grid cannot express what the markup expresses.** `spec.group` is a
   bare string: it is simultaneously the group's key and its title, its order is
   the first-appearance order of the params, it carries no colour, and every
   group gets a full-width row of its own — so `OSC 1 │ OSC 2 │ SUB │ NOISE` on
   a single line is not expressible.
4. **There is no unmount contract.** `host.innerHTML = ''` drops the DOM but
   leaves the handles in the automation registry, pointing at detached nodes.
   Those zombies still reach audio, because a handle's `onChange` closure holds
   the live engine — and three surfaces (the XY pad, the MIDI control surface,
   Performance take playback) currently reach an unmounted lane *through them*.

Point 4 is why the layout work cannot go first. Today Subtractive is the
accidental exception: it only hides, so its handles stay attached and valid.
The moment it mounts into the wiped host like everyone else, it joins the
zombie case — and one of those three surfaces has no fallback at all:
`app/arrangement-playback.ts` ignores the `false` returned by
`driveKnobFromAutomation`, so a take curve for a lane whose editor was never
opened is dropped on the floor.

## Decisions taken (brainstorm, 2026-08-01)

1. **Groups are declared as a table on the engine descriptor**, not as extra
   fields repeated on every param, and not by nesting params inside groups
   (`engine.params` must stay flat — automation, modulation, presets, save and
   the dice all read it).
2. **One set of conventions for all six melodic engines**: the grouped grid's.
   Subtractive gains a 200-step drag quantisation and the declared unit suffix
   on the **four** params that are both drawn and carry a unit — `Osc1 Det`,
   `Osc2 Det` and `Detune` (`¢`) and `Tune` (`st`). The ten other unit-carrying
   specs are envelope leaves that the page does not draw at all (see `drawnBy`
   below). Its radio strips are preserved by declaring `selectStyle: 'radio'`.
   The `flat`/`grouped` fork disappears from engine pages.
3. **Total symmetry.** No engine keeps a mounting path of its own. Every
   melodic engine declares its groups; the static markup and its mount function
   are deleted, not merely bypassed.
4. **`groups` becomes part of the plugin ABI.** The SDK descriptor
   (`packages/loom-plugin-sdk/src/manifest.ts`) declares only
   `params: EngineParamSpec[]` today. Karplus already ships as an external
   plugin, so it is the proof that the symmetry is real rather than internal.

Explicitly **not** in scope: `layout: 'flat'` survives untouched for the
surfaces that are not engine pages — the drum rack, the sampler pads and the
audio-clip toolbar.

## Architecture

### The group descriptor

```ts
export interface EngineParamGroup {
  /** Key referenced by EngineParamSpec.group. */
  id: string;
  /** What the section header prints. Free of the id, so a group can be
   *  renamed without touching every param. */
  title: string;
  /** Groups sharing a row index render side by side on one line, separated by
   *  a vertical divider — how OSC 1 │ OSC 2 │ SUB │ NOISE sit today. Default:
   *  each group on its own row, in declaration order. */
  row?: number;
  /** CSS colour for this group's knob rings. A param's own `color` still wins;
   *  absent both, createKnob's amber default. */
  color?: string;
}
```

Declared on the descriptor as `groups?: EngineParamGroup[]`. **Order is the
array order** — no numeric `order` field, because two sources of truth for one
sequence is exactly the kind of thing this repo keeps having to unpick.

### Params the grid must not draw

Three classes of param are declared for automation, modulation, presets and
saves but are **drawn by a different surface**, and each is handled by its own
private rule today:

| Params | Owned by | Rule today |
|---|---|---|
| the seven mixer-strip ids | the mixer column | `isStripParamId`, inside the grid |
| Subtractive's `*.attack/decay/sustain/release/builtinEnv` | the MODULATORS panel (the ADSRs **are** those envelopes) | `ENV_LEAVES` in `mountSubtractiveLaneKnobs` |
| `poly.voices` | a hand-rolled POLY row in `WorkletLaneEngine.buildParamUI` | `skip: id.startsWith('poly.')` |

The first is already central and declarative in spirit; the other two are
per-call-site hacks that Phase 2 would otherwise have to reinvent. One field
replaces both:

```ts
/** This param is declared for automation/modulation/presets, but the editor
 *  grid does not draw it — the named surface does. Never means "nowhere":
 *  a sound param with no surface at all is a bug, not a feature. */
drawnBy?: 'mixer' | 'modulators';
```

`poly.voices` needs no flag at all: it becomes an ordinary declared group
(`{ id: 'poly', title: 'POLY', row: 0 }`), which deletes the hand-rolled POLY
scaffolding along with everything else. Folding `isStripParamId` into `drawnBy`
is the obvious follow-up but is **not** in scope here.

**Back-compatible by construction.** When `spec.group` names no declared group,
the string is used as the title and the group renders on a row of its own, in
first-appearance order: precisely today's behaviour. An engine that declares
nothing — internal or third-party — keeps working unchanged.

### The builder

`buildEngineParamGrid`'s grouped branch changes what it iterates, nothing else:
resolve each param's group, order the groups by the declared array, bucket them
by `row`, and emit one `.row.poly-section` per row containing, per group, its
`.section-label` and `.knob-row`, with a `.vert-divider` between groups that
share a row. The group colour is passed to `createKnob` through the `color`
option that already exists.

This stays a **one-shot lit render into a fragment**, as today. It is not a
`mountPanel`: the grid is rebuilt wholesale on lane switch, nothing repaints
in place, and the knobs update themselves imperatively — a per-frame re-render
would drop pointer capture mid-drag. lit-html's role here is exactly what it is
already: printing the scaffolding. No lit-html extension is needed or wanted.

### The mounting path, after

One path: `injectEngineModulatorPanel` → `engine.buildParamUI(host)` → the grid.

Deleted: `mountSubtractiveLaneKnobs`, `remountSubtractiveLaneKnobs` and its dep
plumbing, the seven `#poly-*-knobs` divs and the three `data-engine` rows in
`index.html`, the AMP-section hide hack, both `display:none` sweeps over
`[data-engine="subtractive"]`, the `if (engineId === 'subtractive')` in
`rebuildEngineParamUI`, the **third** such branch —
`if (this.id !== 'subtractive')` at `engines/worklet-lane-engine.ts:413`, which
is what stops the generic grid from running for this one engine — and the
hand-rolled POLY row above it.

### The unmount contract

A precondition, not a bonus:

1. **`arrangement-playback` gets the fallback it never had** — the same
   `applyUnmounted` / `getTargetRanges` pair `automation-tick` already uses, so
   a take curve lands on the audio object when no knob is mounted.
2. **A mount transaction in `injectEngineModulatorPanel`**: collect the ids
   registered during the call (engine params, note FX, and the inserts, which
   mount inside the same host) and delete exactly those before the next wipe.
   **Never by lane prefix** — `<laneId>.bus.*` is the mixer column, mounted
   elsewhere and still on screen.
3. Only then can `unregisterKnobsByPrefix` leave `rebuildEngineParamUI`. It is
   its own step with its own test, because today that prefix hammer deletes the
   *new* lane's mixer knobs on every lane switch and they survive purely because
   `showLaneEditor` calls `renderWithMixer()` afterwards. That ordering is
   currently luck, and a test must pin it before anything moves.

## Sequencing

| Phase | Content | Visible change |
|---|---|---|
| 0 | Take-curve fallback + mount transaction | none |
| 1 | `EngineParamGroup`, descriptor field, `drawnBy`, grid rendering, fallback for undeclared groups | none (nobody declares yet) |
| 2 | Subtractive declares its groups; static markup and its mount path deleted | the poly page, as agreed |
| 3 | The other five declare theirs — FM keeps `op1…opN`; TB-303, Wavetable, Westcoast and Karplus group by their param prefixes | five pages gain sections |
| 4 | `groups` into the plugin SDK manifest; `unregisterKnobsByPrefix` out of the swap path | none |

Each phase is green and committable on its own.

## Verification

**One test per user path — no `(or …)` alternatives.**

Unit (jsdom, no browser):

- group order follows the declared array, not param order;
- two groups sharing `row` render on one row with a divider between them;
- a group colour reaches the knob, and a param's own colour still wins;
- a `spec.group` naming no declared group falls back to today's behaviour;
- a param marked `drawnBy` is absent from the grid but **still** present in
  `engine.params`, in the destination catalogue and in a saved session;
- a declared group whose every param is `drawnBy` elsewhere renders no header;
- opening lane A (fm) then lane B leaves no `fm-1.op1.ratio` in the registry
  but **keeps** `fm-1.bus.level`;
- a take curve on an unmounted param reaches the engine;
- an XY-pad write on an unmounted param reaches the engine **and** the
  `engineState` mirror;
- a MIDI-surface write likewise;
- the poly page contains no `[data-engine="subtractive"]` node.

**Visual parity is an acceptance criterion.** Before Phase 2, screenshot the
poly page on `main` for each of the six engines and commit the images next to
this spec — the current page *is* the approved mockup, so it must become a
committed artifact like any other. After Phase 3, compare side by side. Any
difference that is not one of the three agreed convention shifts (unit suffix,
quantised drag, radio strips) is a defect, not a detail.

**e2e**: the suite must pass without any locator depending on a duplicate
"Cutoff" existing — the duplicate is gone.

## Rejected alternatives

- **Extend lit-html.** There is nothing to extend. lit already prints these
  rows for the other five engines; the knobs are imperative by design. The gap
  is a data model, not a templating one.
- **Keep Subtractive pixel-identical by declaring per-group exceptions**
  (`hideUnits`, `quantise: false`). That writes the fork down as data instead
  of removing it.
- **Give Subtractive's dense conventions to the other five.** Changes five
  pages instead of one, for no gain.
- **Unregister by lane prefix on unmount.** Kills the mixer-strip knobs, which
  are mounted elsewhere and visible. This is the same too-wide hammer behind the
  frozen-modulation-rings bug.

## Risks to check while implementing

- **FM's `Algorithm`** is `selectStyle: 'dropdown'` and must stay a dropdown;
  the unified conventions must not turn it into a radio strip.
- **The AMP section is empty on purpose** — the amp/filter envelopes live in the
  MODULATORS panel, and `mountSubtractiveLaneKnobs` hides the orphan header at
  runtime. With `drawnBy: 'modulators'` on those leaves, AMP simply must not be
  declared as a group; a declared group whose params are all drawn elsewhere
  must render nothing rather than an empty header.
- **`spec.group` is currently a title.** FM declares `OP1`…`OP4`
  (`engines/fm.ts:32`) and they are printed verbatim as section labels. Phase 3
  turns those into ids with separate titles; nothing else may read `spec.group`
  as display text in the meantime.
- **Karplus is loaded at runtime**, so its groups arrive through the plugin
  manifest, not the build-time glob. Phase 3 cannot be called done by looking at
  `src/` alone.
