# Built-in ADSR Bypass Toggle Design

> **Goal:** Add a per-envelope on/off switch for each engine's *built-in*
> (hardcoded) ADSR, so the user can A/B-test the built-in envelope against the
> modular ADSR system. The long-term goal is for the modular ADSRs to become
> the only envelope source; this spec is the interim step that lets both
> coexist and be compared before the built-in code is removed.
>
> **Date:** 2026-05-30
>
> **Status:** Spec — ready for implementation planning.

---

## 1. Motivation

Every synth engine still ships with a hardcoded amp/filter envelope, scheduled
directly onto an internal `ConstantSourceNode` at trigger time:

- **Subtractive (PolySynth)** — hardcoded amp env *and* filter env. The modular
  `adsr-amp` / `adsr-filter` modulators exist but sit at `depth=0` (the built-in
  is authoritative).
- **Wavetable** — hardcoded amp env that runs **only in standalone mode**
  (`binder == null`); in a lane the modular `adsr1` already drives amp+cutoff,
  so the `amp.attack/decay/sustain/release` knobs are effectively dead.
- **Karplus** — hardcoded amp env (attack + release) on the offline-rendered
  string buffer. The modular `adsr1` has no connections by default.

We want to validate that the modular ADSR system can fully replace these
built-ins before deleting the built-in code. That requires the ability to
silence each built-in envelope independently and listen to whatever the modular
system produces in its place.

This spec also incidentally resolves the Wavetable "dead knobs" smell: turning
its built-in toggle **On** makes the `amp.*` knobs functional again.

---

## 2. Scope

**In scope (this pass):** Subtractive, Wavetable, Karplus — the three engines
with a clean single amp/filter envelope that has a direct modular counterpart.

**Out of scope (separate spec):**

- **FM** — has four per-operator envelopes; the *modulator*-operator envelopes
  shape timbre (FM index), not amplitude, so a single modular ADSR can't
  reproduce them for a fair A/B.
- **TB303** — its baked filter envelope *is* the "squelch" character of the 303
  and it has no modular ADSR yet.
- Deleting the built-in envelope code once modular-only is validated (a trivial
  follow-up).

---

## 3. Mechanism — pure bypass flag

Each built-in envelope gets a **boolean flag** persisted as a *discrete engine
param*. The flag is named with its section prefix so it lands automatically in
the correct UI section (reusing the existing prefix-based knob mounting):

| Param id            | Governs                          | Engines              |
| ------------------- | -------------------------------- | -------------------- |
| `amp.builtinEnv`    | built-in amp envelope            | Subtractive, Wavetable, Karplus |
| `filter.builtinEnv` | built-in filter envelope         | Subtractive          |

Options: `[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]`,
stored as an index (0 = Off, 1 = On) like other discrete params.

**Behavior, read at trigger time:**

- **On** → the built-in envelope is scheduled exactly as it is today.
- **Off** → the engine **skips** scheduling that built-in envelope; its internal
  `ConstantSourceNode` offset stays at `0` (or its static base). The modular
  ADSR continues to sum into the destination `AudioParam` via Web Audio exactly
  as it does today.

This is a **pure bypass**: the flag gates only the built-in scheduling. It does
**not** touch the modular ADSR — no depth coupling, no value copying, no
auto-seed. The two systems are fully independent.

Consequences (accepted):

- If the built-in is **On** *and* the user raises a modular connection depth on
  the same param, both contributions sum (double-envelope). That is the user's
  choice. By default the modular connections are at `depth=0` (Subtractive) or
  absent (Karplus), so no double-enveloping occurs by default.
- If the built-in is **Off** and no modular ADSR is wired to that param, the
  param sits at its base (silent amp / static cutoff) until the user dials in a
  modular connection depth. This is expected — the user wires the modular side
  themselves when testing it.

---

## 4. Per-engine wiring

### 4.1 Subtractive (PolySynth)

Two flags: `amp.builtinEnv`, `filter.builtinEnv`. Both default **On**
(preserves current sound exactly).

- `PolySynth` gains two fields, `ampEnvEnabled = true` and
  `filterEnvEnabled = true`.
- `SubtractiveEngine.getBaseValue` / `setBaseValue` handle the two param ids
  specially (the same way `poly.mode` / `poly.voices` are handled), reading and
  writing the `PolySynth` fields. Before the `PolySynth` exists they buffer
  through `PendingBaseValues`.
- In `PolySynth.triggerWithBinding`, guard the amp-envelope ramp block with
  `if (this.ampEnvEnabled)` and the `envCutoffNorm` ramp block with
  `if (this.filterEnvEnabled)`. When disabled, leave the respective offset at
  `0` and schedule no ramps. `releaseGate` and `stopTime` computation are
  unaffected (they operate on offsets that are simply left at 0).

### 4.2 Karplus

One flag: `amp.builtinEnv`, default **On**.

- `KarplusVoice.trigger` reads `getParam('amp.builtinEnv')`. When Off, skip the
  `envAmp` amp ramp scheduling (attack → peak → release), leaving `envAmp` at 0
  so a modular ADSR on `amp.level` drives the voice alone. The pre-rendered
  string buffer still plays (the timbre is baked offline per note) — only the
  amp envelope is gated.
- `KarplusEngine` stores the flag in `paramValues` like its other params.

### 4.3 Wavetable

One flag: `amp.builtinEnv`, default **Off** (asymmetric — see below).

- `WavetableVoice.trigger` currently runs the built-in amp env only when
  `binder == null` (standalone). Change the condition so the built-in amp env
  runs when **`ampEnvEnabled` OR `binder == null`**:
  - `binder == null` (standalone / DSP tests) → built-in still runs, preserving
    audibility without a lane binder.
  - In a lane, the built-in runs only when the flag is On.
- Default **Off** because lane Wavetable is already modular-driven today (the
  modular `adsr1` drives amp at `depth=1.0`); Off preserves that exact behavior.
- Turning it **On** re-enables the legacy built-in amp env, which makes the
  `amp.attack/decay/sustain/release` knobs functional again. Caveat: with the
  flag On *and* the modular `adsr1` still at `depth=1.0`, the two amp envelopes
  sum — for a clean A/B the user lowers the modular connection depth manually
  (consistent with the pure-bypass model).
- `WavetableEngine` stores the flag in `paramValues`.

---

## 5. UI

A compact `Off/On` toggle built with the existing `createSelectControl` (the
same control used for `poly.mode`), registered under
`<laneId>.amp.builtinEnv` / `<laneId>.filter.builtinEnv`. Registering it makes
it automatable and round-trips through the session for free, consistent with
the project's "every control is automatable" principle.

Placement (driven by the `amp.` / `filter.` prefix):

- **Subtractive** — the `amp.builtinEnv` control mounts into the
  `poly-amp-knobs` section and `filter.builtinEnv` into `poly-filter-knobs`,
  at the front of the A/D/S/R knob row (via `mountSubtractiveLaneKnobs`'s
  existing prefix filter).
- **Karplus / Wavetable** — the control mounts at the front of the `AMP` knob
  row built in each engine's `buildParamUI` (via `wireEngineParams`'s prefix
  filter).

Because the discrete specs are added to each engine's `params` array, the
existing `wireEngineParams` path renders them as selects with no new mounting
code. The discrete-param toggles also appear in the automation destination list
(harmless, and consistent with selects already being automatable).

---

## 6. Persistence

The flags are ordinary engine params, so they travel through
`engineState.params` automatically — the same path as `poly.mode` /
`poly.voices`. This gives:

- Round-trip through session save / load.
- Inclusion in engine presets, so the user can save the built-in version (A)
  and the modular version (B) as distinct presets and switch between them.

No session schema bump beyond the new param keys (additive; missing keys fall
back to each spec's default).

---

## 7. Testing

Assertions are **relative** per the project convention.

- **Unit (pure):**
  - `SubtractiveEngine.setBaseValue('amp.builtinEnv', 0)` sets
    `PolySynth.ampEnvEnabled = false`; `getBaseValue('amp.builtinEnv')` reflects
    it. Same for `filter.builtinEnv`.
  - Karplus / Wavetable: `setBaseValue('amp.builtinEnv', 0/1)` round-trips via
    `getBaseValue`.
- **DSP (relative, OfflineAudioContext):**
  - Subtractive note rendered with `amp.builtinEnv` On vs Off (modular
    `adsr-amp` at `depth=0`): the Off render's RMS is a small fraction of the On
    render's (built-in silenced, nothing else driving amp).
  - Subtractive with `amp.builtinEnv` Off *and* `adsr-amp` connection
    `depth=1.0`: RMS returns to the same order as the built-in On render
    (modular drives amp).
  - Filter env: `filter.builtinEnv` Off (modular `adsr-filter` depth 0) yields a
    static-cutoff spectrum vs the On render's swept-cutoff spectrum (compare
    brightness / spectral centroid relatively).
  - Karplus: analogous amp On/Off check; assert the `loopGain` string decay is
    still present when the amp env is Off + modular drives amp.
- **Persistence:** a session serialized with `amp.builtinEnv = 0` deserializes
  back to `0`; a preset carrying the flag applies it.

---

## 8. File touch-list

```
src/polysynth/polysynth.ts      — ampEnvEnabled/filterEnvEnabled fields; guard env ramps
src/engines/subtractive.ts      — amp.builtinEnv/filter.builtinEnv specs + get/setBaseValue + UI
src/engines/karplus.ts          — amp.builtinEnv spec + getParam guard in trigger + UI
src/engines/wavetable.ts        — amp.builtinEnv spec + trigger condition change + UI
src/app/knob-mounting.ts        — (only if the toggle needs special placement; prefer prefix-driven)
tests                           — unit + dsp + persistence per §7
```

---

## 9. Implementation order (phases)

1. **Subtractive** — `PolySynth` flags + guards, engine param handling, UI
   toggles in `poly-amp-knobs` / `poly-filter-knobs`. Unit + DSP tests.
2. **Karplus** — flag + trigger guard + UI. Tests.
3. **Wavetable** — flag + trigger condition + UI (default Off). Tests.
4. **Persistence pass** — confirm `engineState.params` round-trips all
   `builtin*` flags and presets carry them.
