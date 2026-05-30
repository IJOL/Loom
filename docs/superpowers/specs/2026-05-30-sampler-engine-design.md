# Sampler Engine Design

> **Goal:** A single `sampler` synthesis engine, unified alongside subtractive/wavetable/FM/karplus/tb303/drums, that loads audio across three per-sample modes — **one-shot** (pitched instrument / rack), **loop** (tempo-synced), and **song/stem** (long backing track) — with audio persisted in IndexedDB and only lightweight references in the save JSON.
>
> **Status:** Spec — ready for implementation planning.
>
> **Date:** 2026-05-30

---

## 1. Motivation

The user wants a sampler "que pueda cargar desde bucles y sonidos individuales hasta temas completos" — covering the full spectrum from individual one-shots to full-length tracks. These are three quite different playback behaviours, but they share one technical base: load a file → decode to `AudioBuffer` → play via `AudioBufferSourceNode`.

Rather than three instruments, this is **one `SynthEngine`** (`src/engines/sampler.ts`) where the playback regime is selected per sample/clip. It slots into the unified-engines architecture (`docs/superpowers/specs/2026-05-26-unified-engines-design.md`): every lane is `{ id, engineId, clips[] }`, and the sampler is just another `engineId`.

The one hard constraint: **audio is heavy and saves are JSON in `localStorage` (~5 MB quota).** Audio therefore cannot live in the save. It lives in IndexedDB; the save holds only `sampleId` references.

---

## 2. Decisions (locked during brainstorming)

1. **One unified engine** `sampler`, with a **per-sample mode**: `oneshot` / `loop` / `song`.
2. **Audio in IndexedDB**; the save JSON carries only lightweight references (`sampleId` + metadata).
3. **Song mode** = a clip whose `lengthBars` is the song's real length; plays through **once**, synced to transport; re-fires (loops) when the clip iteration completes.
4. **One-shots** use a **unified keymap**: 1 sample → spans the whole keyboard (melodic); N samples each on one note → rack/kit. Same mechanism.
5. **Loop sync** = **repitch** (varispeed) now; data model carries a `warp` flag so time-stretch can be added later without rework. Warp itself is **not** implemented in this spec.
6. **Slicing/chops are out of scope** (only trim + loop region). Future spec.
7. **Scheduler integration = "sample-on-clip + one launch trigger per iteration"** (Approach ① from brainstorming): loop/song clips carry the sample and fire a single trigger per clip iteration; one-shot clips keep the existing per-note path.
8. **Envelope = hybrid by mode**: one-shots get a full ADSR via the existing modulation system; loop/song play flat with ~5 ms anti-click micro-fades.
9. **Filter = one lowpass per voice, fully open by default**, modulatable — consistent with the other engines.

---

## 3. Scope

**In scope:**
- `sampler` engine implementing `SynthEngine`, registered like the others.
- Three modes: one-shot (keymap, melodic + rack), loop (repitch tempo-sync), song (play-once).
- Loading via drag-drop + file-picker.
- Keymap editor in the lane inspector.
- Waveform clip editor (trim + loop region + mode + originalBpm + fit-to-bars + gain).
- IndexedDB sample store + in-memory decoded cache + hydration on load.
- Missing-sample handling (no crash, relink flow).
- Per-voice lowpass + amp ADSR (one-shots) wired into the modulation system.

**Out of scope (future specs):**
- Warp / time-stretch (only the `warp` flag is reserved).
- Slicing / chops (transient or division based).
- Multisample with velocity layers / round-robin.
- Export project as a portable `.zip` (audio travels with the JSON).
- Recording from mic / line-in.
- A bundled starter sample library.

---

## 4. Data model

### 4.1 Sample asset + decoded cache (`src/samples/`)

```ts
// Stored in IndexedDB. The encoded file bytes, never decoded audio.
export interface SampleAsset {
  id: string;          // 'smp-<base36>'
  name: string;        // original file name
  mime: string;        // 'audio/wav' | 'audio/mpeg' | ...
  bytes: ArrayBuffer;  // the file as imported
  durationSec: number; // cached metadata (computed at import)
  sampleRate: number;
  channels: number;
  createdAt: number;
}
```

Decoded `AudioBuffer`s live in a separate **in-memory** cache (`Map<sampleId, AudioBuffer>`), never serialised.

### 4.2 Session type extensions (`src/session/session.ts`) — all additive

```ts
// One-shot keymap entry. Lives on the LANE (the instrument).
export interface KeymapEntry {
  sampleId: string;
  rootNote: number;   // midi at which the sample plays at natural pitch
  loNote: number;     // inclusive key range low
  hiNote: number;     // inclusive key range high  (one entry 0..127 = melodic;
                      //                            loNote===hiNote === one pad of a rack)
  gain?: number;      // linear, default 1
}

// The sample bound to a loop/song CLIP (each clip is a different sample).
export interface ClipSample {
  sampleId: string;
  mode: 'loop' | 'song';
  originalBpm?: number; // loop: convenience to suggest lengthBars on import; song: optional
  warp?: boolean;       // future; default/absent = repitch
  trimStart: number;    // seconds into the buffer
  trimEnd: number;      // seconds (buffer end if not trimmed)
  gain?: number;        // linear, default 1
}

export interface SessionClip {
  /* …existing… */
  sample?: ClipSample;                      // ← new optional field
}

export interface SessionLane {
  /* …existing… */
  engineState?: {
    params?: Record<string, number>;
    modulators?: ModulatorState[];
    sampler?: { keymap: KeymapEntry[] };    // ← new optional field
  };
}
```

The `sampleId` is the only heavy-by-reference thing. Both the keymap (lane) and `clip.sample` (clip) point at IndexedDB assets. **No audio is ever embedded in the JSON.**

A clip is in one of two regimes:
- **note clip** (one-shot): `clip.notes` drives the lane's keymap (existing per-note path).
- **audio clip** (loop/song): `clip.sample` present, `clip.notes` empty; one launch trigger per iteration.

---

## 5. Runtime: engine, voice, scheduler

### 5.1 `SamplerEngine` (`src/engines/sampler.ts`)

Implements `SynthEngine` (see `src/engines/engine-types.ts`) the same way as `src/engines/wavetable.ts`:

- `id: 'sampler'`, `name: 'Sampler'`, `type: 'polyhost'`, `polyphony: 'poly'`, `editor: 'piano-roll'` (the actual editor is chosen per clip — see §6.3).
- Params (knobs): `gain`, `amp.attack`, `amp.hold`, `amp.release`, `pitch` (semitones), `filter.cutoff`, `filter.resonance`, `poly.voices`.
- Exposes `amp.gain`, `pitch`/detune and `filter.cutoff`/`filter.resonance` as modulation destinations (via `getAudioParams` / `getSharedAudioParams`), reusing the existing modulation host so ADSR/LFO work exactly like other engines.
- One engine instance **per lane** (as `laneResources` already provides); it holds the lane's `keymap` loaded from `engineState.sampler.keymap`.

**Buffer resolution.** The engine reads `sampleCache.get(sampleId)`. If absent (still loading, or missing) the voice creates no source → silence. No throw.

### 5.2 `SamplerVoice`

One `AudioBufferSourceNode → BiquadFilter(LP) → gain(env) → output` per note. Polyphonic with the same voice-stealing + self-pruning pattern as `WavetableEngine`. Two paths in `trigger(midi, time, opts)`:

```ts
trigger(midi, time, opts) {
  const src = ctx.createBufferSource();

  if (opts.sample) {
    // ── loop / song ── sample comes from the CLIP (opts.sample)
    const buf = sampleCache.get(opts.sample.sampleId);
    if (!buf) return;                         // not loaded yet → silent
    const region = opts.sample.trimEnd - opts.sample.trimStart;
    src.buffer = buf;
    src.playbackRate.value =
      opts.sample.mode === 'loop'
        ? region / opts.gateDuration          // fill the clip EXACTLY (repitch)
        : (this.projectBpm / (opts.sample.originalBpm ?? this.projectBpm)); // song: natural
    src.start(time, opts.sample.trimStart);
    src.stop(time + opts.gateDuration);       // lasts exactly one clip iteration
    applyMicroFades(time, opts.gateDuration); // ~5 ms in/out, no amp envelope
  } else {
    // ── one-shot ── sample comes from the lane KEYMAP (by midi)
    const e = this.keymapEntryFor(midi);      // lo..hi lookup
    if (!e) return;
    const buf = sampleCache.get(e.sampleId);
    if (!buf) return;
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, (midi - e.rootNote) / 12); // repitch by note
    src.start(time, 0);
    applyAmpAdsr(time, opts.gateDuration, opts.accent); // ADSR via modulation system
  }
}
```

**Loop repitch detail.** Speed is derived from `region / clipDuration`, so the loop **always** fills the clip exactly regardless of project BPM. `originalBpm` is used only at import time to suggest the correct `lengthBars` (so it sounds at natural pitch). The `warp` flag will later replace this division with time-stretch.

**Envelope.** One-shots route the lane's ADSR modulator onto `amp.gain` exactly like wavetable (release anchored at `time + gateDuration`; see `src/modulation/adsr-voice.ts`). Loop/song apply only short anti-click fades — the audio plays flat.

**Filter.** A per-voice `BiquadFilterNode` (`lowpass`), cutoff fully open by default (no colouring unless modulated/turned down), `cutoff`/`resonance` exposed for modulation. Same summed-`ConstantSourceNode` pattern as the other engines so external modulators stack cleanly.

### 5.3 Scheduler integration (Approach ①)

`src/core/lane-scheduler.ts` `tickLane` gains one branch. When `clip.sample` is present it emits **one** trigger per loop iteration (at `iterStart`, gate = clip duration) carrying the sample, instead of iterating `clip.notes`:

```ts
// inside tickLane, per iteration k:
if (clip.sample) {
  const at = iterStart;
  if (at >= windowStart && at < windowEnd) {
    ctx.onTrigger(
      { midi: 60, duration: clipDurTicks, velocity: 100, sample: clip.sample },
      at,
    );
  }
} else {
  for (const n of clip.notes) { /* …unchanged… */ }
}
```

The `sample?` field is threaded through three signatures, all additive:
- `SchedulerContext.onTrigger` note payload (`src/core/lane-scheduler.ts`).
- The `onTrigger` callback in `src/session/session-runtime.ts` → `TriggerForLane`.
- `TriggerForLane` + `VoiceTriggerOptions.sample?` (`src/app/trigger-dispatch.ts`, `src/engines/engine-types.ts`).

One-shot clips are completely unchanged — they keep the existing per-note path. The change is contained to these files.

---

## 6. UI

### 6.1 Loading

- **Drag-drop** an audio file onto a sampler lane's empty grid cell → creates an **audio clip** (mode `loop` by default; togglable in the editor).
- **Drag-drop** onto the inspector keymap zone, or the **"Cargar fichero…"** picker → adds a **keymap entry** (one-shot).
- On import: read file → `putSample` in IndexedDB (bytes + metadata) → `decodeAudioData` → cache → assign to keymap entry or `clip.sample`.

### 6.2 Lane inspector (`buildParamUI`, the Synth tab)

- Knob row: GAIN, ATTACK, HOLD, RELEASE, PITCH, CUTOFF, RES, VOICES.
- **Keymap section**: a drop zone + picker, then one row per loaded one-shot (name · root note · key range · gain · remove), plus a mini-keyboard showing zones (a sample spanning many keys vs single-note pads).
- The modulators panel, reused from the modulation system (`renderModulatorsPanel`).

### 6.3 Waveform clip editor (`src/session/clip-editors/clip-editor-waveform.ts`)

New editor, selected by the existing `clip-editor-router.ts` when `clip.sample` is present. Shows:
- The sample waveform with draggable **trim** handles (start/end).
- A **mode toggle**: Loop / Song.
- Loop: `originalBpm` field, a "fit to N bars" selector (sets `clip.lengthBars`), and the derived repitch factor (read-only).
- Gain, and a **▶ Preview** button. Warp shown disabled ("futuro").

One-shot lanes (melodic **and** rack) edit through the existing **piano-roll** in this spec — notes resolve against the keymap regardless of how many entries it has, so the piano-roll already covers both. A dedicated pad/grid view keyed by keymap entries (not the GM-specific `drum-grid`) is an optional future enhancement.

### 6.4 Grid

A loop/song clip renders a **mini waveform thumbnail** in its grid cell instead of note blocks.

---

## 7. Persistence & error handling

### 7.1 Stores (`src/samples/`)

- `sample-store.ts` — IndexedDB (DB `tb303-samples`, object store `samples` keyed by `id`). API: `putSample`, `getSample`, `listSamples`, `deleteSample`, `usedSampleIds(state)`.
- `sample-cache.ts` — `Map<sampleId, AudioBuffer>`; `ensureLoaded(ctx, id)` reads bytes → `decodeAudioData` → cache (idempotent).

The save manager (`src/save/save-manager.ts`, JSON in `localStorage`) is unchanged; the JSON merely gains `clip.sample` and `engineState.sampler.keymap` referencing `sampleId`s. **No audio in the JSON.** No migration is needed (all fields additive; absence = no sampler content).

### 7.2 Hydration on load

After loading a `SessionState`, collect every referenced `sampleId` (keymaps + `clip.sample`) and call `ensureLoaded` in parallel. Triggers before hydration completes hit a cache miss → silence, with a "cargando samples…" indicator.

### 7.3 Error handling

- **Missing sample** (shared JSON, cleared storage): the clip/keymap row shows "⚠ sample ausente"; triggering is silent; a **"Relocalizar fichero…"** action re-imports and rebinds by id. No crash.
- **`decodeAudioData` failure** (corrupt/unsupported): same placeholder + a notice.
- **Quota exceeded** on import: a "almacenamiento lleno" notice; the asset is not half-written.
- Optional GC: a manual "limpiar samples huérfanos" using `usedSampleIds` across all saves.

---

## 8. Testing

Four layers (project convention; assertions always relative — ratios, never absolute magnitudes):

1. **Pure** (`sampler.test.ts`, `sample-resolve.test.ts`): keymap resolution (midi → entry, repitch factor `2^((midi-root)/12)`), loop repitch math (`region / clipDur`), import metadata, `clip.sample` shape, and a "no migration needed" check (loading an old save yields no sampler content and does not throw).
2. **DSP real** (`sampler.dsp.test.ts`, via the shared `test/dsp-battery.ts` + `OfflineAudioContext`): render `SamplerVoice` fed a **synthetic in-memory `AudioBuffer`** (a generated sine — no file I/O, deterministic). Assert: one-shot produces energy and repitches (higher midi → shorter, higher centroid); loop fills exactly the clip duration; song plays once; micro-fades produce no discontinuity at the seam (relative).
3. **Scheduling (fake clock)** (driven by `test/sequencer-harness.ts`): a loop clip fires **exactly one** trigger per iteration; a song clip fires once per its length; a one-shot clip still fires per note.
4. **Persistence** (`sample-store.test.ts`): store round-trip with a fake IndexedDB (or an injected store interface); cache hydration; missing-sample → silent.

WAV renders write to `test/output/` for audible inspection like the other engines.

---

## 9. Implementation phases

Each phase typechecks, tests, and is independently shippable.

1. **Sample store + cache** (`src/samples/`): types, IndexedDB store, decoded cache, import (file → bytes + metadata → store). Pure + store tests.
2. **SamplerEngine — one-shot melodic**: register the engine, params, single-entry keymap, per-note repitch, poly + voice-stealing, amp ADSR via modulation, open LP. DSP test with a synthetic buffer. *Outcome: plays notes from the piano-roll.*
3. **Inspector + keymap UI**: `buildParamUI` with knobs + keymap list + drop/picker; add/remove entries, root/range; rack mode (N entries → drum-grid via the router).
4. **Loop/song clips**: `clip.sample` type, waveform editor + router wiring, scheduler integration (Approach ①), loop repitch = region/clip, song ×1, micro-fades. Scheduling + DSP tests.
5. **Persistence + hydration**: save references, hydrate from IndexedDB on load, missing-sample handling, loading indicator, optional orphan GC.
6. **Polish**: grid waveform thumbnail, drag-drop onto a cell creates the clip, fine trim/loop/gain controls.

---

## 10. New / touched files

**New:**
- `src/samples/types.ts` — `SampleAsset`, store/cache interfaces.
- `src/samples/sample-store.ts` — IndexedDB persistence.
- `src/samples/sample-cache.ts` — decoded `AudioBuffer` cache + hydration.
- `src/samples/import.ts` — file → asset (bytes + metadata).
- `src/engines/sampler.ts` — `SamplerEngine` + `SamplerVoice`.
- `src/session/clip-editors/clip-editor-waveform.ts` — loop/song editor.
- Tests: `sampler.test.ts`, `sampler.dsp.test.ts`, `sample-store.test.ts`, plus a scheduling case.

**Touched (additive):**
- `src/session/session.ts` — `ClipSample`, `KeymapEntry`, `SessionClip.sample`, `SessionLane.engineState.sampler`.
- `src/core/lane-scheduler.ts` — `clip.sample` branch + `onTrigger` payload.
- `src/session/session-runtime.ts` — thread `sample` through `onTrigger`.
- `src/app/trigger-dispatch.ts` + `src/engines/engine-types.ts` — `VoiceTriggerOptions.sample?`.
- `src/session/clip-editors/clip-editor-router.ts` — route `clip.sample` → waveform editor.
- Engine registry boot — register `sampler`.
