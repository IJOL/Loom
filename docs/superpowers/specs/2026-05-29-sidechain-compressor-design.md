# Sidechain compressor: per-lane, master, and ducker

Status: design approved · 2026-05-29
Related: `2026-05-27-plugin-system-design.md` (intentionally NOT used — see "Plugin system overlap")

## Goal

Add three independent dynamics features to the audio graph:

1. A **per-lane compressor** built into `ChannelStrip`, like the existing EQ block.
2. A **master compressor** at the tail of the master signal chain.
3. A **per-lane sidechain ducker** where each lane can be ducked by any other lane's signal — the per-target ducker model that subsumes the classic "one source ducks many targets" pattern.

All three are bypassed/off by default, so existing patterns sound identical until the user enables them.

## Non-goals

- Multi-band compression. Single-band only.
- Custom-modelled compressor DSP. We use Web Audio's `DynamicsCompressorNode` directly; coloration is the browser's stock behaviour.
- Sidechain HPF on the source signal (easy to add later by inserting one biquad in the follower).
- Lookahead (`DynamicsCompressorNode` does not expose it).
- Sidechaining the *master* compressor.
- Compression / ducking on FX returns (reverb/delay tails). The per-lane ducker sits upstream of the FX sends, so sends already pump with the dry signal — that's the wanted behaviour for classic kick-pump.
- Engine-internal compression (each engine still does its own thing pre-strip).

## Plugin system overlap

`2026-05-27-plugin-system-design.md` Phase C/D plans an `InsertChain` and per-lane inserts. We deliberately do **not** wait for or anticipate that system here. The compressor lives in `ChannelStrip` the same way the existing EQ does — built-in fields with `bypass` toggles. When the plugin/insert system lands, EQ and comp can be migrated together or left as-is; this spec creates no new "insert slot" abstraction.

## Architecture overview

### Per-lane signal path (updated `ChannelStrip`)

```text
input → eqLow → eqMid → eqHigh → comp → makeup → level → pan → mute → duck → { master, reverbSend, delaySend }
```

New nodes per strip:

- `comp: DynamicsCompressorNode`
- `makeup: GainNode` (post-comp gain, separate from `level` so the user's fader and the makeup curve are independent)
- `duck: GainNode` (driven by the sidechain follower subgraph; `gain` stays at 1.0 when no source is selected)

### Master signal path (updated `main.ts` wiring)

Before:

```text
master → FilterChain → analyser → destination
```

After:

```text
master → FilterChain → masterComp → masterMakeup → analyser → destination
```

A new `MasterCompressor` class owns `masterComp + masterMakeup`, mirrors the per-lane compressor's API, and supports bypass via the same in-place rewire trick `FilterChain.rewire()` already uses.

### Sidechain bus

A new `SidechainBus` is a per-process registry keyed by lane id (the same lane ids used by `LaneResourceMap`). Each `ChannelStrip` registers a **sidechain tap** — a `GainNode` fed off the strip's `muteGain` output, i.e. the same point the dry/sends split happens. Sources are always tapped post-mute, so a muted source contributes no trigger.

```ts
class SidechainBus {
  register(laneId: string, tap: GainNode): void;
  unregister(laneId: string): void;
  getTap(laneId: string): GainNode | null;
  listSources(): { id: string, label: string }[]; // for the UI dropdown
}
```

### Ducker subgraph (one per active sidechain target)

Built lazily when a target's `sidechain.source` becomes non-null; torn down when it goes back to null.

```text
sourceTap
  → WaveShaper (curve: y = |x|; full-wave rectify)
  → BiquadFilter (lowpass; freq derived from attack/release; smooths to an envelope)
  → Gain (-depth)        ────┐
                              ├──→ duck.gain  (AudioParam)
ConstantSourceNode(1.0) ─────┘
```

`duck.gain` receives the sum of the constant `1.0` and the negative-scaled envelope, so the effective gain is `1 − depth · env(source)`. No `AudioWorklet` required.

Attack/release map to one-pole filter time constants. v1 ships with a single lowpass biquad whose frequency is derived from `release` (the more audible side of the envelope) plus a small smoothing stage controlled by `attack`. This is a deliberate approximation — a proper ducker uses separate up-going and down-going time constants. If perceptual quality is insufficient we swap the follower for a custom `AudioWorklet` later behind the same `SidechainState` interface, no UI churn.

## State and serialization

### New shapes

```ts
interface CompState {
  bypass: boolean;
  threshold: number;   // dB,  -100..0
  ratio: number;       // 1..20
  attack: number;      // s,    0..1
  release: number;     // s,    0..1
  knee: number;        // dB,   0..40
  makeup: number;      // linear gain, 0..4 (≈ +12dB)
}

interface SidechainState {
  source: string;      // lane id of the source
  depth: number;       // 0..1
  attack: number;      // s
  release: number;     // s
  threshold: number;   // dB; envelope below this contributes nothing
}

interface MasterCompState extends CompState {}
```

### Extended `ChannelState`

```ts
interface ChannelState {
  // ...existing fields...
  comp: CompState;
  sidechain: SidechainState | null;   // null = no ducker subgraph built
}
```

### Migration

`ChannelStrip.restore(s)` and the master FX restorer accept `comp` / `sidechain` / `masterComp` as **optional**. When missing, they fall back to:

```ts
const DEFAULT_COMP: CompState = {
  bypass: true, threshold: -24, ratio: 4, attack: 0.003, release: 0.25,
  knee: 30, makeup: 1,
};
const DEFAULT_SIDECHAIN: SidechainState | null = null;
```

So every pattern saved before this lands still loads, with both features inert.

## UI

### Mixer column (per-lane)

Two new sections appear under the existing `EQ` / `SEND` / `PAN` / mute-solo / fader stack, between `SEND` and `PAN`:

| Section | Controls |
|---------|----------|
| `COMP`  | knobs: `THR`, `RAT`, `ATK`, `REL`, `KNEE`, `MKUP`. Toggle: `BYP` |
| `SC`    | dropdown: `SRC` (off + every registered lane id). knobs: `DEPTH`, `ATK`, `REL`, `THR` |

Knob colors follow the existing mixer palette; nothing new in `style.scss` beyond two new section colors. The `SRC` dropdown reuses `select-control`.

The `SRC` dropdown auto-excludes the lane's own id (no self-ducking) and updates whenever lanes are added/removed.

### Master strip

A new compact master-comp panel sits next to the existing master-filter UI. Controls are identical to a per-lane `COMP` section minus the SC subsection.

### Visual feedback

Out of scope for v1: GR meters, comp curve display. The `DynamicsCompressorNode.reduction` value is readable cheaply if we want a single needle later, but no UI for it now.

## Implementation breakdown (rough phases for the implementation plan)

The implementation plan will sequence work along these natural seams:

1. **CompBlock primitive** — a small class wrapping `DynamicsCompressorNode + makeup gain + bypass rewire`. Unit-tested with `CompState` round-trip. No graph wiring yet.
2. **ChannelStrip extension** — splice `CompBlock` into the strip, extend `ChannelState`, add restore-with-defaults. Verify EQ/level/pan unaffected.
3. **MasterCompressor** — own class in `core/fx.ts` (or a new sibling file), spliced into the master chain. Same shape as CompBlock + master-specific serialize/restore.
4. **SidechainBus** — pure registry, fully unit-testable without a real `AudioContext`.
5. **DuckerSubgraph** — given a sourceTap + duck.gain target, build/teardown the follower subgraph. Wiring-tested against a real `OfflineAudioContext`.
6. **ChannelStrip ↔ Bus integration** — strip registers its tap on construction, builds/tears down its ducker on sidechain state changes.
7. **Mixer column UI** — `COMP` + `SC` sections added to the column builder.
8. **Master comp UI** — small panel next to master filter.
9. **Sessions / presets** — confirm session save/load preserves comp + sidechain state, migration smoke test on a saved pre-comp session.

## Testing strategy

Matches the four-layer convention in `CLAUDE.md`. Every assertion is **relative** (ratios, not absolute magnitudes).

### Pure (`src/**/*.test.ts`)

- `comp-state.test.ts` — `serialize → restore → serialize` round-trips bit-identically; defaults applied when `comp`/`sidechain` are missing on input.
- `sidechain-bus.test.ts` — register/unregister/lookup; `getTap` of an unknown id returns `null` (never throws); `listSources` is stable across re-registration.

### DSP real (`*.dsp.test.ts`, uses `OfflineAudioContext` via `test/setup.ts`)

- `comp.dsp.test.ts` — render a loud sine through a strip with `bypass=true` and `bypass=false` (same params otherwise). Assert `rms(active) / rms(bypassed) < 1` by at least a healthy margin (e.g. `< 0.85`), using a sustained sine well above threshold. Golden WAV in `test/output/`.
- `master-comp.dsp.test.ts` — same idea on the master chain end-to-end.
- `ducker.dsp.test.ts` — target = steady sine at lane A; source = periodic kick-shaped pulses at lane B; sidechain B → A with `depth = 0.8`. Assert `rms(window-after-each-pulse) / rms(window-between-pulses) < 1` by a ratio that scales with `depth` (smoke at 0.3, deeper at 0.8). Golden WAV.

### Modulation wiring (`*.wiring.test.ts`)

- `sidechain.wiring.test.ts` — given a real `OfflineAudioContext`, build the follower subgraph against a known source signal and verify the `duck.gain` `AudioParam` actually dips below 1.0 during source bursts and recovers to 1.0 between bursts. Mirrors the existing modulation-wiring tests.

### Out-of-scope tests

- No e2e Playwright test added in v1 (the UI surface is small and the audio assertions are stronger). A follow-up can add a click-and-listen-to-meter Playwright spec once a GR meter exists.

## Risks accepted

- **Stock comp coloration.** `DynamicsCompressorNode` is the browser's, not modelled. If users want analog flavour we can swap to a worklet behind the same `CompState` later — no UI churn.
- **Follower fidelity.** The biquad-LP envelope follower is not as tight as a proper attack/release peak detector. Adequate for ducking; insufficient for surgical compression. The per-lane comp is the `DynamicsCompressorNode`, which has its own (proper) detector — only the sidechain ducker uses our biquad approximation.
- **State surface growth.** Every strip gains ~12 fields. Mitigated by nesting under `comp` / `sidechain` rather than flattening.
- **Plugin system divergence.** When `InsertChain` lands it might want to absorb the per-lane comp. That migration is a known follow-up; this spec doesn't try to preemptively shape itself for it.
