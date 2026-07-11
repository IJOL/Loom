# MIDI Live-Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user record what they play on a MIDI keyboard into a Loom clip, over the material already playing, with the keyboard following the open clip and chord note-FX applied live.

**Architecture:** Three layers on top of the existing live-MIDI control subsystem (`src/control/`): (1) opening a clip focuses its lane (so the keyboard plays it); (2) live input runs through the lane's chord note-FX before sounding/recording; (3) a pure recorder captures the processed notes against the destination clip's playhead and commits them undoably. Recording never disturbs live playback; it only launches the clip's scene when nothing is playing.

**Tech Stack:** TypeScript, Vite, Web Audio, Vitest. Web MIDI (already wired). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-11-midi-live-record-design.md`

## Global Constraints

- Run a single unit-test file with: `NO_COLOR=1 npx vitest run <path>` (never add `--reporter`). Full suite: `npm run test:unit`.
- `test:unit` has a flaky teardown (`ERR_IPC_CHANNEL_CLOSED`) AFTER tests pass — re-run to confirm green; it is not a failure.
- Source files: target ≤300 lines, hard cap 500. `loom-facade.ts` is ~120 lines today; keep new pure logic in its own files (`live-notefx.ts`, `live-recorder.ts`) rather than growing the facade.
- All UI text in English.
- Assertions in tests are relative where numeric; exact where structural (note counts, pitches, tick positions are exact — they are discrete, not DSP magnitudes).
- Ticks: `TICKS_PER_QUARTER = 96` (`src/core/notes.ts`). Bar ticks: `ticksPerBar(meter)` (`src/core/meter.ts`). Seconds→ticks: `Math.round(sec * bpm * TICKS_PER_QUARTER / 60)`.
- After each task's commit, `git rebase main` (per repo convention) and resolve conflicts immediately.

---

## File Structure

**Create:**
- `src/control/live-notefx.ts` — `expandChordForLane(laneId, midi, velocity, bpm)` → `number[]`. Applies only the lane's enabled **chord** note-FX (skips arp). Pure-ish (reads the registry).
- `src/control/live-notefx.test.ts`
- `src/control/live-recorder.ts` — pure recorder state machine.
- `src/control/live-recorder.test.ts`
- `src/control/loom-facade.capture.test.ts` — facade capture behaviour (destination rules, no-disturb, commit).

**Modify:**
- `src/control/live-keyboard.ts` — group voices per physical key (chord expands one key → N voices).
- `src/control/controller-profile.ts` — extend `LoomControlFacade` with capture methods.
- `src/control/loom-facade.ts` — chord in `playLiveNote`/`releaseLiveNote`; `startCapture`/`stopCapture`/`isCapturing`; `posTicks`; commit via undo.
- `src/session/session-inspector.ts` — `onClipFocused` dep + call in `openInspector`; `setMidiCapture` late-binder + Rec button in the context header.
- `src/session/session-host.ts` — wire `onClipFocused: (laneId) => this.focusLane(laneId)` into the inspector.
- `src/control/control-surface-ui.ts` — Rec button in the MIDI Control panel.
- `index.html` — Rec button markup (MIDI Control panel + clip header).
- `src/main.ts` — build `historyDeps`/`seq` into the facade; wire both Rec buttons + `inspector.setMidiCapture(...)`.

---

## Task 1: Keyboard follows the open clip (P1)

**Files:**
- Modify: `src/session/session-inspector.ts` (`InspectorDeps`, `openInspector`)
- Modify: `src/session/session-host.ts` (inspector construction)
- Test: `src/session/session-inspector.test.ts`

**Interfaces:**
- Produces: `InspectorDeps.onClipFocused?: (laneId: string) => void`, called inside `openInspector()` with the selected clip's `laneId`.

- [ ] **Step 1: Write the failing test**

Append to `src/session/session-inspector.test.ts` (reuse the existing minimal-chrome fixture already in that file):

```ts
it('openInspector focuses the clip’s lane (keyboard follows the open clip)', () => {
  const onClipFocused = vi.fn();
  const insp = makeInspector({ onClipFocused }); // helper builds SessionInspector w/ chrome + state having lane 'lane-1'
  insp.setSelectedClip({ laneId: 'lane-1', clipIdx: 0 });
  insp.openInspector();
  expect(onClipFocused).toHaveBeenCalledWith('lane-1');
});
```

If the file has no `makeInspector` helper, build the inspector inline exactly as the existing `it(...)` at `session-inspector.test.ts:99` does (it already calls `setSelectedClip` + `openInspector` against mounted chrome), and pass `onClipFocused` in its deps.

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-inspector.test.ts`
Expected: FAIL (`onClipFocused` not called).

- [ ] **Step 3: Add the dep + call**

In `src/session/session-inspector.ts`, add to `InspectorDeps`:

```ts
  /** Called when a clip is opened, so the host can make that clip's lane the
   *  active (keyboard-driven) lane. Wired to SessionHost.focusLane. */
  onClipFocused?: (laneId: string) => void;
```

In `openInspector()`, right after the `if (!clip) { panel.hidden = true; return; }` guard (so it only fires for a real clip):

```ts
    this.deps.onClipFocused?.(this.selectedClip.laneId);
```

- [ ] **Step 4: Wire it in the host**

In `src/session/session-host.ts`, where the `SessionInspector` is constructed (its `InspectorDeps` object), add:

```ts
      onClipFocused: (laneId) => this.focusLane(laneId),
```

`focusLane` (session-host.ts:356) is idempotent and fires `onActiveLaneChanged`, which main.ts mirrors into the MIDI `activeLane` store.

- [ ] **Step 5: Run tests**

Run: `NO_COLOR=1 npx vitest run src/session/session-inspector.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/session/session-inspector.ts src/session/session-host.ts src/session/session-inspector.test.ts
git commit -m "feat(control): keyboard follows the open clip (focus its lane)"
```

---

## Task 2: Pure chord-expand helper (P2a)

**Files:**
- Create: `src/control/live-notefx.ts`
- Test: `src/control/live-notefx.test.ts`

**Interfaces:**
- Produces: `expandChordForLane(laneId: string, midi: number, velocity: number, bpm: number): number[]` — returns the midi notes to sound: `[midi]` when no chord note-FX is enabled, else the chord expansion (arp is skipped).

- [ ] **Step 1: Write the failing test**

Create `src/control/live-notefx.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { expandChordForLane } from './live-notefx';
import { getNoteFxChain, disposeNoteFxChain } from '../notefx/notefx-registry';

describe('expandChordForLane', () => {
  const LANE = 'lane-test';
  beforeEach(() => disposeNoteFxChain?.(LANE)); // reset any chain from a prior test

  it('returns the single note when no note-FX is enabled', () => {
    expect(expandChordForLane(LANE, 60, 100, 120)).toEqual([60]);
  });

  it('expands to a major triad when a chord note-FX is enabled', () => {
    const chain = getNoteFxChain(LANE);
    const s = chain.addNoteFx('chord');   // defaults: maj, octave 0 → [0,4,7]
    s.enabled = true;
    expect(expandChordForLane(LANE, 60, 100, 120)).toEqual([60, 64, 67]);
  });

  it('ignores arp note-FX (live arp is out of scope)', () => {
    const chain = getNoteFxChain(LANE);
    chain.addNoteFx('arp').enabled = true;
    expect(expandChordForLane(LANE, 60, 100, 120)).toEqual([60]);
  });
});
```

Check `src/notefx/notefx-registry.ts` for the exact reset export name; if there is no `disposeNoteFxChain`, use whatever the registry exposes to clear a lane's chain (or give each test a unique `LANE` id so no reset is needed).

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/live-notefx.test.ts`
Expected: FAIL (`expandChordForLane` not defined).

- [ ] **Step 3: Implement**

Create `src/control/live-notefx.ts`:

```ts
// src/control/live-notefx.ts
// Expand a single live-played key through the lane's CHORD note-FX only.
// Arp is temporal (needs a real-time clock) and is intentionally skipped here.
import { getNoteFxChain } from '../notefx/notefx-registry';
import { ChordProcessor, type ChordProcessorParams } from '../notefx/chord-processor';
import type { NoteFxEvent } from '../notefx/notefx-types';

export function expandChordForLane(
  laneId: string, midi: number, velocity: number, bpm: number,
): number[] {
  const chain = getNoteFxChain(laneId);
  const chords = chain?.noteFx.filter((s) => s.enabled && s.kind === 'chord') ?? [];
  if (chords.length === 0) return [midi];
  let events: NoteFxEvent[] = [{ note: midi, time: 0, gate: 1, accent: velocity >= 100 }];
  for (const s of chords) {
    events = new ChordProcessor(s.params as unknown as ChordProcessorParams).process(events, { bpm });
  }
  return events.map((e) => e.note);
}
```

- [ ] **Step 4: Run tests**

Run: `NO_COLOR=1 npx vitest run src/control/live-notefx.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/live-notefx.ts src/control/live-notefx.test.ts
git commit -m "feat(control): chord-expand helper for live keyboard input"
```

---

## Task 3: Chord on live monitoring (P2b)

**Files:**
- Modify: `src/control/live-keyboard.ts` (group voices per physical key)
- Modify: `src/control/loom-facade.ts` (`playLiveNote`/`releaseLiveNote` use `expandChordForLane`)
- Test: `src/control/live-keyboard.test.ts`

**Interfaces:**
- Consumes: `expandChordForLane` (Task 2).
- Changes: `LiveVoicePool.noteOn(laneId, midi, velocity, extraMidis?: number[])` — when `extraMidis` is given, the physical key `midi` owns a **group** of voices `[midi, ...extraMidis]`; `noteOff(laneId, midi)` releases the whole group.

- [ ] **Step 1: Write the failing test**

Add to `src/control/live-keyboard.test.ts`:

```ts
it('a grouped noteOn spawns one voice per chord note; noteOff releases all', () => {
  const spawned: number[] = [];
  const released: string[] = [];
  const pool = createLiveVoicePool({
    spawnVoice: () => ({ trigger: () => {}, release: () => { released.push('r'); }, dispose: () => {} }) as any,
    now: () => 0,
    defer: (fn) => fn(),
  });
  pool.noteOn('lane', 60, 100, [64, 67]); // Do major triad, keyed by physical 60
  pool.noteOff('lane', 60);
  expect(released.length).toBe(3); // all three voices released by the single key-up
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/live-keyboard.test.ts`
Expected: FAIL (extra arg ignored → only 1 voice / release).

- [ ] **Step 3: Implement grouping in `live-keyboard.ts`**

Change `LiveVoicePool` and the pool so a physical key can own several voices. Replace the `held: Map<string, Voice>` model with a group model:

```ts
export interface LiveVoicePool {
  noteOn(laneId: string, midi: number, velocity: number, extraMidis?: number[]): void;
  noteOff(laneId: string, midi: number): void;
  setSustain(on: boolean): void;
  panic(): void;
}
```

Inside `createLiveVoicePool`, hold a group per physical key:

```ts
  const groups = new Map<string, Voice[]>();     // key = `${laneId}:${midi}` (physical key)
  const sustained = new Set<string>();
  let sustainOn = false;
  const keyOf = (laneId: string, midi: number) => `${laneId}:${midi}`;

  function releaseGroup(key: string): void {
    const vs = groups.get(key);
    if (!vs) return;
    groups.delete(key);
    const t = deps.now();
    for (const v of vs) { v.release(t); deps.defer(() => v.dispose()); }
  }

  return {
    noteOn(laneId, midi, velocity, extraMidis) {
      const key = keyOf(laneId, midi);
      if (groups.has(key)) releaseGroup(key);       // clean retrigger
      const midis = [midi, ...(extraMidis ?? [])];
      const vs: Voice[] = [];
      for (const m of midis) {
        const v = deps.spawnVoice(laneId);
        if (!v) continue;
        v.trigger(m, deps.now(), { gateDuration: HELD_GATE_SECONDS, velocity });
        vs.push(v);
      }
      if (vs.length) groups.set(key, vs);
    },
    noteOff(laneId, midi) {
      const key = keyOf(laneId, midi);
      if (sustainOn) { sustained.add(key); return; }
      releaseGroup(key);
    },
    setSustain(on) {
      sustainOn = on;
      if (!on) { for (const k of sustained) releaseGroup(k); sustained.clear(); }
    },
    panic() { for (const k of Array.from(groups.keys())) releaseGroup(k); sustained.clear(); },
  };
```

- [ ] **Step 4: Apply chord in the facade**

In `src/control/loom-facade.ts`, change `playLiveNote` to expand the chord and pass the extras. Add `import { expandChordForLane } from './live-notefx';` and a bpm source (the facade gains `seq` in Task 5; until then read `deps.sessionHost`'s bpm — but do Task 5's `seq` dep addition here if needed). Replace:

```ts
    playLiveNote: (laneId, midi, velocity) => {
      const [first, ...extra] = expandChordForLane(laneId, midi, velocity, deps.seq.bpm);
      pool.noteOn(laneId, first, velocity, extra);
    },
    releaseLiveNote: (laneId, midi) => pool.noteOff(laneId, midi),
```

Note: the physical key is `midi`; `expandChordForLane` returns `[midi]` (no chord) or `[root, ...chordNotes]` where the first equals the played note, so `noteOff(laneId, midi)` always matches the group key. Add `seq: Sequencer` to `LoomFacadeDeps` now (import `type { Sequencer } from '../core/sequencer'`) and pass it from main.ts.

- [ ] **Step 5: Run tests**

Run: `NO_COLOR=1 npx vitest run src/control/live-keyboard.test.ts src/control/loom-facade.test.ts`
Expected: PASS (update any existing live-keyboard test that asserted the old single-voice `held` map).

- [ ] **Step 6: Commit**

```bash
git add src/control/live-keyboard.ts src/control/loom-facade.ts src/control/live-keyboard.test.ts
git commit -m "feat(control): chord note-FX applies to live keyboard input"
```

---

## Task 4: Pure live-recorder (B1)

**Files:**
- Create: `src/control/live-recorder.ts`
- Test: `src/control/live-recorder.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface LiveRecorder {
    start(opts: { mode: 'merge' | 'replace'; existingNotes: NoteEvent[]; clipLengthTicks: number | null; posTicks: () => number }): void;
    noteOn(midi: number, velocity: number): void;
    noteOff(midi: number): void;
    stop(): { notes: NoteEvent[]; lengthTicks: number };
    isRecording(): boolean;
  }
  function createLiveRecorder(): LiveRecorder;
  ```
- `clipLengthTicks` non-null (existing clip) → notes clamped to it, length = it. Null (new clip) → length rounded up to `barTicks` (passed via a bound `roundUp` — see impl; the recorder receives `barTicks` in `start` as an extra field `barTicks: number`).

Refine the interface to carry `barTicks` for the new-clip rounding:

```ts
start(opts: { mode: 'merge'|'replace'; existingNotes: NoteEvent[]; clipLengthTicks: number | null; barTicks: number; posTicks: () => number }): void;
```

- [ ] **Step 1: Write the failing test**

Create `src/control/live-recorder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createLiveRecorder } from './live-recorder';
import type { NoteEvent } from '../core/notes';

const rec = () => createLiveRecorder();

describe('live-recorder', () => {
  it('pairs noteOn/noteOff into a NoteEvent stamped from posTicks', () => {
    const r = rec();
    let pos = 10;
    r.start({ mode: 'replace', existingNotes: [], clipLengthTicks: 384, barTicks: 384, posTicks: () => pos });
    r.noteOn(60, 100); pos = 34; r.noteOff(60);
    const { notes } = r.stop();
    expect(notes).toEqual([{ start: 10, duration: 24, midi: 60, velocity: 100 }]);
  });

  it('replace ignores existing notes; merge keeps them', () => {
    const existing: NoteEvent[] = [{ start: 0, duration: 12, midi: 48, velocity: 80 }];
    let pos = 0;
    const rep = rec();
    rep.start({ mode: 'replace', existingNotes: existing, clipLengthTicks: 384, barTicks: 384, posTicks: () => pos });
    rep.noteOn(60, 90); pos = 24; rep.noteOff(60);
    expect(rep.stop().notes.map((n) => n.midi)).toEqual([60]);

    pos = 0;
    const mrg = rec();
    mrg.start({ mode: 'merge', existingNotes: existing, clipLengthTicks: 384, barTicks: 384, posTicks: () => pos });
    mrg.noteOn(60, 90); pos = 24; mrg.noteOff(60);
    expect(mrg.stop().notes.map((n) => n.midi).sort()).toEqual([48, 60]);
  });

  it('clamps notes past an existing clip length', () => {
    let pos = 380;
    const r = rec();
    r.start({ mode: 'replace', existingNotes: [], clipLengthTicks: 384, barTicks: 384, posTicks: () => pos });
    r.noteOn(60, 100); pos = 400; r.noteOff(60);
    const { notes, lengthTicks } = r.stop();
    expect(lengthTicks).toBe(384);
    expect(notes[0].start + notes[0].duration).toBeLessThanOrEqual(384);
  });

  it('rounds a NEW clip length up to the next bar', () => {
    let pos = 0;
    const r = rec();
    r.start({ mode: 'replace', existingNotes: [], clipLengthTicks: null, barTicks: 384, posTicks: () => pos });
    r.noteOn(60, 100); pos = 500; r.noteOff(60); // 500 ticks → 2 bars (768)
    expect(r.stop().lengthTicks).toBe(768);
  });

  it('empty capture yields no notes and does not throw', () => {
    const r = rec();
    r.start({ mode: 'replace', existingNotes: [], clipLengthTicks: 384, barTicks: 384, posTicks: () => 0 });
    expect(r.stop().notes.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/live-recorder.test.ts`
Expected: FAIL (`createLiveRecorder` not defined).

- [ ] **Step 3: Implement**

Create `src/control/live-recorder.ts`:

```ts
// src/control/live-recorder.ts
// Pure loop-record state machine: pairs live note on/off into NoteEvents,
// stamped from a caller-provided play-position reader. No audio, no DOM.
import type { NoteEvent } from '../core/notes';

interface StartOpts {
  mode: 'merge' | 'replace';
  existingNotes: NoteEvent[];
  clipLengthTicks: number | null;   // null = new clip (round length up to bar)
  barTicks: number;
  posTicks: () => number;
}

export interface LiveRecorder {
  start(opts: StartOpts): void;
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  stop(): { notes: NoteEvent[]; lengthTicks: number };
  isRecording(): boolean;
}

export function createLiveRecorder(): LiveRecorder {
  let recording = false;
  let opts: StartOpts | null = null;
  const open = new Map<number, { start: number; velocity: number }>(); // midi → onset
  let captured: NoteEvent[] = [];

  return {
    start(o) { recording = true; opts = o; open.clear(); captured = []; },
    isRecording: () => recording,
    noteOn(midi, velocity) {
      if (!recording || !opts) return;
      open.set(midi, { start: opts.posTicks(), velocity });
    },
    noteOff(midi) {
      if (!recording || !opts) return;
      const on = open.get(midi);
      if (!on) return;
      open.delete(midi);
      const end = opts.posTicks();
      const duration = Math.max(1, end - on.start);
      captured.push({ start: on.start, duration, midi, velocity: on.velocity });
    },
    stop() {
      recording = false;
      const o = opts; opts = null;
      if (!o) return { notes: [], lengthTicks: 0 };
      const base = o.mode === 'merge' ? [...o.existingNotes] : [];
      let notes = [...base, ...captured];
      let lengthTicks: number;
      if (o.clipLengthTicks != null) {
        lengthTicks = o.clipLengthTicks;
        // clamp: drop notes starting past the end; trim durations that overrun
        notes = notes
          .filter((n) => n.start < lengthTicks)
          .map((n) => ({ ...n, duration: Math.max(1, Math.min(n.duration, lengthTicks - n.start)) }));
      } else {
        const end = notes.reduce((mx, n) => Math.max(mx, n.start + n.duration), 0);
        lengthTicks = Math.max(o.barTicks, Math.ceil(end / o.barTicks) * o.barTicks);
      }
      return { notes, lengthTicks };
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `NO_COLOR=1 npx vitest run src/control/live-recorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/live-recorder.ts src/control/live-recorder.test.ts
git commit -m "feat(control): pure live-recorder (note pairing, merge/replace, clamp/round)"
```

---

## Task 5: Facade capture — destination, playhead, commit (B2)

**Files:**
- Modify: `src/control/controller-profile.ts` (`LoomControlFacade`)
- Modify: `src/control/loom-facade.ts`
- Test: `src/control/loom-facade.capture.test.ts`

**Interfaces:**
- Consumes: `createLiveRecorder` (Task 4).
- Produces on `LoomControlFacade`:
  ```ts
  startCapture(mode: 'merge' | 'replace'): void;
  stopCapture(): void;
  isCapturing(): boolean;
  canCapture(): boolean;   // MIDI enabled AND a note-capable destination exists
  ```
- `LoomFacadeDeps` gains `seq: Sequencer` (Task 3) and `historyDeps?: HistoryDeps`.

Destination resolution (single function `resolveDestination()`):
- If `sessionHost.inspector.getSelectedClip()` returns `{laneId, clipIdx}` and the panel is shown → that clip (existing). Reject if the lane's engine is `'audio'` or the clip has a `sample`.
- Else → new clip: `laneId = activeLane.get()`; find first empty slot in `lane.clips`; create an `emptyClip(1)`; that's the destination (new, `clipLengthTicks = null`).

`posTicks(destLaneId, clip)` closure:
```ts
const lp = sessionHost.laneStates.get(destLaneId);
if (!lp || !lp.playing) return 0;
const lenTicks = clip.lengthBars * ticksPerBar(deps.seq.meter);
const posSec = ctx.currentTime - lp.loopStartedAt;
const raw = Math.round(posSec * deps.seq.bpm * TICKS_PER_QUARTER / 60);
return ((raw % lenTicks) + lenTicks) % lenTicks;
```

- [ ] **Step 1: Write the failing test**

Create `src/control/loom-facade.capture.test.ts`. Build a facade with a stub `sessionHost` exposing `inspector.getSelectedClip`, `laneStates`, `launchSceneAt`, `state.lanes`, and a stub `seq`. Cover:

```ts
// (a) no clip open + idle transport → startCapture creates a new clip in the active lane
//     and calls launchSceneAt (nothing playing).
// (b) something playing → startCapture does NOT call launchSceneAt.
// (c) open audio clip → canCapture() === false; startCapture is a no-op.
// (d) full round-trip: startCapture('replace') → facade.playLiveNote drives the recorder →
//     stopCapture commits notes onto the destination clip.
```

Write concrete assertions, e.g. for (b):

```ts
it('does not launch the scene when something is already playing', () => {
  const launchSceneAt = vi.fn();
  const host = makeHostStub({ playingLaneId: 'drums', /* getSelectedClip */ selected: { laneId: 'sub', clipIdx: 0 }, launchSceneAt });
  const f = createLoomFacade(makeDeps(host));
  f.startCapture('merge');
  expect(launchSceneAt).not.toHaveBeenCalled();
  f.stopCapture();
});
```

(Model `makeHostStub`/`makeDeps` on the existing `loom-facade.test.ts` fixtures.)

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/loom-facade.capture.test.ts`
Expected: FAIL (`startCapture` not defined).

- [ ] **Step 3: Extend the interface**

In `src/control/controller-profile.ts`, add to `LoomControlFacade`:

```ts
  // live capture (loop-record)
  startCapture(mode: 'merge' | 'replace'): void;
  stopCapture(): void;
  isCapturing(): boolean;
  canCapture(): boolean;
```

- [ ] **Step 4: Implement in the facade**

In `src/control/loom-facade.ts`: add imports (`createLiveRecorder`, `ticksPerBar`, `TICKS_PER_QUARTER`, `emptyClip`, `withUndo`, `HistoryDeps`), add `seq` + `historyDeps` to `LoomFacadeDeps`, and implement:

```ts
  const recorder = createLiveRecorder();
  let capture: { laneId: string; clip: SessionClip; isNew: boolean; slotIdx: number; laneRef: SessionLane } | null = null;

  function anyPlaying(): boolean {
    for (const lp of sessionHost.laneStates.values()) if (lp.playing) return true;
    return false;
  }

  function resolveDestination(): typeof capture {
    const sel = sessionHost.inspector.getSelectedClip();
    const panel = document.getElementById('session-inspector');
    if (sel && panel && !panel.hidden) {
      const lane = sessionHost.state.lanes.find((l) => l.id === sel.laneId);
      const clip = lane?.clips[sel.clipIdx];
      if (lane && clip && lane.engineId !== 'audio' && !clip.sample)
        return { laneId: lane.id, clip, isNew: false, slotIdx: sel.clipIdx, laneRef: lane };
      return null; // audio/sample clip open → not capturable
    }
    const laneId = activeLane.get();
    const lane = laneId ? sessionHost.state.lanes.find((l) => l.id === laneId) : null;
    if (!lane || lane.engineId === 'audio') return null;
    let slot = lane.clips.findIndex((c) => c == null);
    if (slot < 0) slot = lane.clips.length;
    const clip = emptyClip(1);
    return { laneId: lane.id, clip, isNew: true, slotIdx: slot, laneRef: lane };
  }

  function posTicksFor(dest: NonNullable<typeof capture>): number {
    const lp = sessionHost.laneStates.get(dest.laneId);
    if (!lp || !lp.playing) return 0;
    const lenTicks = dest.clip.lengthBars * ticksPerBar(deps.seq.meter);
    const posSec = ctx.currentTime - lp.loopStartedAt;
    const raw = Math.round(posSec * deps.seq.bpm * TICKS_PER_QUARTER / 60);
    return ((raw % lenTicks) + lenTicks) % lenTicks;
  }
```

`startCapture`, `stopCapture`, `isCapturing`, `canCapture` on the returned object:

```ts
    startCapture(mode) {
      if (recorder.isRecording()) return;
      const dest = resolveDestination();
      if (!dest) return;
      capture = dest;
      // New clip: place it now so it can play (and be seen) during the pass.
      if (dest.isNew) { while (dest.laneRef.clips.length <= dest.slotIdx) dest.laneRef.clips.push(null); dest.laneRef.clips[dest.slotIdx] = dest.clip; }
      const barTicks = ticksPerBar(deps.seq.meter);
      recorder.start({
        mode,
        existingNotes: dest.clip.notes ?? [],
        clipLengthTicks: dest.isNew ? null : dest.clip.lengthBars * barTicks,
        barTicks,
        posTicks: () => posTicksFor(dest),
      });
      if (mode === 'replace') dest.clip.notes = [];
      // Only launch the destination's scene if nothing is playing (never disturb live playback).
      if (!anyPlaying()) sessionHost.launchSceneAt(dest.slotIdx);
    },
    stopCapture() {
      if (!recorder.isRecording() || !capture) { capture = null; return; }
      const dest = capture; capture = null;
      const { notes, lengthTicks } = recorder.stop();
      const barTicks = ticksPerBar(deps.seq.meter);
      const commit = () => {
        dest.clip.notes = notes;
        if (dest.isNew) dest.clip.lengthBars = Math.max(1, Math.round(lengthTicks / barTicks));
        sessionHost.renderWithMixer();
        sessionHost.inspector.refreshOpenEditor();
      };
      // Empty new-clip capture with no notes: still keep the (empty) clip? No — drop it to avoid litter.
      if (dest.isNew && notes.length === 0) { dest.laneRef.clips[dest.slotIdx] = null; sessionHost.renderWithMixer(); return; }
      if (deps.historyDeps) withUndo(deps.historyDeps, commit); else commit();
    },
    isCapturing: () => recorder.isRecording(),
    canCapture: () => resolveDestination() != null,
```

Then feed the recorder from monitoring: in `playLiveNote`/`releaseLiveNote`, after the pool call, forward the processed group to the recorder when capturing **and** the lane is the capture destination:

```ts
    playLiveNote: (laneId, midi, velocity) => {
      const midis = expandChordForLane(laneId, midi, velocity, deps.seq.bpm);
      const [first, ...extra] = midis;
      pool.noteOn(laneId, first, velocity, extra);
      if (recorder.isRecording() && capture && capture.laneId === laneId)
        for (const m of midis) recorder.noteOn(m, velocity);
    },
    releaseLiveNote: (laneId, midi) => {
      pool.noteOff(laneId, midi);
      if (recorder.isRecording() && capture && capture.laneId === laneId) {
        for (const m of expandChordForLane(laneId, midi, /*vel*/100, deps.seq.bpm)) recorder.noteOff(m);
      }
    },
```

Note the release re-expands the same key deterministically (chord params unchanged during a held note), so the recorder's per-midi `noteOff` matches the `noteOn`s. Import `SessionClip`, `SessionLane`, `emptyClip` from `../session/session`.

- [ ] **Step 5: Run tests**

Run: `NO_COLOR=1 npx vitest run src/control/loom-facade.capture.test.ts src/control/loom-facade.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/control/controller-profile.ts src/control/loom-facade.ts src/control/loom-facade.capture.test.ts
git commit -m "feat(control): facade loop-record capture (destination, playhead, undo commit)"
```

---

## Task 6: Rec UI — MIDI Control panel + clip header (B4)

**Files:**
- Modify: `index.html` (Rec markup in both places)
- Modify: `src/control/control-surface-ui.ts` (panel Rec button)
- Modify: `src/session/session-inspector.ts` (`setMidiCapture` + header Rec button)
- Modify: `src/main.ts` (wire both buttons + `inspector.setMidiCapture`)

**Interfaces:**
- Consumes: facade `startCapture/stopCapture/isCapturing/canCapture` (Task 5).
- Produces: `SessionInspector.setMidiCapture(c: { toggle: (mode: 'merge'|'replace') => void; isRecording: () => boolean; canRecord: () => boolean } | null): void`.

- [ ] **Step 1: Add markup**

In `index.html`, inside the MIDI Control panel body (after `#midi-control-override`, currently near line 153):

```html
            <button id="midi-control-rec" class="rnd" disabled>● Rec</button>
```

In the clip inspector context-header row (near `#insp-context-row`), add:

```html
            <button id="insp-rec" class="rnd" hidden>● Rec</button>
            <select id="insp-rec-mode" class="rnd" hidden>
              <option value="merge">Merge</option>
              <option value="replace">Replace</option>
            </select>
```

- [ ] **Step 2: Wire the panel button (`control-surface-ui.ts`)**

Extend `ControlUiDeps` with `capture?: { toggle: () => void; isRecording: () => boolean; canRecord: () => boolean }` and, in `wireControlSurfaceUI`, after the enable button wiring:

```ts
  const recBtn = document.getElementById('midi-control-rec') as HTMLButtonElement | null;
  if (recBtn && deps.capture) {
    const refresh = () => {
      recBtn.disabled = !enabled || !deps.capture!.canRecord();
      recBtn.textContent = deps.capture!.isRecording() ? '■ Stop' : '● Rec';
      recBtn.classList.toggle('recording', deps.capture!.isRecording());
    };
    recBtn.addEventListener('click', () => { deps.capture!.toggle(); refresh(); });
    // refresh on enable/disable too:
    const origSetEnabledUI = setEnabledUI;
    setEnabledUI = (on: boolean) => { origSetEnabledUI(on); refresh(); }; // if setEnabledUI is not reassignable, call refresh() at the end of the enable click handler instead
    refresh();
  }
```

If `setEnabledUI` cannot be reassigned (it's a `const`), instead call `refresh()` at the end of the enable-button click handler and once after initial `setEnabledUI(enabled)`.

- [ ] **Step 3: Wire the header button (`session-inspector.ts`)**

Add a field + late-binder + render:

```ts
  private midiCapture: { toggle: (mode: 'merge'|'replace') => void; isRecording: () => boolean; canRecord: () => boolean } | null = null;
  setMidiCapture(c: SessionInspector['midiCapture']): void { this.midiCapture = c; this.refreshRecButton(); }

  private refreshRecButton(): void {
    const btn = document.getElementById('insp-rec') as HTMLButtonElement | null;
    const mode = document.getElementById('insp-rec-mode') as HTMLSelectElement | null;
    if (!btn || !mode) return;
    const c = this.midiCapture;
    const canRec = !!c && !!this.selectedClip && c.canRecord();
    btn.hidden = !c; mode.hidden = !c;
    btn.disabled = !canRec;
    btn.textContent = c?.isRecording() ? '■ Stop' : '● Rec';
    btn.onclick = () => { c?.toggle((mode.value as 'merge'|'replace') || 'merge'); this.refreshRecButton(); };
  }
```

Call `this.refreshRecButton()` at the end of `openInspector()` (so it reflects the just-opened clip) and inside `renderContextHeader()`.

- [ ] **Step 4: Wire main.ts**

After the facade exists (`controlFacade`), pass capture into the panel UI deps and bind the inspector:

```ts
// in wireControlSurfaceUI({...}) deps:
  capture: {
    toggle: () => controlFacade.isCapturing() ? controlFacade.stopCapture() : controlFacade.startCapture('merge'),
    isRecording: () => controlFacade.isCapturing(),
    canRecord: () => controlFacade.canCapture(),
  },

// after sessionHost + facade are built:
sessionHost.inspector.setMidiCapture({
  toggle: (mode) => controlFacade.isCapturing() ? controlFacade.stopCapture() : controlFacade.startCapture(mode),
  isRecording: () => controlFacade.isCapturing(),
  canRecord: () => controlFacade.canCapture(),
});
```

Also add `seq` and `historyDeps` to the `createLoomFacade({...})` deps object (needed since Task 3/5).

- [ ] **Step 5: Build + typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add index.html src/control/control-surface-ui.ts src/session/session-inspector.ts src/main.ts
git commit -m "feat(control): Rec buttons for loop-record (MIDI panel + clip header)"
```

---

## Task 7: Full suite + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + unit suite**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: typecheck clean; unit green (re-run once if teardown `ERR_IPC_CHANNEL_CLOSED`).

- [ ] **Step 2: Build for the e2e/browser check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual verification (Chrome, real browser — audio is unfaithful in the VS Code browser)**

Use the `verify` skill / a Chrome session on `http://localhost:5173`:
1. Enable MIDI control; confirm status `✓`.
2. Open a melodic clip → the top engine tab follows it (keyboard now plays that lane). Play — you hear that lane's engine.
3. Add a **chord** note-FX to the lane → playing one key sounds the chord.
4. With the clip open and nothing playing, press **● Rec** → its scene launches; play a few notes; press **■ Stop** → the clip shows the recorded (chord-expanded) notes; **↺ Undo** removes them.
5. With another scene already playing, press **● Rec** → playback is NOT restarted; notes record against the running loop.

- [ ] **Step 4: Commit any fixups, then finish**

If manual verification surfaced fixes, commit them. Then follow `superpowers:finishing-a-development-branch` (rebase onto main, `git merge --ff-only`, ExitWorktree) — but only after the user confirms the audible result.

---

## Self-Review (completed by plan author)

- **Spec coverage:** P1 (keyboard follows clip) → Task 1. P2 (chord on live input) → Tasks 2–3. Loop-record recorder → Task 4. Destination rule / playhead / no-disturb / undo → Task 5. Rec UI (both entry points) + Merge/Replace → Task 6. Tests-no-hardware → Tasks 1–5; manual → Task 7. Out-of-scope (live arp) is not implemented. ✅
- **Placeholder scan:** every step has real code or a concrete command. The two "if X cannot be reassigned" notes give an explicit fallback, not a TODO. ✅
- **Type consistency:** `expandChordForLane` returns `number[]` (Tasks 2/3/5 agree). `LiveVoicePool.noteOn(..., extraMidis?)` consistent (Tasks 3/5). `createLiveRecorder().start({... barTicks, posTicks})` consistent (Tasks 4/5). Facade `startCapture/stopCapture/isCapturing/canCapture` consistent (Tasks 5/6). ✅
