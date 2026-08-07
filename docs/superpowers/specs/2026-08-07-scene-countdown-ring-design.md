# Scene countdown ring — design

**Approved mockup:** [2026-08-07-scene-countdown-ring-mockup.html](2026-08-07-scene-countdown-ring-mockup.html)
(variant **A · swept sector** is the approved one; B and C are recorded there as the rejected alternatives)

## Problem

When a scene is playing and you launch another one, the switch does not happen when you
click — it happens at the end of the loop that governs the playing material. Loom computes
that instant precisely and then shows the user nothing. There is no way to know whether the
change lands in half a bar or in eight, so a performer either guesses or watches the clip
cells for a flicker.

Ableton answers this with a single circle that sweeps a sector. This spec adds the
equivalent: **one ring, in the mixer row, showing how much of the current scene is left
before the switch**.

## What it shows

A 40 px swept sector — a filled wedge growing clockwise from 12 o'clock — plus a numeric
centre and a one-line caption underneath. Four states:

| State | Wedge | Centre | Caption |
| --- | --- | --- | --- |
| Nothing playing | empty track, no wedge | *(blank)* | *(blank)* |
| Playing, nothing queued | grey, fills across the loop | current bar of the loop (1…N) | active scene name, dim |
| A switch is queued | **amber**, drains to zero | bars left; under one bar, beats left | `→ <target>`, amber |
| Last bar before the switch | **red**, drains to zero | beats left | `→ <target>`, red |

The ring sweeps continuously while anything plays, not only when a switch is pending: that
idle sweep is the scene's pulse and it tells the user where the next possible switch point
is *before* they commit to one.

No blinking. The colour change to red is the whole alert — a blinking element sitting next
to the VU meters is visual noise in a row that is already busy.

Colours come from the existing tokens: `--text-faint` (idle), `--amber` (queued),
`--red` (imminent). The wedge is drawn at 45 % opacity so the centre number stays readable
over it.

## Where the number comes from

The switch instant already exists in the engine. Nothing new is computed and, crucially,
nothing is mirrored — the ring reads the same state the scheduler acts on, so the drawing
cannot contradict the audio.

**Queued** — `launchScene` writes the shared switch instant `T` into every affected lane's
`lp.queuedBoundary` ([session-runtime.ts](../../../src/session/session-runtime.ts)), and
`launchClip` writes that lane's own next loop end into the same field. The ring takes the
**smallest `queuedBoundary` among lanes that have something queued** — which is why a lone
clip launch is covered for free, with no extra branch.

**Idle** — `governingLoopSec()`
([launch-timing.ts](../../../src/core/launch-timing.ts)) over the loop lengths of every
playing clip gives the governing loop; the phase is `(now - lp.loopStartedAt) / loopSec`
for a lane whose loop equals the governing one.

`governingLoopSec` is not "the longest clip": it sorts the lengths descending and, while
the largest is more than 2× the next, drops it. A single 32-bar audio stem among 4-bar
clips does **not** govern. The ring inherits that rule by calling the function rather than
re-deriving it — a ring that showed the plain maximum would count down to an instant the
scheduler never uses.

**Caption target** — `SessionHost` records the label at the launch site
(`launchSceneAt` stores the scene name, the clip launch stores the clip name) as a
`{ label, boundary }` record. It is honoured only while `boundary` is still the pending
one, so it expires itself the moment the switch lands and no stop/seek/undo seam has to
remember to clear it. One owner, and no heuristic that guesses "scene or clip?" from how
many lanes happen to be queued — a one-lane scene would be captioned with a clip's name.

In the idle state the caption is `activeScene()?.name`. Note `activeSceneIdx` is advanced
at *launch* time, not at the boundary, so during a countdown it already names the
destination — which is exactly what the caption needs in both states.

## Modules

Two files, following the split the VU meter already uses (pure logic + dumb imperative
widget):

**`src/core/scene-countdown.ts`** — pure, no DOM, no `AudioContext`:

```ts
export type CountdownState = 'silent' | 'idle' | 'armed' | 'imminent';

export interface SceneCountdown {
  state: CountdownState;
  /** 0..1. Fraction of the wedge to fill: elapsed when idle, REMAINING when armed. */
  frac: number;
  /** Bars in the governing loop — the denominator behind the centre number. */
  bars: number;
  /** Seconds until the switch; null when nothing is queued. */
  secsLeft: number | null;
  /** Pre-formatted centre reading. Produced here, not in the widget, so the
   *  beats-per-bar count follows the session meter and stays under test. */
  centerText: string;
}

export function sceneCountdown(
  laneStates: Map<string, LanePlayState>,
  now: number, bpm: number, meter: TimeSignature,
): SceneCountdown;
```

`imminent` is `secsLeft <= one bar` at the current bpm/meter.

`bars` is not necessarily an integer — a clip may loop over a fractional number of bars.
The centre number rounds **up** (`Math.ceil`), so a 4.5-bar loop reads 5 at the top and
counts 5·4·3·2·1; the wedge stays exact because it is driven by `frac`, not by the number.

**`src/core/scene-ring.ts`** — `createSceneRing(deps) → { el, dispose() }`. A one-shot
lit-html render of the SVG, then a shared RAF loop that mutates the wedge `d`, the centre
text and the caption imperatively — per-frame work never goes through a template diff.
The loop starts lazily on the first ring and stops when the last one is disposed, exactly
like `registerMeter` in [level-meter.ts](../../../src/core/level-meter.ts).

`deps` is `{ laneStates, ctx, seq, activeSceneName(), queuedLabel() }` — everything
`SessionHost` already holds.

## Mounting

Inside `buildMasterStrip` ([master-strip.ts](../../../src/core/master-strip.ts)), inline
with the `MASTER` label: a flex row of `[ring][MASTER]`. The handle is passed to
`registerDisposable`, so `renderWithMixer` tears the ring down with the VU meters and
nothing leaks across the re-renders that every play-state change triggers.

The master strip is deliberately aligned pixel-for-pixel with the lane columns, so the
ring must not make that column taller on its own. `.mix-col .mix-name` therefore goes from
`height: 22px` to `40px` in **every** mixer column; lane columns centre their label in that
space. Cost: the mixer row grows 18 px. No grid-template change, no column steals width
from a lane.

`buildMasterStrip` gains the ring deps as optional fields: test fixtures without audio
already skip the master strip entirely, and a caller that omits them gets the strip with
no ring rather than a crash.

## Acceptance criteria

Unit tests against `sceneCountdown` (pure, one test per path — no `(or …)` alternatives):

1. No lane playing → `state: 'silent'`.
2. One lane playing, nothing queued → `state: 'idle'`, `frac` equals elapsed phase,
   `secsLeft: null`.
3. Two lanes queued to the same `T` → `state: 'armed'`, `frac` decreases as `now` advances,
   `secsLeft` matches `T - now`.
4. One lane queued (lone clip launch) → same `armed` result; the ring does not need the
   launch to have been a scene.
5. Lanes queued to *different* boundaries → the ring reports the **nearest** one.
6. Playing clips of 4, 4 and 32 bars → `bars` is 4, not 32 (the outlier rule holds through
   the ring).
7. `secsLeft` inside one bar → `state: 'imminent'`.
8. Crossing the boundary (`now > T`, lane promoted) → back to `idle` without a frame of
   stale amber.

Visual parity is an acceptance criterion, not a formality: load the real Session view,
launch a scene, launch a second one, screenshot mid-countdown and compare against the
approved mockup. "Tests green" is not done for this feature.

## Out of scope

- One ring per lane. The ask is explicitly a single ring.
- Making the ring clickable (cancel the queued switch by clicking it). Cancelling already
  has a path; adding a second one here is unasked-for surface.
- Showing the countdown anywhere but the mixer row.
