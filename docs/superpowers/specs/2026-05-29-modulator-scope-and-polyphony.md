# Modulator Scope + Subtractive Polyphony Design

**Date:** 2026-05-29
**Status:** Approved (brainstorming complete)

## Goal

Fix the architectural bug where polyphonic synth engines (subtractive, FM,
wavetable, karplus) spawn fresh modulator voices on every note — making
LFO sweeps inaudible and breaking the "one continuous LFO on the engine"
mental model. At the same time, add monophonic/polyphonic mode and a
voice-count cap to the subtractive engine.

## Problem

`Engine.createVoice(ctx, output)` is called **per note**. The poly
engines currently invoke `modHost.spawnVoice(ctx, ...)` inside
createVoice, instantiating fresh `LFOVoice` + `ADSRVoice` objects every
time. Each LFO's `OscillatorNode` is created at note time, so:

- The LFO phase starts over on every note-on.
- A 4 Hz LFO on a 16th-note line at 130 BPM never completes ~1/3 of a
  cycle before restarting.
- Result: the knob's modulation arc moves visibly but the audio
  modulation is a tiny stutter — practically inaudible.

Drum and TB-303 engines were fixed by sharing one `engineModVoices` map
for the lifetime of the engine. That works because they're effectively
monophonic. For real polyphonic engines the question is bigger: an ADSR
*should* be per-note (each voice has its own envelope), but an LFO
*should* be shared across notes (one continuous wave).

## Conceptual model

Each `ModulatorState` declares a **scope**:

| Scope        | Lives on               | Trigger semantics                                     |
| ------------ | ---------------------- | ----------------------------------------------------- |
| `shared`     | The engine instance    | One instance for all notes. LFO `trigger='note'` causes phase reset on *any* note. Default for LFO. |
| `per-voice`  | Each `Voice` (per note)| Fresh instance per note. ADSR triggered with the note. Default and the only valid value for ADSR. |

The existing `trigger: 'free' \| 'note'` field only affects shared LFOs;
the UI hides it when scope=per-voice (per-voice LFOs are always fresh
with the voice).

## Data model

```ts
// src/modulation/types.ts
export type ModulatorScope = 'shared' | 'per-voice';

export interface ModulatorState {
  // ... existing
  scope?: ModulatorScope;
}

export function makeDefaultLFO(id: string): ModulatorState {
  return {
    id, kind: 'lfo', enabled: true, connections: [],
    rateHz: 4, waveform: 'sine', bipolar: true,
    syncToBpm: false, syncRatio: '1/4',
    trigger: 'free',
    scope: 'shared',
  };
}

export function makeDefaultADSR(id: string): ModulatorState {
  return {
    id, kind: 'adsr', enabled: true, connections: [],
    attackSec: 0.01, decaySec: 0.3, sustain: 0.7, releaseSec: 0.3,
    scope: 'per-voice',
  };
}
```

A `normalizeModulator(state)` helper in `types.ts` fills in the default
scope based on `kind` when loading older save data missing the field.

## Modulation bus on each voice manager

The chosen routing model (Approach D from brainstorming): each poly voice
manager exposes a **modulation bus** — a small set of `ConstantSourceNode`s
whose `.offset` is the AudioParam shared modulators write to. The bus
output fans out internally to every active per-voice AudioParam, so the
binder makes a single connection regardless of how many notes are
playing.

```ts
// Inside PolySynth (similar shape in wavetable / fm / karplus voice managers)
class PolySynth {
  // existing voices, params...

  readonly modBus: Record<string, ConstantSourceNode> = {};
  private readonly busTargets: Array<{ paramId: string; voiceParam: AudioParam }> = [];

  constructor(ctx: AudioContext, ...) {
    for (const id of ['filter.cutoff', 'filter.resonance', 'amp.gain']) {
      const n = ctx.createConstantSource();
      n.offset.value = 0;
      n.start();
      this.modBus[id] = n;
    }
  }

  private allocateVoice(): InternalVoice {
    const v = /* construct */;
    this.modBus['filter.cutoff'].connect(v.filter.frequency);
    this.modBus['filter.resonance'].connect(v.filter.Q);
    this.modBus['amp.gain'].connect(v.amp.gain);
    return v;
  }
}
```

For mono engines (TB-303, drums) the "bus" is degenerate: the engine
just returns the single instance's AudioParams. No internal fan-out is
needed.

## Engine API

```ts
// src/engines/engine-types.ts
interface SynthEngine {
  // existing methods...

  /** AudioParams that SHARED modulators write to. Fans out internally to
   *  all active per-voice AudioParams via the voice manager's modulation
   *  bus (poly engines) or is a direct reference (mono engines).
   *  Returns an empty Map if the engine has no shared-modulatable
   *  params (or no instance yet — engines lazy-init their voice manager). */
  getSharedAudioParams?(ctx?: AudioContext): Map<string, AudioParam>;
}
```

`Voice.getAudioParams()` still returns per-voice AudioParams (used for
per-voice modulator routing — e.g. an ADSR connected to amp.gain on the
specific note that triggered it).

## Binder refactor

`voice-mod-binding.ts` splits into two paths:

```ts
/** Wire SHARED modulators ONCE per engine. Called from createVoice on
 *  first invocation; the binder + modVoices live on the engine for its
 *  whole lifetime. */
export function bindEngineModulators(opts: {
  laneId: string;
  engine: SynthEngine;
  voiceMods: Map<string, ModulatorVoice>;  // only scope=shared mods
  ctx: AudioContext;
}): ConnectionBinder { /* ... */ }

/** Wire PER-VOICE modulators per createVoice call (essentially the
 *  function we have today, but filtered to scope=per-voice). */
export function bindVoiceModulators(opts: BindVoiceModulatorsOpts): ConnectionBinder { /* ... */ }
```

`ConnectionBinder.apply` is unchanged but the destMap/modulators it
receives are pre-filtered by scope. The lane bindings map gains a second
key: `${laneId}:engine` (for shared) and `${laneId}:${voiceId}` (for
per-voice).

`reapplyLaneModulations(laneId)` re-applies BOTH paths so a depth tweak
or scope change takes effect immediately.

## Engine createVoice flow

```ts
createVoice(ctx, output): Voice {
  // 1. Ensure the underlying instance/voice manager exists.
  // 2. Lazy-init engine-wide shared modVoices:
  if (!this.engineModVoices) {
    this.engineModVoices = this.modHost.spawnVoiceFiltered(
      ctx, () => this.bpm,
      (m) => (m.scope ?? defaultScopeFor(m.kind)) === 'shared',
    );
    this.engineBinder = bindEngineModulators({
      laneId, engine: this,
      voiceMods: this.engineModVoices, ctx,
    });
  }
  // 3. Spawn per-voice modVoices for this note:
  const voiceMods = this.modHost.spawnVoiceFiltered(
    ctx, () => this.bpm,
    (m) => (m.scope ?? defaultScopeFor(m.kind)) === 'per-voice',
  );
  // 4. Construct Voice (per-voice + ref to engine modVoices for retrigger).
  // 5. bindVoiceModulators({ ..., voiceMods, ctx }) for per-voice only.
}
```

`ModulationHost.spawnVoice(ctx, bpm)` becomes
`spawnVoiceFiltered(ctx, bpm, predicate)`. The original signature is
preserved by passing `() => true` as the predicate (backward-compat for
any caller that wants every modulator).

## Voice.trigger retrigger semantics

```ts
Voice.trigger(midi, time, opts): void {
  // Per-voice modulators always retrigger.
  for (const mv of this.voiceMods.values()) {
    mv.trigger(time, opts);
  }
  // Shared modulators only retrigger when explicitly asked.
  const states = this.getModStates();
  for (const [modId, mv] of this.engineModVoices) {
    const s = states.find(x => x.id === modId);
    if (s?.kind === 'lfo' && s.trigger === 'note') {
      mv.trigger(time, opts);
    }
  }
  // ... then the engine-specific note trigger.
}
```

## UI changes

**LFO config row** gains a SCOPE select (Shared / Per-Voice) shown only
when `kind === 'lfo'`. When scope=per-voice the TRIG (Free/Note) control
is hidden.

**ADSR config row** unchanged — no scope control (always per-voice).

## Subtractive: polyphony mode + voice cap

Two new controls in the **engine panel header** (next to the preset
selector):

| Control | Type | Default | Range | Effect |
| ------- | ---- | ------- | ----- | ------ |
| MODE    | select | `poly` | `mono` / `poly` | mono = at most one voice active; the polysynth voice allocator collapses to a single slot. |
| RETRIG  | select | `legato` | `legato` / `retrig` | mono-only: legato keeps the envelope going across overlapping notes; retrig restarts ADSR per note. Hidden when MODE=poly. |
| VOICES  | knob | 8 | 1..16 | Hard cap on simultaneous voices. When the cap is reached the **oldest active voice yields its slot** (voice stealing). 1 ≡ mono. |

State lives on `SessionLane.engineState.params` like other lane settings
so it round-trips through save/load and the JSON demo asset.

Internally:
- `PolySynth.setMode('mono' | 'poly')` and `.setMaxVoices(n)`.
- The existing voice allocator gains a stealing strategy (oldest-first).
- `mono` mode is `maxVoices=1` + a `retrig` flag for envelope behavior.

## Migration

- Existing TB-303 and drums engines: already follow the shared-modulators
  pattern. Their modulator defaults pick up `scope='shared'` from
  `makeDefaultLFO` / `makeDefaultADSR` with no behavior change.
- Saved sessions without `scope`: `normalizeModulator` injects the
  default per kind on load.
- The four poly engines (subtractive, fm, wavetable, karplus) each gain
  a `modBus`, `getSharedAudioParams`, and the split createVoice flow in
  one task per engine.
- Subtractive additionally gains the polyphony controls.

## Testing strategy

Each unit lands with TDD:

- `normalizeModulator` defaults — pure test.
- `ModulationHost.spawnVoiceFiltered` — pure test.
- `bindEngineModulators` only wires shared modulators; ignores per-voice.
- `bindVoiceModulators` only wires per-voice modulators; ignores shared.
- Each engine: `engineModVoices` reused across createVoice calls
  (mirroring `tb303-shared-mods.test.ts`).
- PolySynth modBus: writing to `modBus['filter.cutoff'].offset` shifts
  every internal voice's `filter.frequency` (Web Audio offline render).
- PolySynth.setMaxVoices(2): allocating a 3rd voice steals the oldest.
- PolySynth.setMode('mono'): only one voice active at a time; legato
  vs retrig changes the envelope behavior.

E2E (Playwright):

- LFO on Sub 1 connected to filter.cutoff with depth 0.5 + scope=shared:
  the active polyPresetSelect's voice's filter.frequency.value differs
  by ≥ ε between two samples 1 cycle apart while playing.
- ADSR on Sub 1 connected to amp.gain + scope=per-voice: triggering two
  overlapping notes shows distinct envelopes per voice (audio render
  check via offline ctx).

## Out of scope

- Per-voice LFOs with their own `trigger` field — UI hides the field
  for per-voice scope; the LFO always starts at voice creation time and
  isn't restarted by the voice's own trigger calls.
- Modulating modulators (LFO → LFO rate, etc.) — orthogonal to scope.
- Per-modulator polarity beyond the existing bi/uni toggle.
