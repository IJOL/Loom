# Unified FX + Send A/B — Design

**Date:** 2026-06-18
**Status:** Approved (design); pending implementation plan.

## Problem

Reverb and delay are *privileged* effects. They are hard-wired as two global send
effects in `FxBus` ([src/core/fx.ts](../../../src/core/fx.ts)), and every channel
(`ChannelStrip`) carries a fixed `reverbSend` + `delaySend` knob. This means:

- The set of send effects is frozen at exactly two, and their types are frozen
  (always reverb + delay).
- They are the **only** effects routable via a send.
- The insert model (generic `InsertChain`, already present on every lane and on
  the master) and the send model are two unrelated worlds.

There is also dead code: `FilterChain`/`MasterFilter` (a master-only LFO-synced
filter) is defined in `fx.ts` but never instantiated anywhere.

The goal is to **standardize**: a single FX-insert model usable on lanes
(including audio lanes), on the master, and on generic send buses; with reverb
and delay demoted to ordinary insertable effects living inside two preconfigured
send buses — **Send A** and **Send B**.

## Goals

1. Replace the two hard-wired sends (reverb/delay) with **two generic send buses,
   Send A and Send B**. Each is a return channel with: input gain, an
   `InsertChain`, a return level, and a mute. Seeded **A = Delay, B = Reverb**,
   but the inserts are editable.
2. Per channel, the two send knobs become **Send A / Send B** (replacing
   `REV` / `DLY`).
3. Make **any** FX insertable in **any** rack — lane (incl. audio), send, or
   master. Reverb and delay become ordinary inserts (no longer "send-only").
4. Add two new insertable dynamics plugins: **Compressor** and **Limiter**.
5. Keep the existing fixed mixer channel strip intact (level / pan / mute /
   3-band EQ / built-in comp). This is the standard DAW model and the
   lowest-churn path. "No privileged FX" is satisfied by uniform insert racks +
   generic sends, **not** by dissolving the mixer strip into inserts.

## Non-goals (v1)

- A UI to add/remove an arbitrary number of send buses (N sends). The code model
  is a generic list so this is cheap to add later, but the UI shows only A/B.
- Send → send routing, or sends on the master bus (feedback risk).
- EQ / pan on the send return channel ("simple return": level + mute + rack
  only).
- Reviving the LFO-synced master filter (`MasterFilter`) — it is dead code and
  will be removed; its sweep capability is out of scope.

## Current state (verified)

- `FxBus` owns one reverb instance + one delay instance; each has a dedicated
  input `GainNode`; both return into `master` (pre `MasterBusStrip`), so master
  EQ/inserts/comp already shape the wet returns.
- `ChannelStrip`: `input → EQ → comp → level → pan → mute → duckGain`, then
  fans out to `dry → master`, `reverbSend → fx.reverbInput`,
  `delaySend → fx.delayInput`. Sends are **post-fader** (off `duckGain`).
- Every lane gets an `InsertChain` between the engine voice and the strip
  (`ensureLaneResource` in [src/app/lane-allocator.ts](../../../src/app/lane-allocator.ts)),
  uniformly for **all** engine ids including `audio`. The master has
  `masterInsertChain`.
- `buildLaneInsertUI` ([src/session/lane-insert-ui.ts](../../../src/session/lane-insert-ui.ts))
  is the shared insert-rack UI builder; it already powers both the per-lane rack
  and the master rack (via `fx-ui.ts` `rebuildMasterInserts`). It hides reverb +
  delay from the picker via `SEND_ONLY_IN_PHASE_1` to avoid double-tail summing.
- There is **no** insertable compressor/limiter plugin. Compression exists only
  as `CompBlock` (baked into `ChannelStrip`) and `MasterCompressor`.
- `FilterChain`/`MasterFilter` is never instantiated (`new FilterChain` has zero
  call sites) → dead code.
- Per-lane mixer knob values persist via `engineState.params` keyed by knob id
  (e.g. `mix.<lane>.rev`, `mix.<lane>.dly`), through `mirrorParamChange`
  ([src/session/session-engine-state.ts](../../../src/session/session-engine-state.ts)).
  Lane + master insert slots persist as `lane.inserts` / `masterInserts`
  (`InsertSlot[]`) and rehydrate via `rehydrateInsertChain`.

## Design

### Routing

```
                       ┌──────── lane ChannelStrip (unchanged) ────────┐
voice → [lane InsertChain] → EQ→comp→level→pan→mute→duckGain ─┬─ dry ───────────────► master (sum)
                                                              ├─ sendA(gain) ─► SendBus A.input
                                                              └─ sendB(gain) ─► SendBus B.input

SendBus A:  input → [InsertChain  seed: Delay ]  → returnLevel → (mute) ─► master (sum)
SendBus B:  input → [InsertChain  seed: Reverb]  → returnLevel → (mute) ─► master (sum)

master (sum) → MasterBusStrip(EQ/pan/mute) → [master InsertChain] → MasterComp → analyser → destination
```

- Sends stay **post-fader** (off `duckGain`) → sidechain/duck behaviour preserved.
- Returns sum into `master` (pre `MasterBusStrip`), same node reverb/delay use
  today → master tone/inserts/comp shape the wet.

### Send bus model

`FxBus` (privileged-effects class) is removed. It is replaced by a small
`SendBus` class and a list held by the audio graph:

```
class SendBus {
  input: GainNode          // lanes connect their sendX gain here
  inserts: InsertChain     // seeded with one insert (delay / reverb)
  returnLevel: GainNode    // → master (sum)
  muted: boolean           // mute zeroes returnLevel
}
```

The audio graph holds `sends: SendBus[]` with exactly two entries (`A`, `B`).
`ChannelStrip` replaces its `reverbSend`/`delaySend` `GainNode`s with
`sendA`/`sendB` `GainNode`s, wired `duckGain → sendX → sends[X].input`. We do
**not** reuse `ChannelStrip` for the returns (the user chose a simple return; a
full strip would also reintroduce A→B feedback via its own sends).

The list is generic so adding Send C… later is a code-only change; the UI
intentionally surfaces only A/B in v1.

### New FX plugins

- **Compressor** — wraps the existing `CompBlock`. Params: threshold, ratio,
  attack, release, knee, makeup, bypass. Insertable in any rack.
- **Limiter** — brickwall via `DynamicsCompressorNode`: ratio 20:1, knee 0,
  attack ≈ 0. Exposed params: **Ceiling** (threshold) and **Release**.

Both register through the normal plugin SPI (`registerPlugin`) so they appear in
the insert picker, expose their `AudioParam`s as modulation/automation
destinations, and serialize as `InsertSlot`s like any other FX.

### Reverb / delay become ordinary inserts

- Remove `SEND_ONLY_IN_PHASE_1` (the reverb/delay picker exclusion). They become
  selectable inserts placeable in any rack; their default home is the Send A/B
  insert chains.
- The delay's BPM **SYNC** control (today in `fx-ui.ts`) moves to live with the
  delay insert itself.
- The reverb/delay `AudioParam`s remain modulation/automation destinations via
  the standard insert-param path (replacing the bespoke
  `FxBus.getMasterSendInstances()` hook).

### UI

- **Mixer column** ([src/core/mixer.ts](../../../src/core/mixer.ts)): the two
  SEND knobs change from `REV`/`DLY` to `A`/`B`, ids
  `mix.<lane>.sendA` / `mix.<lane>.sendB`, writing `strip.setSendA/B`. No other
  strip change.
- **FX/master page** ([src/core/fx-ui.ts](../../../src/core/fx-ui.ts)): drop the
  hard-wired reverb + delay knob rows; render two **Send A / Send B return
  modules**, each = return level + mute + insert rack (reusing
  `buildLaneInsertUI` against that send's `InsertChain`). MasterComp + master
  insert rack are unchanged.
- **Uniform insert rack on every lane, audio included**: the rack already exists
  at the DSP level per lane; ensure/confirm the rack UI is surfaced in the lane
  inspector for every lane type (audio included).
- **Remove dead code**: `FilterChain` + `MasterFilter` and the already-hidden
  static "Add Filter" button.

### Persistence & migration

New persisted shape:

```
SessionState.sends: SendBusState[]   // [{ id:'A', label, returnLevel, muted, inserts: InsertSlot[] }, { id:'B', ... }]
```

Rehydrated with `rehydrateInsertChain` (same path as lane/master inserts).
Per-channel send amounts continue to persist via
`engineState.params['mix.<lane>.sendA' | 'mix.<lane>.sendB']`.

Migration (old saves + the 4 bundled demos), in the `session-migration.ts`
normaliser (same additive pattern as `masterInserts ??= []`):

- If `sends` is absent → synthesize the two default buses: **A = Delay**,
  **B = Reverb**, seeded from default params (or from any persisted
  `fx.delay.*` / `fx.reverb.*` values if present).
- Per-lane / demo JSON: `…dly` send amount → `sendA`, `…rev` send amount →
  `sendB`.

### Defaults locked during design

- Send **A = Delay**, Send **B = Reverb**.
- Limiter = brickwall `DynamicsCompressorNode` (Ceiling + Release).
- Delete `FilterChain`/`MasterFilter`.
- Sends post-fader; returns sum pre-`MasterBusStrip`.

## Testing

Per the repo's four-layer convention; assertions **relative** (ratios), never
absolute.

- **Pure** — migration: old `sends`-less state → two seeded buses; `dly→sendA`,
  `rev→sendB`.
- **Wiring** — `lane.sendA` → `SendBus A.input` → insert → master carries
  signal; muting the return cuts it.
- **DSP real** — Compressor reduces gain on a hot input vs bypassed; Limiter
  output peak does not exceed ceiling (relative to an over-ceiling input).
- **e2e** (after `npm run build`, against `dist/`) — add a Filter insert on an
  **audio** lane; move a Reverb insert into a lane rack; raise Send A and hear
  the return.

## Acceptance criteria

1. Reverb/delay no longer special-cased in `ChannelStrip` or as `FxBus`; routed
   through Send A/B insert chains.
2. Filter, Compressor, Limiter, Reverb, Delay, Distortion are all insertable on a
   lane (incl. audio), a send, and the master, from the same picker.
3. Mixer shows Send A / Send B knobs; FX page shows two return modules with
   editable insert racks.
4. Old saves and the 4 demos load with equivalent reverb/delay behaviour after
   migration.
5. Dead `FilterChain`/`MasterFilter` removed; build + full test suite green.
