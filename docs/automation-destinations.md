# Automation destinations — one catalogue, one rule

## The rule

Anything that lists parameters a user can target — a modulation dropdown, an
automation picker, an XY pad axis, a MIDI mapping — calls
[`DestinationRegistry.list()`](../src/automation/destination-registry.ts) and
`subscribe()` to stay fresh.

**Never enumerate the knob registry. Never build a parallel list.** That is
how four inconsistent pickers happened once already (fixed starting `61b516c`,
`acb3657`, continued through this branch's `1ef32b4`, `08df684`, `b897486`).

```ts
import type { DestinationRegistry } from '../automation/destination-registry';

function renderMyPicker(container: HTMLElement, destinations: DestinationRegistry) {
  const targets = destinations.list();     // every destination the session declares, right now
  // ...build the dropdown from targets...
  const off = destinations.subscribe(() => renderMyPicker(container, destinations));
  // bind `off` to the panel's lifetime — see "Subscription teardown" below
}
```

## Why the knob registry is the wrong source

The knob registry (`Map<string, KnobHandle>`) only contains an entry once its
panel has been mounted, and — except for the engine-swap prefix purge —
entries never leave. Two concrete bugs came from reading it as a catalogue:

- **Missed destinations**: an insert's params only entered the registry when
  that lane's editor panel was opened, so a fresh insert never showed up as a
  destination until someone clicked into it.
- **Ghost destinations**: loading a save left the *previous* session's knob
  ids in the registry, so the picker listed instruments that no longer exist.

The catalogue instead derives from `SessionState` (the lanes and inserts that
exist) plus each engine's and plugin's *declared* param specs
(`EngineParamSpec[]` / `manifest.params`) — see
[`listAutomationTargets`](../src/automation/automation-targets.ts). That is
correct regardless of what happens to be on screen. The knob registry is
still consulted, but only to *label* a target: if a knob for that id happens
to be mounted, its live label/min/max win, because that is what the user
currently sees.

## The id format

Canonical id, defined in [`AutomationTarget.id`](../src/automation/automation-targets.ts):

- Engine param: `<laneId>.<param>` — e.g. `poly1.filter.cutoff` (lane `poly1`,
  Subtractive's `filter.cutoff` param).
- Insert param: `<scopeId>.fx:<slotId>.<param>` — e.g.
  `poly1.fx:slot-a.drive` (an insert in slot `slot-a` on lane `poly1`).
  `scopeId` is one of:
  - a lane id (`poly1`) — the lane's own insert chain,
  - `fx.master` — the master insert rack,
  - `fx.send.<id>` — a send-bus insert rack (e.g. `fx.send.A`).

**Position is never identity.** An insert is addressed by its stable
`InsertSlot.id` (`slot-a`), never by its index in the chain array. Addressing
by index meant deleting one insert silently repointed every modulation
connection aimed at its neighbours onto the wrong slot.

[`parseAutomationParamId`](../src/automation/automation-apply.ts) finds the
insert by looking for the first segment that literally starts with `fx:`. It
returns `null` only for an id with fewer than two segments; there is no explicit
rejection of the old positional shape. A legacy `poly1.fx2.drive` therefore
parses as an *engine* param whose local id happens to be `fx2.drive`.

The write is still dropped, but downstream and for a different reason:
`applyAutomationToSession` bails when `deps.getRange(id)` returns nothing, and
no declared spec answers for `fx2.drive`. So a stale id fails silently rather
than visibly, and nothing pins that behaviour — there is no test for the `fx2`
shape. If you want the failure to be loud, that needs an explicit reject for a
segment matching `/^fx\d+$/`, plus a test.

## The change signal

Mutation sites call `invalidate()`; they don't know or care who's listening.
Consumers call `subscribe()`. Call sites (see the `Drives
DestinationRegistry.invalidate()` comments at each):

- lane **add** — [`src/app/lane-allocator.ts:257`](../src/app/lane-allocator.ts), in `ensureLaneResource`
- engine swap — same file, line 303
- lane **delete** — [`src/session/session-host-callbacks.ts:344`](../src/session/session-host-callbacks.ts). A separate site because `deleteLane`/`dispose` bypass `ensureLaneResource` and `swapLaneEngine` entirely; the comment there says so.
- insert add/remove on a lane — [`src/session/lane-insert-ui.ts`](../src/session/lane-insert-ui.ts) (lines 120 and 215)
- insert add/remove on master/send racks — [`src/core/fx-ui.ts`](../src/core/fx-ui.ts), which threads the same callback into the same builder
- session **load** / state swap — [`src/session/session-host-persistence.ts:137`](../src/session/session-host-persistence.ts). One announcement after the whole lane + insert set has been rewritten, because `rehydrateInsertChain` mutates chains directly and bypasses the UI's own hook.

The destination *set* only changes for structural reasons like these.
**Presets, drum kits, and sampler keymaps do NOT change it** — engine param
specs are static, declared once per engine, independent of which preset is
currently applied.

## Subscription teardown: bind it to the panel's lifetime

This codebase rebuilds panels by wiping their host (`container.innerHTML =
''` appears in over twenty non-test files) and re-rendering. That destroys DOM but not a
JS closure a previous render registered with `subscribe()` — so an
unconditional `subscribe()` on every render call leaks a listener per
rebuild, and each leaked listener triggers its own redundant redraw on the
next `invalidate()`.

Bind every subscription to the panel's own lifetime, releasing the previous one
whenever the panel is rebuilt. There are two accepted idioms, and which one you
want depends on how the panel is mounted:

- **Rendered through `mountPanel`** — register the subscription in the handle's
  cleanup slot, which drops the previous one on every render:
  [`src/modulation/modulation-ui.ts:38-49`](../src/modulation/modulation-ui.ts)
  is `handle.setCleanup(deps.destinations?.subscribe(handle.rerender))`. Exactly
  one subscription per container, so a rebuild — the caller's, or one this
  subscription itself triggered — cannot leave two listeners behind.
- **Owning raw listeners** — scope an `AbortController` to the panel and abort
  it on teardown: [`src/performance/xy-pad-ui.ts`](../src/performance/xy-pad-ui.ts)
  builds `ac` at line 73 and returns `destroy: () => ac.abort()` at line 176.

## Two traps that produce green-but-meaningless tests

1. **`listAutomationTargets` silently returns `[]` for an unregistered
   plugin id.** If a test builds a lane insert with a bare `pluginId: 'delay'`
   string but never calls `registerPlugin`, the target list for that insert
   is empty and the test can pass or fail for reasons that have nothing to do
   with what it's checking. Use a real registered plugin instead:
   [`src/automation/destination-registry.test.ts`](../src/automation/destination-registry.test.ts)
   calls `_resetRegistry()` + `registerPlugin(multifilterPlugin)` in
   `beforeEach`.

2. **`getEngine()` returns `undefined` for an engine module that was never
   imported.** Engines self-register via a side-effect import
   (`registerEngine` runs when the module body executes); a test that
   constructs a `SessionState` lane with `engineId: 'subtractive'` but never
   imports `../engines/subtractive` gets zero engine params for that lane and
   silently exercises nothing. Add the side-effect import, e.g.
   [`src/modulation/modulation-ui-dest-refresh.test.ts:23`](../src/modulation/modulation-ui-dest-refresh.test.ts):
   `import '../engines/subtractive';`.

## Known limits

- **The modulation dropdown** (`src/modulation/mod-routing-templates.ts:27-28`,
  the local `reachable`) is filtered to `t.laneId === deps.laneId ||
  t.laneId === 'fx.master'`. The per-lane binder (`voice-mod-binding.ts`)
  can only resolve this lane's own engine params, this lane's own insert
  chain, and the master chain — never another lane, never a send rack — so
  offering those destinations would create a connection that looks valid and
  silently never binds.
- **The APC device bank is 8 fixed slots with no paging**
  ([`src/control/loom-facade.ts`](../src/control/loom-facade.ts),
  `engineParamIds`). Engine params fill the 8 slots first; insert params only
  become reachable where the engine declares fewer than 8 continuous params.
  Subtractive (30), FM (31), Wavetable (9), Westcoast (15), and
  Drums-Machine (112) all meet or exceed 8, so lanes using them never surface
  an insert param on hardware. This is a deliberate scope cut, not an
  oversight — fixing it needs a paging/filtering scheme in the bank.
