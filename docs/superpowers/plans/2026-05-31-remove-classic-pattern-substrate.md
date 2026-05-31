# Remove Classic `seq.pattern` Substrate — Implementation Plan (Spec 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Strangle removal — delete a layer, let `npx tsc --noEmit` enumerate breakage, fix outward, keep `npm run test:unit` green, commit. The only additive task is `randomizeClipNotes` (TDD).

**Goal:** Delete the entire Classic `seq.pattern` substrate; the `Sequencer` becomes a clock that only drives `sessionTick`. Spec: `docs/superpowers/specs/2026-05-31-remove-classic-pattern-substrate-design.md`.

**Method:** Leaves → core. After each layer: `npx tsc --noEmit` (worklist) + `NO_COLOR=1 npm run test:unit` green, then commit. Build + e2e at the very end (`npm run build` before e2e — it serves `dist/`).

**Branch:** worktree `cleanup/remove-classic-pattern`.

**Verification commands:**
- Worklist/typecheck: `npx tsc --noEmit`
- Unit suite: `NO_COLOR=1 npm run test:unit`
- Single file: `NO_COLOR=1 npx vitest run <file>`
- Final: `npm run build && NO_COLOR=1 npm run test:e2e`

---

## Layer 1 — Leaf removals (no live dependents)

**Delete files:** `src/copy/lane-copy.ts`, `src/copy/slot-copy.ts`.
**Edit `src/presets/presets.ts`:** remove `loadBassPreset`, `loadMelodyPreset`, `loadDrumPreset` (and any now-unused helpers/types they alone used).
**Delete `src/presets/preset-library-ui.ts`** if it only wires those Classic presets (verify it's not doing anything Session). 
**Edit `src/main.ts`:** remove `wireCopyNotesPanel` import+call; remove `setBassMode`/`updateBassModeButtons`/`setPolyPatternMode` and their wiring.
**Edit `src/polysynth/polysynth-presets.ts`:** remove the `#bass-mode-step/piano` and `#poly-mode-step/piano` button wiring (the `setBassMode`/`setPolyMode` deps).
**Edit `index.html`:** remove `#bass-mode-step`, `#bass-mode-piano`, `#poly-mode-step`, `#poly-mode-piano`, and the copy-notes panel markup.

- [ ] Make the deletions/edits above.
- [ ] `npx tsc --noEmit` → fix every reported breakage by deleting the dead reference (do NOT re-stub). Repeat until clean.
- [ ] `NO_COLOR=1 npm run test:unit` → green (delete/adjust any test that asserted the removed Classic behavior; keep tests that cover surviving code).
- [ ] Commit: `git commit -m "cleanup(classic): remove copy-notes panel, slot-copy, Classic presets, Step<->Piano toggles"`

## Layer 2 — Global Automation tab

**Delete files:** `src/automation/automation-ui.ts`, `src/app/automation-recording.ts`.
**Edit `src/automation/automation-tick.ts`:** delete the `for (const lane of seq.pattern.automation)` global loop and the `currentPlayPosition`/`seq.length`-based `autoAbsSubIdx`/playhead/track-active block. KEEP `tickSessionEnvelopes(...)` and `applyModulationToKnobs(...)`. The exported `getAutoAbsSubIdx`/`resetAutomationPosition` may become trivial/unused — remove them and their callers, or keep `getAutoAbsSubIdx` returning 0 only if a surviving caller needs it (check clip-automation-lanes painterDeps).
**Edit `src/main.ts`:** remove `wireAutomationTab` import+call and the `AutomationUIDeps`/automation-tab deps; remove `startAutomationTick` deps that referenced the removed pieces (keep the tick that drives envelopes+modulation).
**Edit `index.html`:** remove `<button class="tab" data-tab="auto">` and `<div class="page" data-page="auto">`.

- [ ] Deletions/edits above.
- [ ] `npx tsc --noEmit` → fix breakage.
- [ ] `NO_COLOR=1 npm run test:unit` → green.
- [ ] Commit: `git commit -m "cleanup(classic): remove the global Automation tab (superseded by Performance view)"`

## Layer 3 — Pattern bank + transport Classic

**Edit `src/core/transport.ts`:** KEEP Play/Stop wiring. Remove `switchSlot`, `updateSlotButtons`, the `button.slot` wiring, `chain-toggle`, `loop-toggle`, `isChainEnabled`/`refreshLoopBtn`, and the `seq.onEnded`/`seq.onPatternChange` assignments. If the file reduces to just Play/Stop, keep it minimal; update `TransportDeps` (drop `bank`, `barsSel` if now unused, `updateBassModeButtons`).
**Delete `src/demo/initial-pattern.ts`** (Sweet Dreams slot fill). 
**Edit `src/main.ts`:** remove `setupInitialPattern` import+call, the `bank`/`PatternBank` construction, and the `wireTransport` deps that passed `bank`. Re-wire Play/Stop directly if `wireTransport` is gone.
**Edit `index.html`:** remove `slot-group` (A/B/C/D), `chain-toggle`, `loop-toggle`.

- [ ] Deletions/edits above.
- [ ] `npx tsc --noEmit` → fix breakage.
- [ ] `NO_COLOR=1 npm run test:unit` → green.
- [ ] Commit: `git commit -m "cleanup(classic): remove A/B/C/D pattern bank, chain/loop, slot transport"`

## Layer 4 — Randomize: detangle Sound, re-home Notes (TDD)

**4a. New pure `randomizeClipNotes`.**

**Files:** create `src/core/randomize-clip.ts` + `src/core/randomize-clip.test.ts`.

- [ ] **Write the failing test** `src/core/randomize-clip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomizeClipNotes } from './randomize-clip';
import { TICKS_PER_STEP } from './notes';

describe('randomizeClipNotes', () => {
  it('fills a clip with scale-aware notes within its bar length', () => {
    const clip: any = { lengthBars: 1, notes: [] };
    randomizeClipNotes(clip, { scale: 'minor', root: 0, density: 1 });   // density 1 = every step on
    expect(clip.notes.length).toBeGreaterThan(0);
    const minorPCs = new Set([0, 2, 3, 5, 7, 8, 10]);
    for (const n of clip.notes) {
      expect(minorPCs.has(((n.midi % 12) + 12) % 12)).toBe(true);
      expect(n.start).toBeGreaterThanOrEqual(0);
      expect(n.start).toBeLessThan(1 * 16 * TICKS_PER_STEP);
    }
  });

  it('is sparser at low density', () => {
    const dense: any = { lengthBars: 2, notes: [] };
    const sparse: any = { lengthBars: 2, notes: [] };
    randomizeClipNotes(dense,  { scale: 'minor', root: 0, density: 1 });
    randomizeClipNotes(sparse, { scale: 'minor', root: 0, density: 0 });   // density 0 = none
    expect(sparse.notes.length).toBeLessThan(dense.notes.length);
  });
});
```

- [ ] `NO_COLOR=1 npx vitest run src/core/randomize-clip.test.ts` → FAIL (module missing).

- [ ] **Implement** `src/core/randomize-clip.ts`:

```ts
import { TICKS_PER_STEP, type NoteEvent } from './notes';

export type ScaleName = 'major' | 'minor' | 'pentMinor' | 'phrygian' | 'chromatic';

const SCALE_INTERVALS: Record<ScaleName, number[]> = {
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export interface RandomizeClipOpts { scale: ScaleName; root: number; density?: number; }

/** Replace clip.notes with scale-aware random notes across the clip's bars.
 *  density (0..1, default 0.35) = probability a step gets a note. Pure except
 *  for the `clip.notes` reassignment. */
export function randomizeClipNotes(
  clip: { lengthBars: number; notes: NoteEvent[] },
  opts: RandomizeClipOpts,
): void {
  const intervals = SCALE_INTERVALS[opts.scale] ?? SCALE_INTERVALS.pentMinor;
  const density = opts.density ?? 0.35;
  const steps = Math.max(1, clip.lengthBars) * 16;
  const pick = () => {
    const oct = Math.floor(Math.random() * 3);
    const iv = intervals[Math.floor(Math.random() * intervals.length)];
    return opts.root + 36 + oct * 12 + iv;
  };
  const out: NoteEvent[] = [];
  for (let i = 0; i < steps; i++) {
    if (Math.random() < density) {
      out.push({
        start: i * TICKS_PER_STEP,
        duration: TICKS_PER_STEP * (Math.random() < 0.3 ? 2 : 1),
        midi: pick(),
        velocity: Math.random() < 0.25 ? 115 : 80,
      });
    }
  }
  clip.notes = out;
}
```

- [ ] `NO_COLOR=1 npx vitest run src/core/randomize-clip.test.ts` → PASS.

**4b. Detangle `random.ts` Sound + re-home the Notes buttons.**

- [ ] **Edit `src/core/random.ts`:** keep the synth/kit (`mod`) randomization; remove the paths that write `seq.pattern.bass/melody/drums` notes. `randomize()` must no longer touch `seq.pattern`.
- [ ] **Edit `src/core/randomize-ui.ts`:** keep `randomizeBassSound`/`randomizeDrumsSound`. Replace `randomizeBassNotes`/`randomizeDrumsNotes`/`randomizePolyLaneNotes` with handlers that call `randomizeClipNotes(activeClip, {scale, root})` on the clip currently open in the clip editor, then refresh the editor, under `withUndo`. Resolve "active clip" from the clip-editor deps (read `src/session/session-inspector.ts` + `src/session/clip-editors/`).
- [ ] `npx tsc --noEmit` → fix breakage. `NO_COLOR=1 npm run test:unit` → green.
- [ ] Commit: `git commit -m "feat(randomize): re-home Notes randomize onto the active Session clip; detangle Sound from seq.pattern"`

## Layer 5 — Sequencer: remove `pattern` + API

**Edit `src/core/sequencer.ts`** to the slim shape in spec §4:
- Remove `pattern` field, `bass`/`drums`/`melody` getters, `setPattern`/`queuePattern`/`pendingPattern`/`hasPendingPattern`/`cancelPendingPattern`, `currentPlayPosition`, `currentStep`/`nextStepTime`, `onStep`/`onPatternChange`/`onEnded`, `loopEnabled`.
- `length` becomes a plain field (default 32); `setLength(n)` sets it + notifies `engineSequencers`. `get length()` getter removed (now a field).
- Constructor: `this.length = length` (no `emptyPattern`).
- `tick` keeps only the `sessionTick` driver.
- Keep `BassStep`/`DrumStep`/`PolyStep` interface definitions (migration needs them) — they can stay in this file.

**Edit `src/main.ts`:** remove `getSeqPattern`, `getMelodySteps`, and any remaining `seq.pattern.*` / `seq.onStep` / `seq.loopEnabled` references. The `#bars` selector keeps calling `seq.setLength`.

- [ ] Edits above.
- [ ] `npx tsc --noEmit` → fix every breakage (delete dead references).
- [ ] `NO_COLOR=1 npm run test:unit` → green (the lane-scheduler / session-runtime tests must stay green — they prove the clock still drives sessionTick).
- [ ] Commit: `git commit -m "cleanup(classic): strip seq.pattern + its API; Sequencer is now a sessionTick clock"`

## Layer 6 — `pattern.ts` collapse

**Edit `src/core/pattern.ts`:** keep only `export const AUTOMATION_SUB_RES = 16;`. Remove `PatternData`, `emptyPattern`, `clonePattern`, `PatternBank`, `AutomationLane`, `PolyTrackMode`, `BassMode`. (If `BassStep/DrumStep/PolyStep` end up better here than in `sequencer.ts`, that's a free choice — just keep them defined somewhere `notes.ts`/`session-migration.ts` can import.)

- [ ] Edit above.
- [ ] `npx tsc --noEmit` → fix breakage.
- [ ] `NO_COLOR=1 npm run test:unit` → green.
- [ ] Commit: `git commit -m "cleanup(classic): collapse pattern.ts to AUTOMATION_SUB_RES"`

## Layer 7 — Final verification

- [ ] `npx tsc --noEmit` → clean.
- [ ] `npm run build` → clean (SCSS + bundle).
- [ ] Update `tests/e2e/` if any test asserted a now-removed Classic control; add a smoke that no `button.slot` / `#chain-toggle` / `#loop-toggle` / `[data-tab="auto"]` exists and that Session + Performance still work.
- [ ] `NO_COLOR=1 npm run test:e2e` → green.
- [ ] `NO_COLOR=1 npm run test:unit` → green (re-run once if the known flaky `ERR_IPC_CHANNEL_CLOSED` teardown appears).
- [ ] Commit any e2e adjustments.
- [ ] Manual smoke (`npm run dev`, `http://localhost:5173`): Session plays; Performance plays + draw automation; 🎲 Sound changes the synth; 🎲 Notes fills the open clip; no Classic buttons remain.

## Self-Review notes (author)

- **Coverage vs spec §3:** every DELETE cluster maps to a layer (L1 leaves, L2 automation tab, L3 bank/transport, L5 sequencer, L6 pattern.ts); KEEP items are explicitly preserved; the one RE-HOME (🎲 Notes) is L4 with TDD.
- **Compiler-as-worklist:** removal layers intentionally lean on `tsc --noEmit` to surface every dead reference rather than enumerating them blindly up front — the audit (spec §3) bounds what's in scope.
- **Risk guard:** the lane-scheduler + session-runtime unit tests gate every layer, proving the surviving clock/scheduler still works.
