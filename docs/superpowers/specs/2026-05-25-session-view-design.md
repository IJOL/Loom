# Session View — Ableton-style Clip Launcher

**Date:** 2026-05-25
**Status:** Approved (brainstorm complete)
**Scope:** Add an "Ableton Session view" mode to the existing tb303-synth app: columns per instrument, clips launchable independently, scene rows. Coexists with the current Classic UI (tabs + global slots A/B/C/D) as a toggleable mode.

---

## 1. Goal & Non-goals

**Goal.** A second top-level UI mode in the same app that lets the user compose and perform like Ableton's Session view: each instrument is a column of clips with independent length, clips launch on a quantize boundary, scene rows fire many clips at once, the existing DSP/engines are reused unchanged.

**Non-goals (out of scope for this spec):**
- Reverse export Session → Classic (future).
- Bidirectional sync between Classic and Session models (future).
- Live recording of notes into a clip (REC arm — future).
- Follow actions, clip warp, pitch/stretch, groove templates per clip.
- MIDI mapping to clip slots.
- File System Access API silent autosave (future).
- Replacing or rewriting any DSP / engine code.

---

## 2. Architecture summary

- **Same app, same audio context, same engines/drums/fx/mixer/channel strips.** No new project, no second server. Session view is a UI + data-model layer on top of the existing audio runtime.
- **`mode: 'classic' | 'session'`** at the top of the runtime. Transport bar gets a toggle. When mode changes, the top-level UI is hidden/shown and the sequencer's tick switches scheduling logic.
- **Two models coexist in memory and in localStorage:** Classic (existing `PatternBank` with 4 slots) and Session (new `SessionState` with lanes/clips/scenes). Both are saved/loaded together.
- **One-shot migration Classic → Session.** A button "Import from Classic" reads the current Classic state and populates Session lanes/clips/scenes. After import, the two models evolve independently. Reverse export comes in a later phase.
- **Per-lane play position.** The existing sequencer has one global pattern length; Session needs each lane to loop at its own clip length. The 25 ms look-ahead clock is reused but the scheduling body changes per mode.

---

## 3. Data model

```ts
// New, in src/session.ts
export type LaneKind = 'bass' | 'poly' | 'drum-bus' | 'drum-lane';

export type LaunchQuantize =
  | 'immediate' | '1/4' | '1/2' | '1/1' | '2/1' | '4/1';

export interface SessionClip {
  id: string;
  name?: string;
  color?: string;
  lengthBars: number;                    // independent per clip
  launchQuantize?: LaunchQuantize;       // per-clip override of lane + global

  // Content union by lane kind (the lane decides which fields are read):
  bassSteps?: BassStep[];
  bassNotes?: NoteEvent[];
  bassMode?: 'step' | 'piano';

  polySteps?: PolyStep[];
  polyNotes?: NoteEvent[];
  polyMode?: 'step' | 'piano';

  // For collapsed drum-bus clip: a record per sub-lane.
  drumSteps?: Record<DrumVoice, DrumStep[]>;
  // For an expanded single-drum clip:
  drumLane?: DrumVoice;
  drumLaneSteps?: DrumStep[];

  envelopes?: ClipEnvelope[];            // automation curves, per-clip
}

export interface ClipEnvelope {
  paramId: string;                       // matches automationRegistry key
  values: number[];                      // length = lengthBars * 16 * SUB_RES
}

export interface SessionLane {
  id: string;                            // 'bass' | 'main' | 'poly1' | ... | 'drums' | 'drum:kick' | ...
  kind: LaneKind;
  clips: (SessionClip | null)[];         // index = clip slot row; nulls allowed for empty cells
  expanded?: boolean;                    // drums only: when true, this lane is replaced visually by per-drum sub-lanes
  launchQuantize?: LaunchQuantize;       // per-lane override of global
}

export interface SessionScene {
  id: string;
  name?: string;
  clipPerLane: Record<string, number | null>;  // laneId → clip slot index (or null = stop that lane)
}

export interface SessionState {
  lanes: SessionLane[];
  scenes: SessionScene[];
  globalQuantize: LaunchQuantize;        // default '1/1'
}
```

**Engine / channel strip ownership.** Engines, PolySynth instances, ChannelStrips, mixer state — all live at the **lane** level (where they already live today). They are NOT inside the clip. Switching clips on a lane does not switch engines or mixer settings. This matches Ableton (devices belong to the track, not to the clip).

**Per-clip envelope target:** an envelope's `paramId` references the global `automationRegistry`. If the lane's engine changes such that the param no longer exists, the envelope is preserved in data but inactive at runtime; UI marks it grey.

---

## 4. Runtime play state

This state is **not persisted** (it's live performance state):

```ts
export interface LanePlayState {
  laneId: string;
  playing: SessionClip | null;           // currently sounding
  queued: SessionClip | null;            // launches at the next quantize boundary
  queuedBoundary: number;                // ctx.currentTime at which the swap happens
  startTime: number;                     // ctx.currentTime when current clip started
  nextStepIdx: number;                   // next 16th step within the clip to schedule (look-ahead)
  loopCount: number;                     // how many times the clip has fully looped
}
```

One `LanePlayState` per existing lane. Stop on a lane sets `playing = null, queued = null`. Launch sets `queued` and computes `queuedBoundary` from the effective quantize (clip > lane > global cascade).

---

## 5. Sequencer changes

The existing 25 ms look-ahead clock (Chris Wilson "Tale of Two Clocks") is reused. The scheduling body branches on `mode`:

```ts
function tick() {
  const now = ctx.currentTime;
  const lookahead = 0.12;

  if (mode === 'classic') {
    // existing scheduleStep loop — unchanged
    return;
  }

  // Session mode:
  for (const lp of laneStates) {
    // 1) Promote queued → playing once we cross the boundary
    if (lp.queued && now + lookahead >= lp.queuedBoundary) {
      lp.playing = lp.queued;
      lp.queued = null;
      lp.startTime = lp.queuedBoundary;
      lp.nextStepIdx = 0;
      lp.loopCount = 0;
    }

    if (!lp.playing) continue;
    const clip = lp.playing;
    const stepDur = 60 / seq.bpm / 4;            // 16th note duration
    const clipSteps = clip.lengthBars * 16;

    // Schedule any 16ths falling within (now, now + lookahead]
    while (true) {
      const stepTime = lp.startTime + lp.nextStepIdx * stepDur;
      if (stepTime >= now + lookahead) break;
      const stepInClip = lp.nextStepIdx % clipSteps;
      if (lp.nextStepIdx > 0 && stepInClip === 0) lp.loopCount++;
      scheduleClipStep(lp, clip, stepInClip, stepTime, stepDur);
      lp.nextStepIdx++;
    }
  }

  // Envelope tick (continuous): for each lane, sample the active clip's
  // envelopes at the current playhead position and write to the registry knob.
}
```

`scheduleClipStep` is a small dispatch over `lane.kind` that calls the **existing** trigger functions (`synth.trigger`, `polysynth.trigger`, engine instance `createVoice`+`trigger`, `drums.trigger`). It does NOT introduce any new audio code path.

**Quantize boundary calculation:**

```ts
function nextBoundary(q: LaunchQuantize, now: number): number {
  if (q === 'immediate') return now;
  const beatDur = 60 / seq.bpm;
  const beats = { '1/4': 1, '1/2': 2, '1/1': 4, '2/1': 8, '4/1': 16 }[q];
  const quantDur = beats * beatDur;
  return Math.ceil(now / quantDur) * quantDur;
}
```

**Effective quantize** for a clip launch = `clip.launchQuantize ?? lane.launchQuantize ?? session.globalQuantize`.

**Scene launch** queues a clip per lane (from `scene.clipPerLane`) all sharing the same `queuedBoundary`, computed from the **lane-or-global** quantize (clip quantize is not consulted in scene launch — the scene fires lanes together).

**Stop semantics:**
- Per-lane stop button: `playing = null, queued = null` immediately (no quantize).
- Per-scene stop button: stops all lanes mapped in that scene (use this as a "clear" preset).
- Global stop (transport ⏹): stops all lanes, resets transport.
- A subsequent launch on any stopped lane restarts the clip from `nextStepIdx = 0`.

**Background-tab safety:** if the look-ahead loop is delayed > 500 ms (e.g. tab throttled), we reset `nextStepIdx` so the playhead jumps to "now" rather than emitting a trigger storm.

---

## 6. UI

### 6.1 Mode toggle

In the transport row (today: Play | Loop | Chain | BPM | Volume | Bars | Slots | ...), add a single segmented control:

```
[ Classic | Session ]
```

Click switches `mode`, calls a global stop, hides one UI tree and shows the other. The transport row itself stays visible in both modes (it owns Play/BPM/Volume/quantize selector/REC/Save/Load).

### 6.2 Session grid layout

Below the transport (where tabs sit today in Classic):

```
              BASS         DRUMS        MAIN         POLY 1       POLY 2     [+ Synth]    Scenes
              ───────      ───────      ───────      ───────      ───────                 ───────
   1          [ A   ▶]     [ A   ▶]     [ A   ▶]     [ A   ▶]     [       ]               [ ▶ 1 ]
   2          [ B   ▶]     [ B   ▶]     [ B   ▶]     [ B   ▶]     [       ]               [ ▶ 2 ]
   3          [      ]     [      ]     [      ]     [      ]     [       ]               [ ▶ 3 ]
   +          (add row)                                                                    [ + ]
              ───────      ───────      ───────      ───────      ───────                 ───────
              [⏹]          [⏹]          [⏹]          [⏹]          [⏹]                    [⏹ all]
              ─────────────────────────────────────────────────────────────
              SUB ⚙        808 ⚙        WT  ⚙         FM  ⚙        KS  ⚙          (engine chip + edit)
              ─────────────────────────────────────────────────────────────
              Pan          Pan          Pan          Pan          Pan          (mixer strip
              Rev          Rev          Rev          Rev          Rev          per column,
              Dly          Dly          Dly          Dly          Dly          reuses existing
              EQ Hi        EQ Hi        EQ Hi        EQ Hi        EQ Hi        mixer controls)
              EQ Md        EQ Md        EQ Md        EQ Md        EQ Md
              EQ Lo        EQ Lo        EQ Lo        EQ Lo        EQ Lo
              ▼ Vol        ▼ Vol        ▼ Vol        ▼ Vol        ▼ Vol
              [M][S][R]    [M][S][R]    [M][S][R]    [M][S][R]    [M][S][R]
```

**Clip cell** (~120 × 40 px):
- Filled: pill of color + name + ▶ icon. Click → launch (queued if quantize ≠ immediate).
- Empty: ghost outline, click → create empty clip with default length = `globalBars` and open piano roll.
- Playing: green border + horizontal progress bar inside the cell showing loop position.
- Queued: pulsing border until quantize boundary hits.

**Column header (lane):**
- Lane name (`BASS`, `DRUMS`, `MAIN`, `POLY 1`, ...).
- Click → selects this lane (used by the "⚙ Edit" affordance and as the implicit target for keyboard shortcuts).
- For DRUMS column only: small ▦ button that toggles `expanded`. When expanded, the single DRUMS column is replaced by one column per drum sub-lane (`KICK`, `SNARE`, `CH HAT`, …). Toggling back collapses them.
- "+ Synth" column at the right edge of the synth columns adds a new extra poly lane (same as the existing "+ Add Track" in Classic).

**Engine chip + ⚙ Edit (per column):**
- Chip shows current engine (3-letter abbreviation: SUB/WT/FM/KS).
- The ⚙ icon implements the **tab-swap edit pattern**: clicking it calls `setActivePolyTarget(...)` for that lane, sets Classic's active tab to the matching tab (TB-303 for bass, Drums for drums, MAIN/POLY n for polys), and shows a floating "← Back to Session" pill in the top-right of the Classic tab. Click that pill → returns to Session view.
- **No new knob collections.** The Classic tabs are the canonical instrument editing UI; Session reuses them by navigation, not duplication.

**Mixer strip (per column):**
- Reuses the existing per-channel mixer state (`stripFor(trackId)`) — same `ChannelStrip` instance the Classic mixer panel uses. The Session column just renders a vertical layout of the same knobs.
- Pan, Reverb send, Delay send, EQ Hi/Mid/Lo, Vol fader (vertical), Mute, Solo, Record-arm (R reserved for future).
- The standalone Mixer panel from Classic stays in Classic. In Session, it's not shown — the column strips replace it.

**Scenes column (rightmost):**
- One row per scene. ▶ button launches that scene (queues each lane's mapped clip with shared boundary). Scene name is editable inline.
- ⏹ all button at the bottom = global stop.
- "+" at the bottom adds a new empty scene.

### 6.3 Clip inspector

Selecting a single clip (single-click on the cell) shows a small inspector overlay or sticky bar at the bottom of the grid:
- Name (editable), color (picker), length in bars (number input), launch quantize (dropdown with "Default (uses lane)" entry).
- Buttons: Duplicate, Delete, Open Piano Roll.

Double-clicking a clip opens the **piano roll** for that clip. We reuse `createPianoRoll` from `src/pianoroll.ts` — the same component that already exists. The roll is shown in a docked panel below the grid (collapsible), bound to the clip's `bassNotes` / `polyNotes` / per-sub-lane drum notes.

### 6.4 Transport additions

In addition to the mode toggle, the transport gets a **Quantize** dropdown next to BPM:
```
Quantize: [ 1/1 ▼ ]   (options: Immediate, 1/4, 1/2, 1/1, 2/1, 4/1)
```
This sets `session.globalQuantize`. It's the default used when neither the lane nor the clip overrides.

The existing **Loop / Chain** buttons are hidden in Session mode (they don't apply — Session loops are per-clip and chaining is replaced by scene launching).

---

## 7. Migration: Classic → Session

Triggered by an "Import from Classic" button shown in the Session UI top bar. Visible always; warns before overwriting non-empty Session data.

```
For each Classic slot s ∈ {0, 1, 2, 3}:
  Create scene = { id, name: `Scene ${s+1}`, clipPerLane: {} }
  Push scene to session.scenes

  For each existing lane (bass, drums, main, poly1..polyN):
    Resolve the lane's `id` in Session's lane registry, create the SessionLane
      if it doesn't exist yet.
    Build a SessionClip with:
      lengthBars = max(1, slot.length / 16)
      bass:   bassSteps = slot.bass.map(copy)
              bassNotes = slot.bassNotes.map(copy)
              bassMode  = slot.bassMode
      drums:  drumSteps = (copy slot.drums into one record)
      main:   polySteps = slot.melody.map(copy)
              polyNotes = slot.polyNotes.map(copy)
              polyMode  = slot.polyMode
      polyN:  polyNotes = slot.extraPolyTracks[id].notes.map(copy)
      envelopes = []         (Classic automation lanes do NOT migrate in this phase)

    Append the clip into lane.clips at index = s
    scene.clipPerLane[lane.id] = s
```

After import, launching scene `s` reproduces what Classic slot `s` sounded like.

**Re-import** is allowed: the button replaces existing Session lanes/clips/scenes wholesale. Confirm before doing so.

---

## 8. Persistence

### 8.1 Save manager

Storage keys in `localStorage`:

```
tb303-saves              ← index: [{ id, name, timestamp, sizeKB }, ...]
tb303-save:<id>          ← one full SavedState JSON per save
tb303-save:autosave      ← overwritten every Save; used for boot recovery
```

Each `SavedState` is:

```jsonc
{
  "version": 2,
  "bpm": 130,
  "masterVol": 0.5,
  // ... all existing top-level fields ...
  "classic": { /* current SavedState shape, unchanged */ },
  "session": {
    "lanes": [...],
    "scenes": [...],
    "globalQuantize": "1/1"
  },
  "mode": "classic" | "session"
}
```

A v1 save file (no `session`, no `version`) loads with Session empty; user can run "Import from Classic" to populate.

### 8.2 Save flow

Click **Save**:
1. Prompt for a name. Default = `Sesión YYYY-MM-DD HH:mm`. Cancel = abort.
2. Generate `id = crypto.randomUUID()` (or `Date.now().toString(36)` if randomUUID unavailable).
3. Append `{ id, name, timestamp: Date.now(), sizeKB }` to `tb303-saves`.
4. Write the full `SavedState` JSON to `tb303-save:<id>`.
5. Overwrite `tb303-save:autosave` with the same data.
6. Trigger a download of the same JSON as `tb303-session-YYYY-MM-DD-HHmm.json` (`Blob` + programmatic `<a download>`).

### 8.3 Load flow

The Load button opens a **Save Manager** modal:

```
┌─ Save Manager ────────────────────────────────────────┐
│ Auto-save (latest)            14:32 · 12 KB    [Load] │
│ ──────────────────────────────────────────────────── │
│ My techno set v2               13:51 · 14 KB    [Load][⤓][✎][🗑]
│ Acid sketch                    11:02 ·  9 KB    [Load][⤓][✎][🗑]
│ ...                                                   │
│ ──────────────────────────────────────────────────── │
│ Total: 35 KB / ~5 MB                                  │
│                                                       │
│ [Load from file…]            [Clear all saves]        │
└───────────────────────────────────────────────────────┘
```

- **Load** — reads `tb303-save:<id>`, validates shape, reconstructs Classic + Session models, applies mixer/strip/engine state, sets `mode` from the save (or keeps current mode if save predates the field).
- **⤓ Download** — re-downloads that save as JSON.
- **✎ Rename** — edits the entry's `name` in the index.
- **🗑 Delete** — removes the entry from the index and deletes `tb303-save:<id>`.
- **Load from file…** — file picker for a JSON; bypasses the index, same validation.
- **Clear all saves** — confirm + wipe index + every `tb303-save:*` (preserves `autosave`).

### 8.4 Boot recovery

On app start, if `tb303-save:autosave` exists, load it silently (matches today's behavior).

### 8.5 Storage limits

Show total size in the Save Manager. If a new save would push past 4 MB, warn with the option to delete old saves first.

### 8.6 Validation & errors

- Wrap each `JSON.parse` in try/catch. On corrupt entries: log, mark entry as `corrupt: true` in the index UI, allow Delete.
- Unknown future fields are kept as-is in memory and re-written on next save (forward compatibility).
- Missing required fields fall back to defaults (e.g. Session empty if absent).

---

## 9. Error handling (runtime)

- **Launch on empty lane** (no engine instance ready): logs a warning, skips the trigger, queue is cleared.
- **Engine type change while a clip has envelopes targeting old engine params**: envelopes remain in data; runtime sampler skips paramIds not in `automationRegistry`; UI badges them grey in the clip inspector.
- **Tab background throttle** (clock callback delayed > 500 ms): per-lane `nextStepIdx` is recomputed from `now` so we don't dump a backlog of triggers.
- **Mode switch while playing**: global stop is issued automatically. The user re-launches in the other mode.

---

## 10. Testing (manual)

There is no test suite in this repo; verification is by ear and eye.

| # | Scenario | Expected |
|---|---|---|
| 1 | Boot, switch to Session, click "Import from Classic" with the Minimal Techno demo loaded | 4 scenes appear, each lane has 4 clips. Launching scene 1 sounds like Classic slot A. |
| 2 | Two lanes, clip A = 1 bar, clip B = 3 bars, launch both | Lane A loops 3 times per lane-B loop. No drift, no clicks. |
| 3 | Global quantize = 1/1, click a clip mid-bar | Clip starts at next downbeat. Cell pulses while queued. |
| 4 | Click scene ▶ with 3 lanes mapped to different clips | All 3 swap simultaneously at next 1/1 boundary. |
| 5 | Click a lane's ⏹ while playing | That lane silences; others continue. Re-click any clip in the lane → restarts from clip start. |
| 6 | Click ⚙ on POLY 1 → swaps to MAIN poly tab with POLY 1 as active edit target | Knobs reflect POLY 1's engine. Edit, click "Back to Session" → return to grid with edit persisted. |
| 7 | Save with name "test1" | Save Manager lists "test1". Download fires. Refresh page, Load "test1" → all lanes/clips/scenes restored, Mixer state restored, engine state restored. |
| 8 | Toggle Classic ↔ Session repeatedly | Each model independent, no data loss, no audio glitch (each toggle stops audio first). |
| 9 | Drums column ▦ → expand into sub-lanes | KICK/SNARE/... appear as separate columns; clips for each are independent. ▦ again collapses, the combined drum clip is reconstructed if all sub-lane clips agree on length (otherwise keep one sub-lane clip per row). |
| 10 | Envelope on a clip's `wt-morph`, lane engine is wavetable, play | Morph knob animates. Change engine to FM → envelope marked grey in inspector, audio doesn't crash. |

---

## 11. Implementation order (high level — fed to writing-plans next)

This list informs the plan but the plan will break it into smaller tasks:

1. **Mode toggle plumbing.** Add `mode` state, toggle button, hide/show top-level UIs. No new features yet.
2. **Session data types + empty state.** Add `src/session.ts` with the interfaces. Boot creates an empty SessionState.
3. **Per-lane runtime state + tick branch.** Add `laneStates`. Implement the Session branch of the sequencer tick (with no clips yet, so it just no-ops).
4. **Grid UI: empty grid renders.** Columns from current lanes, empty cells, stop buttons, scene rows. No interaction yet.
5. **Clip launch + quantize.** Click clip → queue; tick promotes; sound plays via existing triggers.
6. **Scene launch + per-scene stop.**
7. **Clip inspector + piano roll docked panel.**
8. **Engine chip + Edit (tab-swap with Back pill).**
9. **Mixer strip per column** (reuse existing mixer state).
10. **Drums collapsed ↔ expanded toggle.**
11. **Per-clip envelopes runtime** (sampler in the same rAF that drives current automation).
12. **Import from Classic.**
13. **Persistence v2:** SavedState shape upgrade, Save flow (name + download), autosave, Load Save Manager modal.
14. **Manual test pass.**

---

## 12. Open questions (none blocking)

- Default `lengthBars` for a newly-created empty clip: use the transport's "Bars" selector value? Spec says yes.
- Color palette for clips: a small fixed palette (6-8 swatches) chosen on click? Spec says yes; defer exact palette to implementation.
- Inline rename of scenes and clips: double-click to edit; spec confirms.
- Keyboard shortcut to toggle Classic/Session: defer to a later pass.
