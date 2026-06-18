# Performance Diagnostics — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorming) — pending spec review → implementation plan
**Topic:** A toggleable, on-demand performance diagnostics tool (HUD + detail panel) to find and fix the root cause of audio stutter/dropouts in Loom.

## Problem

There are moments where the audio cannot keep up and stutters/breaks up, and it feels load-related. Today there is **no visibility** into engine load. The existing VU meters ([level-meter.ts](../../../src/core/level-meter.ts)) measure **signal level in dBFS**, not **occupation/load**, so they cannot explain a dropout.

Loom's playback path is all native AudioNodes (no `ScriptProcessor`/`AudioWorklet` in the signal path — the worklet is recording-only). Scheduling is a `setTimeout`-driven 25 ms look-ahead with a 120 ms window ([sequencer.ts:100-106](../../../src/core/sequencer.ts#L100-L106)). That means dropouts have **two distinct root causes** that need different fixes:

1. **Main-thread jank** — grid re-renders, GC, the RAF loops (knobs, visualizer, meters) delay the `setTimeout` tick past the 120 ms window, so notes get scheduled "in the past."
2. **Audio-thread overload** — too many simultaneous generator nodes (lanes × polyphony × FX) overrun the render quantum.

The tool's primary job is to **tell these two apart** and point at the culprit.

## Goal & scope

- **Goal:** a **diagnostic tool** — find and fix the root cause, not merely display load.
- **In scope:** four metric groups (below), a corner HUD that expands to a detail panel with per-lane voices and a dropout event log.
- **Out of scope (YAGNI):**
  - No automatic mitigation (the app never changes its own behavior/sound).
  - No cross-session persistence or export.
  - No "total node count" (the Web Audio API does not expose live node counts; we measure only what is measurable — see below).

## Hard constraints (from the user)

1. **Only active when visible.** When the HUD/panel is closed, there is **zero** instrumentation: no RAF, no node-factory wrapping, no `renderCapacity` subscription. Every seam in existing code is a dormant `if (monitor) …` branch — a boolean check that does nothing when closed. All collection is wired on open and torn down on close.
2. **Consequence (accepted):** because collection starts on open, the sparklines and dropout log cover **from the moment you open it onward**, not the past. Intended flow: *open the panel → reproduce the stutter → see it marked.*
3. **The tool must not perturb what it measures.** UI paint is throttled (~6–10 Hz), touches the DOM only when a value changes, and draws sparklines cheaply.
4. **UI text in English** (consistency with the app). Conversation/spec is Spanish.

## Metrics (exact definitions)

| Group | What | Source | Notes |
|---|---|---|---|
| **Audio load** | `averageLoad` / `peakLoad` (%) and `underrunRatio` (real audio-thread dropouts) | `AudioContext.renderCapacity` | Chrome/Edge. **Fallback:** where unsupported (Firefox/Safari today) show `n/d`; diagnosis falls back to scheduler lag + FPS. |
| **Scheduler lag** | tick delay vs. expected fire time (ms) + `sessionTick` duration (ms) | `sequencer.tick()` seam | The #1 signal of main-thread dropouts: when lag pushes the tick past the 120 ms window. |
| **FPS / main thread** | frames per second + frame time (ms) | a dedicated `requestAnimationFrame` loop | Tells whether UI is starving the scheduler. |
| **Voices & nodes** | active voices **per lane** and total; **live generator nodes** (oscillator / buffer-source / constant-source) global | trigger/`gateDuration` seam + node-factory wrap (`onended`) | Per-lane voices via the `gateDuration` already in the trigger options. Generator nodes are the CPU-heavy ones and emit `onended`; cheap gain/filter nodes are **not** counted (not measurable accurately). |

### Why generator nodes only

`AudioNode`s have no "destroyed" event in general; gains/filters are GC'd silently, so a true live-node total is not measurable. Generator sources (`OscillatorNode`, `AudioBufferSourceNode`, `ConstantSourceNode`) **do** fire `onended`, are the CPU-relevant generators, and double as a faithful global voice proxy. This is an honest, accurate-enough metric, not a faked total.

## Architecture — new isolated subsystem `src/perf/`

No existing engine **behavior** changes; only dormant seams are added.

- **`perf-monitor.ts`** — the collector. Pure class, **no DOM, no audio**: per-metric ring buffers, derived stats (avg / peak / percentile / max-lag), and the event log. This holds all the testable logic.
- **`perf-sources.ts`** — wiring of the seams: installs on open, uninstalls on close. Owns the scheduler hook registration, the voice counter, the node-factory wrap, the `renderCapacity` subscription, and the FPS RAF.
- **`perf-hud.ts`** + **`perf-panel.ts`** — the UI (corner HUD; expandable detail panel). Follows the `dispose()` discipline of [level-meter.ts](../../../src/core/level-meter.ts) — throttled paint, class-toggle-only DOM updates, RAF/listeners cleaned up on close.
- **`perf-monitor.test.ts`** — pure unit tests of the collector.

### Seams in existing code (all no-op when closed)

- [src/core/sequencer.ts](../../../src/core/sequencer.ts): an optional `onTickStats?(lagMs, tickDurMs)` callback computed in `tick()` (expected-vs-actual fire time + `performance.now()` around the `sessionTick` call). Dormant when unset.
- [src/app/trigger-dispatch.ts](../../../src/app/trigger-dispatch.ts): on trigger, increment the lane's voice count and schedule the decrement using the `gateDuration` already present in `VoiceTriggerOptions` (slide extends the gate ~1.5×; minor and acceptable for diagnosis).
- [src/main.ts](../../../src/main.ts) / [src/app/audio-graph.ts](../../../src/app/audio-graph.ts): mount the **PERF** toggle; on open, install the node-factory wrap and subscribe `renderCapacity`; on close, restore and unsubscribe.

## UI — hybrid HUD + panel, toggled by a visible button

- A **PERF** button in the transport bar toggles it on/off (a visible control matches "only active when visible"). An optional keyboard shortcut may be added **only after** verifying no collision with existing `keydown` handlers ([main.ts:639](../../../src/main.ts#L639), [performance-feature.ts:271](../../../src/app/performance-feature.ts#L271), piano-roll/drum-grid scoped keys).
- **HUD** (corner): the 4 groups as live numbers + a ~12 s mini-sparkline each + a ⚠ dropout indicator.
- Click **⤢** → **detail panel**: larger charts, a **voices-by-lane** table, and a **dropout event log** with timestamps (`late tick +31ms`, `underrun (audio)`), plus a **freeze** button.
- All labels in English.

```
HUD (corner)         click ⤢→   Detail panel
┌─ PERF ▸ ──┐                   ┌ PERFORMANCE ─────┐
│Audio 37% ▂▅│                  │ load  ▁▂▅█▅▂ 37/61%│
│Sched +4ms │                   │ voices by lane    │
│FPS 58  V12│                   │ dropout log...    │
└───────────┘                   └───────────────────┘
```

## Error handling / edge cases

- `renderCapacity` undefined → show `n/d`, keep the other three groups working.
- Closing the panel must fully tear down: cancel RAF, restore wrapped factory methods, unsubscribe `renderCapacity`, clear seam callbacks. No leaks (verified by smoke test).
- Voice decrement scheduling must not leak timers if the panel closes mid-gate (decrement is a no-op when the monitor is gone).
- Opening mid-playback is fine; counts start from "now" (accepted consequence).

## Testing

Per the repo's four-layer convention and the **always-relative assertion** rule:

- **Pure** (`src/perf/perf-monitor.test.ts`): ring-buffer/stats math (avg/peak/percentile, max lag), lag computation, and the event-log threshold (when a sample is logged as a dropout). Relative assertions only.
- **Smoke**: opening the panel does not throw and tears down cleanly (no dangling RAF) on close — mirrors the `dispose()` pattern already used by [level-meter.ts](../../../src/core/level-meter.ts).

## Overhead summary (the user's question, recorded)

- **Closed:** zero (dormant boolean checks only).
- **Open:** sub-millisecond per update, dominated by the throttled (~10 Hz) paint; all collection seams are O(1) per event. The measured FPS/lag includes a sub-1 ms slice of the panel itself — disclosed, does not falsify the diagnosis.

## Open questions

None blocking. The keyboard shortcut (vs. button-only) is a minor follow-up to confirm during implementation.
