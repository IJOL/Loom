# Scene / clip launch synced to loop-end + atomic scene switch

**Date:** 2026-06-18
**Status:** Approved (design)
**Area:** `src/session/session-runtime.ts`, new `src/core/launch-timing.ts`, `src/session/session-host*`, session grid UI.

## Problem

Three reported symptoms in scene/clip launching, which the user describes as
"the same thing seen in different ways":

1. **Orphan lanes keep sounding.** Launching a scene leaves a lane playing the
   *previous* scene's clip if the new scene has no clip for that lane. Today
   [`launchScene`](../../../src/session/session-runtime.ts) simply *skips* lanes
   with no target clip — it never stops them. The lingering old-scene audio is
   perceived as "clips activate with a different scene".
2. **Premature / overlapping switch.** The switch is quantized to an *absolute
   bar grid* via `nextBoundary` (`ceil(now/quantDur)`), not to the clip's own
   loop end. A multi-bar clip launched mid-loop is cut at the next bar grid
   line, which rarely coincides with its loop point — so "the old one was still
   going and the new one came in early".
3. **General clip-activation confusion**, which is the combination of (1) and (2).

## Goal

Launching a scene becomes an **atomic change of the whole session sound at one
synchronized instant `T`**, where `T` is the **end of the loop that "governs"**
the currently-playing material — never a fixed bar grid, and never leaving
orphan lanes ringing.

## Approved behavior

### Atomic scene switch

Launching scene `S` resolves, for **every** lane:
- target cell has a clip → that clip is **queued to start at `T`**;
- lane is currently playing **and** target cell is empty → lane is **queued to
  stop at `T`**.

The resolution rule for "target cell" is unchanged (explicit
`scene.clipPerLane[laneId]` if the key exists, else the scene's row index), but
the resolver now also reports empty/`null` targets so the orphan lane can be
stopped instead of silently skipped.

### The switch instant `T`

- **Cold start** (nothing playing): use the existing quantize grid
  (`immediate` / bar) exactly as today. There is no loop to sync to.
- **Hot swap** (something already playing): `T = next loop-end of the governing
  loop`.
  - Collect every currently-playing clip with its loop length `L` (seconds, via
    `effectiveClipLoop` — the **same** math the scheduler uses in
    [`tickLane`](../../../src/core/lane-scheduler.ts), so `T` lands exactly on a
    real loop boundary) and its `loopStartedAt`.
  - **Governing loop — iterative outlier cap** (user-approved rule): sort the
    loop lengths **with duplicates** descending (multiset, NOT distinct values —
    a duplicated longest must compare against another real loop, not against a
    shorter tier); **while** the single largest element `> 2 ×` the
    next element, drop that one largest element; repeat. The largest remaining
    length is the governing length.
  - `T = loopStartedAt + ceil((now − loopStartedAt) / L) · L` for a clip whose
    length equals the governing length (its next loop-end ≥ `now`).

Worked examples (lengths in bars), which become unit tests:

| playing loop lengths | governing | why |
|---|---|---|
| `[1, 2, 4]` | `4` | `4 > 2·2`? no → keep 4 |
| `[2, 2, 4]` | `4` | `4 > 2·2`? no → keep 4 |
| `[4, 4, 1]` | `4` | `4 > 2·4`? no → keep 4 (duplicated longest; multiset, not distinct) |
| `[1, 1, 8]` | `1` | `8 > 2·1` → drop 8; `1` left |
| `[1, 2, 16]` | `2` | `16 > 2·2` → drop 16; `2 > 2·1`? no → keep 2 |
| `[1, 16, 40]` | `1` | `40 > 2·16` → drop 40; `16 > 2·1` → drop 16; `1` left |
| `[1, 2, 4, 16]` | `4` | drop 16; `4 > 2·2`? no → keep 4 |

### Single-clip launch

Launching one clip onto a lane that is **already playing** another clip: the new
clip waits for **that lane's current clip loop-end** (no outlier cap — a single
loop). Cold lane → existing quantize grid. Same "no premature entry" principle.

### Quantize selector interaction

Hot swaps **always** sync to loop-end (the fix). The quantize selector
(`globalQuantize` / per-lane / per-clip `launchQuantize`) governs **only cold
starts**. An "immediate" hot-swap escape hatch is explicitly out of scope (a
possible follow-up).

## Architecture

### New pure module: `src/core/launch-timing.ts`

All pure, no audio nodes, fully unit-testable.

```ts
// Loop length in seconds — wraps effectiveClipLoop so it equals the scheduler's
// clipDurSec exactly (T must land on a real loop boundary).
clipLoopSec(clip: SessionClip, bpm: number, meter: TimeSignature): number

// Next loop boundary >= now for a loop that started at loopStartedAt.
nextLoopEnd(loopStartedAt: number, loopSec: number, now: number): number

// Iterative outlier-cap rule over loop lengths -> the governing length.
governingLoopSec(lengths: number[]): number

// Combine: from the currently-playing loops, the synchronized switch instant.
sceneSwitchBoundary(
  playing: { loopStartedAt: number; loopSec: number }[],
  now: number,
): number
```

`governingLoopSec` operates on raw lengths (works on seconds or bars
identically, since the ratio test is scale-free) so the table above can be
asserted directly with bar numbers.

`sceneSwitchBoundary`: pick the governing length, then return the *earliest*
`nextLoopEnd` among the playing clips whose `loopSec` equals the governing length
(ties resolve to the soonest boundary so we never wait longer than necessary).

### `session-runtime.ts`

- `LanePlayState` gains `queuedStop: number | null` — runtime only, **not
  persisted** (it lives in `laneStates`, never in `SessionState`/save schema).
  Added to `emptyLanePlayState`.
- **`launchScene`** rewritten:
  1. Resolve targets for *all* lanes → `{ lane, clip }` (start) and
     `{ lane }` (stop, lane playing + empty target).
  2. If any lane is currently playing → `T = sceneSwitchBoundary(...)` over all
     currently-playing clips; else `T = nextBoundary(quantize, now, bpm)` (cold).
  3. For start lanes: `lp.queued = clip; lp.queuedBoundary = T`.
  4. For stop lanes: `lp.queuedStop = T`.
- **`launchClip`**: if the lane is currently playing, `boundary =
  nextLoopEnd(lp.loopStartedAt, clipLoopSec(currentClip), now)`; else
  `nextBoundary(effectiveQuantize, now, bpm)` (unchanged cold path).
  - `launchClipAtTime` (arrangement playback) is untouched.
- **`tickSession`**: in addition to promoting `queued → playing` at the
  boundary, when `lp.queuedStop != null && now + lookahead >= lp.queuedStop`:
  release the lane (`lp.playing = null; lp.queuedStop = null`) and call the
  silence hook (below) at `queuedStop`.

### Avoiding tail bleed past `T`

Because `T` is a loop-end, aligned material ends cleanly on its own. For
**non-aligned** loops (length that doesn't divide `T`), an audio buffer or a
long note gate can ring past `T`. So at `T`, lanes that **stop or swap** release
their live voices via the existing `LiveVoiceRegistry` silencer (the same one
`stopLane`/`stopAll` use).

- `tickSession` gains an **optional** silence hook
  `silence?: { silenceLane(laneId, atSec): void }`. When a lane is promoted to a
  new clip or stopped at the boundary, it calls `silence.silenceLane(laneId, T)`
  just before the new clip's first notes. Absent hook (tests/headless) → no-op,
  behavior identical except no live-voice cut.
- The call site in `session/session-host.ts` (the `seq.sessionTick` closure that
  drives `tickSession`) passes `deps.liveVoices`.

### Visual feedback (queued / stopping)

A hot swap can wait up to a full governing loop, so the user must see the change
is armed:
- Clips queued to start render in a **"queued" (pulsing)** state until they start
  at `T`.
- Lanes queued to stop render their currently-playing clip in a **"stopping"**
  state until `T`.

Implementation reuses any existing `lp.queued` grid styling; if none exists, add
a `.is-queued` / `.is-stopping` class driven by `LanePlayState`. Verified
against the live grid during implementation (visual parity is a check, not just
green tests).

## Data flow

```
click scene ▶
  → onLaunchScene(idx)            (session-host-callbacks)
  → launchScene(...)              resolve all lanes; compute T;
                                  set queued/queuedBoundary (start)
                                  + queuedStop (orphan stop)
  → seq.start() if stopped; render (shows queued/stopping)
  ── each ~25ms tick ──
  → tickSession(...)             promote queued→playing at T (+silence);
                                  apply queuedStop at T (release +silence);
                                  schedule notes via tickLane
```

## Edge cases

- **Nothing playing** → cold start path; no governing computation.
- **Relaunch the playing scene** → re-queues at next governing loop-end; benign.
- **Mixed phases** (clips launched individually at different `loopStartedAt`):
  `T` is the governing clip's own next loop-end; non-governing clips simply get
  cut/aligned at `T` (and silenced if they would bleed). The common
  scene-launched-together case shares `loopStartedAt` and is perfectly clean.
- **`clipDurSec <= 0`** (degenerate empty clip) → excluded from the governing
  set; if all are degenerate, fall back to `nextBoundary`.

## Bug A note ("clips activate with a different scene")

The user states this is the same perception as (1)+(2); the atomic switch +
orphan-stop should eliminate it. To guard against a *genuine* resolution drift
(e.g. explicit `clipPerLane` mappings going stale after `moveClip`/`copyClip`),
the test suite asserts **"launching scene N sounds exactly row N and silences
every other lane"**. If that test exposes a real index/mapping drift, fix it as
part of this work; otherwise no model change is made (positional + explicit
hybrid is kept).

## Testing

Pure unit (`launch-timing.test.ts`):
- `governingLoopSec` — every row of the worked-examples table.
- `nextLoopEnd` — mid-loop, exactly-on-boundary, before-start (`now < start`).
- `sceneSwitchBoundary` — single, equal-length, mixed with outlier cap.

Scheduling (`session-runtime` fake clock):
- Mixed-length scene → all lanes switch atomically at the governing `T`.
- Orphan lane (no clip in new scene) → `queuedStop` set to `T`, released at `T`.
- Giant outlier → governing `T` per the iterative rule; outlier clip cut at `T`.
- Single clip launch on a busy lane → queued at that lane's loop-end.
- Cold start (nothing playing) → uses `nextBoundary` grid.
- "Scene N sounds exactly row N, others silenced" resolution test.

Assertion style: timing equalities are deterministic (exact boundary times) —
fine to assert exactly. No absolute magnitude thresholds.

## Compatibility

No schema change. `queuedStop` is runtime-only. Save/load (`SavedStateV3`)
untouched. Safe for existing sessions and demos.

## Out of scope (possible follow-ups)

- Immediate hot-swap escape hatch.
- A user-visible "sync mode" selector (the behavior is the default).
- Any `clipPerLane` model refactor beyond a targeted fix if a test exposes drift.
