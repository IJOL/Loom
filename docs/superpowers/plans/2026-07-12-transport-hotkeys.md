# Transport & Rec hotkeys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox tracking.

**Goal:** `Space` = global pause/resume (exact) and `R` = Rec toggle, as global keyboard hotkeys.

**Architecture:** `SessionHost` gains `pauseTransport`/`resumeTransport`/`togglePlayPause` (save fractional-bar position + scene, stop; re-launch + `seekToBar(fractionalBar)`). A new `src/control/transport-hotkeys.ts` maps `Space`/`R` to callbacks (node-safe, testable). `main.ts` wires them.

**Spec:** `docs/superpowers/specs/2026-07-12-transport-hotkeys-design.md`

## Global Constraints
- `NO_COLOR=1 npx vitest run <path>`; full suite `npm run test:unit` (flaky teardown / DSP renders → re-run). `npx tsc --noEmit` clean before commit. Node test env (no `KeyboardEvent`/`HTMLElement`; `Event`/`EventTarget` are globals). Files ≤300/500. English. Exact assertions for discrete values.
- `songBarSec(bpm, meter)` from `../core/song-position`; current position seconds = `ctx.currentTime − songAnchorSec`; `seekToBar` accepts a fractional bar.

---

## Task 1: SessionHost global pause/resume

**Files:** Modify `src/session/session-host.ts`; Test `src/session/session-host-pause.test.ts` (or extend an existing session-host test).

**Produces:** `pauseTransport(): void`, `resumeTransport(): void`, `togglePlayPause(): void`.

- [ ] **Step 1: read** the class around the field declarations (`songAnchorSec`, `activeSceneIdx` ~lines 59-65), `launchSceneAt` (~165), `launchClipAt` (~140), `stopAllClips` (~358), and how an existing session-host test constructs a host + drives `laneStates`.
- [ ] **Step 2: failing test** — build a host (reuse the existing session-host test fixture), launch a scene so a lane is playing + `activeSceneIdx>=0` + `songAnchorSec` set; advance the fake clock; assert:
  - `pauseTransport()` → nothing in `laneStates` is `playing` (stopped) and a subsequent `resumeTransport()` calls `launchSceneAt` with the same scene and `seekToBar` with the saved fractional bar (spy/observe). Cover: toggle from idle = no-op; `launchSceneAt` clears a pending pause.
  - (If spying private calls is awkward, assert observable state: after pause `activeSceneIdx` handling + not playing; after resume, playing again at the sought bar. Adapt to the fixture — assert exact `posBar` math where possible.)
- [ ] **Step 3: implement** — add `private paused: { posBar: number; sceneIdx: number } | null = null;`. Add `this.paused = null;` at the TOP of `launchSceneAt`, `launchClipAt`, and `stopAllClips`. Add:
```ts
  private anyLanePlaying(): boolean {
    for (const lp of this.laneStates.values()) if (lp.playing) return true;
    return false;
  }
  pauseTransport(): void {
    if (this.paused || this.activeSceneIdx < 0 || !this.anyLanePlaying()) return;
    const { bpm, meter } = this.deps.seq;
    const posBar = (this.deps.ctx.currentTime - this.songAnchorSec) / songBarSec(bpm, meter);
    const sceneIdx = this.activeSceneIdx;
    this.stopAllClips();               // clears this.paused
    this.paused = { posBar: Math.max(0, posBar), sceneIdx };
  }
  resumeTransport(): void {
    const p = this.paused;
    if (!p) return;
    this.paused = null;
    this.launchSceneAt(p.sceneIdx);    // clears paused (already null)
    this.seekToBar(p.posBar);
  }
  togglePlayPause(): void {
    if (this.paused) this.resumeTransport();
    else if (this.anyLanePlaying()) this.pauseTransport();
    // else idle → no-op (Q1)
  }
```
Import `songBarSec` from `../core/song-position` if not already imported.
- [ ] **Step 4:** run the test (PASS) + `npx tsc --noEmit` (0).
- [ ] **Step 5: commit** — `git add src/session/session-host.ts src/session/session-host-pause.test.ts && git commit -m "feat(session): global pause/resume (exact) via save-position + relaunch+seek"`

---

## Task 2: transport-hotkeys.ts module

**Files:** Create `src/control/transport-hotkeys.ts` + `src/control/transport-hotkeys.test.ts`.

**Produces:**
```ts
interface TransportHotkeyDeps {
  isTextTarget: (t: EventTarget | null) => boolean;
  onTogglePlay: () => void;
  onToggleRec: () => void;
  target?: EventTarget;
}
function attachTransportHotkeys(deps: TransportHotkeyDeps): () => void;
```

- [ ] **Step 1: failing test** (`Event`+`Object.assign` harness like `computer-keyboard.test.ts`, node-safe):
```ts
it('Space toggles play (+ preventDefault); r toggles rec', () => {
  const onTogglePlay = vi.fn(), onToggleRec = vi.fn();
  const target = new EventTarget();
  attachTransportHotkeys({ isTextTarget: () => false, onTogglePlay, onToggleRec, target });
  const ev = new Event('keydown', { cancelable: true }); Object.assign(ev, { key: ' ' });
  target.dispatchEvent(ev);
  expect(onTogglePlay).toHaveBeenCalledTimes(1);
  expect(ev.defaultPrevented).toBe(true);
  const r = new Event('keydown', { cancelable: true }); Object.assign(r, { key: 'r' });
  target.dispatchEvent(r);
  expect(onToggleRec).toHaveBeenCalledTimes(1);
});
it('skips text targets and modifier combos', () => { /* isTextTarget:()=>true → no call; ctrlKey:true → no call */ });
```
- [ ] **Step 2: implement:**
```ts
export interface TransportHotkeyDeps {
  isTextTarget: (t: EventTarget | null) => boolean;
  onTogglePlay: () => void;
  onToggleRec: () => void;
  target?: EventTarget;
}
export function attachTransportHotkeys(deps: TransportHotkeyDeps): () => void {
  const target = deps.target ?? window;
  const onKeyDown = (e: Event) => {
    const ke = e as unknown as { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target: EventTarget | null; preventDefault(): void };
    if (ke.ctrlKey || ke.metaKey || ke.altKey) return;
    if (deps.isTextTarget(ke.target)) return;
    const k = ke.key.toLowerCase();
    if (k === ' ' || ke.key === 'Spacebar') { ke.preventDefault(); deps.onTogglePlay(); }
    else if (k === 'r') deps.onToggleRec();
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
```
- [ ] **Step 3:** test PASS + `tsc` 0.
- [ ] **Step 4: commit** — `git add src/control/transport-hotkeys.ts src/control/transport-hotkeys.test.ts && git commit -m "feat(control): transport hotkeys module (Space play/pause, R rec)"`

---

## Task 3: Wire main.ts + verify

**Files:** Modify `src/main.ts`.

- [ ] **Step 1:** import `attachTransportHotkeys`; after `sessionHost` + `controlFacade` exist, call:
```ts
attachTransportHotkeys({
  isTextTarget: (t) => typeof HTMLElement !== 'undefined' && isTextEditTarget(t),
  onTogglePlay: () => sessionHost.togglePlayPause(),
  onToggleRec: () => controlFacade.isCapturing() ? controlFacade.stopCapture() : controlFacade.startCapture('merge'),
});
```
(`isTextEditTarget` is already imported for the computer keyboard? if not, import from `./save/history-wiring`.)
- [ ] **Step 2:** `npx tsc --noEmit` 0; `npm run build` succeeds.
- [ ] **Step 3:** `npm run test:unit` green (re-run a flaky DSP if needed).
- [ ] **Step 4: commit** — `git add src/main.ts && git commit -m "feat(control): wire transport hotkeys (Space pause/resume, R rec)"`
- [ ] **Step 5: manual (ear):** launch a scene → Space pauses (silence, playhead frozen) → Space resumes from the same spot; R toggles ● Rec; both ignored while a text field (BPM) is focused.

---

## Self-Review
- **Coverage:** pause/resume mechanism → Task 1; key bindings → Task 2; wiring → Task 3. Exact resume via fractional `seekToBar`. ✅
- **No placeholders:** Tasks 2/3 carry complete code; Task 1 gives the methods + reads the real fixture for the test. ✅
- **Types:** `attachTransportHotkeys(TransportHotkeyDeps): ()=>void` and the three SessionHost methods consistent across tasks. ✅
