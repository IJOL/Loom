# Session Clip Editors & Copy/Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add type-aware in-inspector clip editors for all clip types (drum-bus, drum-lane, bass-step, poly-step, piano-roll) and a clipboard copy/paste mechanism with Replace and Layer semantics.

**Architecture:** Create a `src/session/clip-editors/` directory with one file per clip type plus a router. The inspector auto-renders the appropriate editor on clip selection. Clipboard state is a module-level variable in the inspector. No new audio code; editors only mutate the clip object which the session scheduler already reads.

**Tech Stack:** TypeScript, DOM API, existing CSS classes (`bcell`, `dcell`, `toggle`, `note-sel`, `num` from `_tracks.scss`), `DRUM_LANES`/`DrumVoice` from `src/core/drums.ts`, step types from `src/core/sequencer.ts`, `SessionClip`/`SessionLane` from `src/session/session.ts`.

---

## File Map

**New files:**
- `src/session/clip-editors/clip-editor-drum-bus.ts` — `renderDrumBusEditor(host, clip)` — renders 8-row drum grid
- `src/session/clip-editors/clip-editor-drum-lane.ts` — `renderDrumLaneEditor(host, clip)` — single drum row
- `src/session/clip-editors/clip-editor-bass-step.ts` — `renderBassStepEditor(host, clip, midiLabel)` — bass step row
- `src/session/clip-editors/clip-editor-poly-step.ts` — `renderPolyStepEditor(host, clip, midiLabel)` — poly step row
- `src/session/clip-editors/clip-editor-router.ts` — `renderClipEditor(host, lane, clip, deps)` — dispatches by type

**Modified files:**
- `src/session/session-inspector.ts` — add clipboard state + copy/paste buttons + auto-render editor on `openInspector()` + remove old "Open Piano Roll" button from code
- `index.html` — rename/remove `insp-open-roll` button, add `insp-copy`, `insp-paste-replace`, `insp-paste-layer` buttons

---

## Task 1: Create `clip-editor-drum-bus.ts`

**Files:**
- Create: `src/session/clip-editors/clip-editor-drum-bus.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/session/clip-editors/clip-editor-drum-bus.ts
// Renders a multi-row drum step grid for a drum-bus clip.
// Each row = one DRUM_LANE; each column = one 16th step.
// Click cycles: off → on → accent; Shift+click cycles roll factor.

import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import type { DrumStep } from '../../core/sequencer';
import type { SessionClip } from '../session';
import { cycleDrumStep, cycleDrumRoll, applyDrumCellState } from '../../classic/drum-cells';

export function renderDrumBusEditor(host: HTMLElement, clip: SessionClip): void {
  host.innerHTML = '';
  if (!clip.drumSteps) return;

  const steps = clip.lengthBars * 16;

  // Ensure all lanes exist in drumSteps
  for (const lane of DRUM_LANES) {
    if (!clip.drumSteps[lane]) {
      clip.drumSteps[lane] = Array.from({ length: steps }, () => ({ on: false, accent: false }));
    }
    // Ensure correct length
    while (clip.drumSteps[lane].length < steps) {
      clip.drumSteps[lane].push({ on: false, accent: false });
    }
  }

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  for (const lane of DRUM_LANES) {
    container.appendChild(buildDrumRow(lane, clip.drumSteps[lane], steps));
  }

  host.appendChild(container);
}

const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

function buildDrumRow(lane: DrumVoice, laneSteps: DrumStep[], totalSteps: number): HTMLElement {
  const row = document.createElement('div');
  row.className = `track drum-track ${lane}`;

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = LANE_LABELS[lane];
  row.appendChild(label);

  const cells = document.createElement('div');
  cells.className = 'cells';
  cells.style.setProperty('--steps', String(totalSteps));

  for (let i = 0; i < totalSteps; i++) {
    const step = laneSteps[i];
    const btn = document.createElement('button');
    btn.className = `dcell ${lane}`;
    if (i % 16 === 0 && i > 0) btn.classList.add('seg-start');
    if (i % 4 === 0) btn.classList.add('downbeat');
    applyDrumCellState(btn, step);

    btn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        cycleDrumRoll(step);
      } else {
        cycleDrumStep(step);
      }
      applyDrumCellState(btn, step);
    });

    cells.appendChild(btn);
  }

  row.appendChild(cells);
  return row;
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors (file has no imports that can fail yet since it's not imported anywhere).

---

## Task 2: Create `clip-editor-drum-lane.ts`

**Files:**
- Create: `src/session/clip-editors/clip-editor-drum-lane.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/session/clip-editors/clip-editor-drum-lane.ts
// Renders a single drum lane row for a drum-lane clip (expanded drum sub-lane).

import type { DrumVoice } from '../../core/drums';
import type { DrumStep } from '../../core/sequencer';
import type { SessionClip } from '../session';
import { cycleDrumStep, cycleDrumRoll, applyDrumCellState } from '../../classic/drum-cells';

const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

export function renderDrumLaneEditor(host: HTMLElement, clip: SessionClip): void {
  host.innerHTML = '';
  if (!clip.drumLane || !clip.drumLaneSteps) return;

  const lane = clip.drumLane;
  const steps = clip.lengthBars * 16;

  // Ensure correct length
  while (clip.drumLaneSteps.length < steps) {
    clip.drumLaneSteps.push({ on: false, accent: false });
  }

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  const row = document.createElement('div');
  row.className = `track drum-track ${lane}`;

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = LANE_LABELS[lane];
  row.appendChild(label);

  const cells = document.createElement('div');
  cells.className = 'cells';
  cells.style.setProperty('--steps', String(steps));

  const laneSteps: DrumStep[] = clip.drumLaneSteps;
  for (let i = 0; i < steps; i++) {
    const step = laneSteps[i];
    const btn = document.createElement('button');
    btn.className = `dcell ${lane}`;
    if (i % 16 === 0 && i > 0) btn.classList.add('seg-start');
    if (i % 4 === 0) btn.classList.add('downbeat');
    applyDrumCellState(btn, step);

    btn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        cycleDrumRoll(step);
      } else {
        cycleDrumStep(step);
      }
      applyDrumCellState(btn, step);
    });

    cells.appendChild(btn);
  }

  row.appendChild(cells);
  container.appendChild(row);
  host.appendChild(container);
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors.

---

## Task 3: Create `clip-editor-bass-step.ts`

**Files:**
- Create: `src/session/clip-editors/clip-editor-bass-step.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/session/clip-editors/clip-editor-bass-step.ts
// Renders a row of bass step cells for a bass-step clip.
// Matches the visual design of src/classic/bass-grid.ts but operates on
// clip.bassSteps directly instead of seq.bass[].

import type { BassStep } from '../../core/sequencer';
import type { SessionClip } from '../session';

export function renderBassStepEditor(
  host: HTMLElement,
  clip: SessionClip,
  midiLabel: (m: number) => string,
): void {
  host.innerHTML = '';
  if (!clip.bassSteps) return;

  const steps = clip.lengthBars * 16;

  // Ensure correct length
  while (clip.bassSteps.length < steps) {
    clip.bassSteps.push({ on: false, note: 36, accent: false, slide: false });
  }

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  const row = document.createElement('div');
  row.className = 'track bass-track';

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = 'BASS';
  row.appendChild(label);

  const cellsEl = document.createElement('div');
  cellsEl.className = 'cells bass-cells';
  cellsEl.style.setProperty('--steps', String(steps));

  const laneSteps: BassStep[] = clip.bassSteps;
  for (let i = 0; i < steps; i++) {
    const step = laneSteps[i];
    const cell = document.createElement('div');
    cell.className = 'bcell';
    if (i > 0 && i % 16 === 0) cell.classList.add('seg-start');

    const noteSel = document.createElement('select');
    noteSel.className = 'note-sel';
    for (let m = 24; m <= 60; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = midiLabel(m);
      if (m === step.note) opt.selected = true;
      noteSel.appendChild(opt);
    }
    noteSel.addEventListener('change', () => {
      step.note = parseInt(noteSel.value, 10);
    });

    const mkToggle = (lbl: string, key: 'on' | 'accent' | 'slide') => {
      const b = document.createElement('button');
      b.className = `toggle ${key}`;
      b.textContent = lbl;
      if (step[key]) b.classList.add('active');
      b.addEventListener('click', () => {
        step[key] = !step[key];
        b.classList.toggle('active', step[key]);
      });
      return b;
    };

    cell.appendChild(noteSel);
    cell.appendChild(mkToggle('●', 'on'));
    cell.appendChild(mkToggle('A', 'accent'));
    cell.appendChild(mkToggle('S', 'slide'));

    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1);
    cell.appendChild(num);

    cellsEl.appendChild(cell);
  }

  row.appendChild(cellsEl);
  container.appendChild(row);
  host.appendChild(container);
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors.

---

## Task 4: Create `clip-editor-poly-step.ts`

**Files:**
- Create: `src/session/clip-editors/clip-editor-poly-step.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/session/clip-editors/clip-editor-poly-step.ts
// Renders a row of poly step cells for a poly-step clip.
// Matches the visual design of src/classic/poly-step-row.ts but operates on
// clip.polySteps directly.

import type { PolyStep } from '../../core/sequencer';
import type { SessionClip } from '../session';

export function renderPolyStepEditor(
  host: HTMLElement,
  clip: SessionClip,
  midiLabel: (m: number) => string,
): void {
  host.innerHTML = '';
  if (!clip.polySteps) return;

  const steps = clip.lengthBars * 16;

  // Ensure correct length
  while (clip.polySteps.length < steps) {
    clip.polySteps.push({ on: false, notes: [60], accent: false, tie: false });
  }

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  const row = document.createElement('div');
  row.className = 'track melody-track';

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = 'POLY';
  row.appendChild(label);

  const cellsEl = document.createElement('div');
  cellsEl.className = 'cells melody-cells';
  cellsEl.style.setProperty('--steps', String(steps));

  const laneSteps: PolyStep[] = clip.polySteps;
  for (let i = 0; i < steps; i++) {
    const step = laneSteps[i];
    const cell = document.createElement('div');
    cell.className = 'bcell mcell';
    if (i > 0 && i % 16 === 0) cell.classList.add('seg-start');

    const noteSel = document.createElement('select');
    noteSel.className = 'note-sel';
    const rootNote = step.notes[0] ?? 60;
    for (let m = 36; m <= 84; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = midiLabel(m);
      if (m === rootNote) opt.selected = true;
      noteSel.appendChild(opt);
    }
    noteSel.addEventListener('change', () => {
      const newRoot = parseInt(noteSel.value, 10);
      const oldRoot = step.notes[0] ?? newRoot;
      const delta = newRoot - oldRoot;
      step.notes = step.notes.length === 0 ? [newRoot] : step.notes.map((n) => n + delta);
    });

    const chordBtn = document.createElement('button');
    chordBtn.className = 'toggle chord';
    const renderChord = () => {
      const n = step.notes.length === 4 ? 4 : step.notes.length === 3 ? 3 : 1;
      chordBtn.textContent = n === 1 ? '♪1' : n === 3 ? '♪3' : '♪4';
      chordBtn.classList.toggle('active', n > 1);
    };
    chordBtn.addEventListener('click', () => {
      const root = step.notes[0] ?? 60;
      const cur = step.notes.length === 4 ? 4 : step.notes.length === 3 ? 3 : 1;
      const next = cur === 1 ? 3 : cur === 3 ? 4 : 1;
      if (next === 1) step.notes = [root];
      else if (next === 3) step.notes = [root, root + 3, root + 7];
      else step.notes = [root, root + 3, root + 7, root + 10];
      renderChord();
    });
    renderChord();

    const mkToggle = (lbl: string, key: 'on' | 'accent' | 'tie') => {
      const b = document.createElement('button');
      b.className = `toggle ${key === 'tie' ? 'slide' : key}`;
      b.textContent = lbl;
      if (step[key]) b.classList.add('active');
      b.addEventListener('click', () => {
        step[key] = !step[key];
        b.classList.toggle('active', step[key]);
      });
      return b;
    };

    cell.appendChild(noteSel);
    cell.appendChild(mkToggle('●', 'on'));
    cell.appendChild(mkToggle('A', 'accent'));
    cell.appendChild(mkToggle('T', 'tie'));
    cell.appendChild(chordBtn);

    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1);
    cell.appendChild(num);

    cellsEl.appendChild(cell);
  }

  row.appendChild(cellsEl);
  container.appendChild(row);
  host.appendChild(container);
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors.

---

## Task 5: Create `clip-editor-router.ts`

**Files:**
- Create: `src/session/clip-editors/clip-editor-router.ts`

This is the dispatcher that detects clip type and calls the right renderer. For piano kinds it calls `createPianoRoll` with the same logic already in `session-inspector.ts`.

- [ ] **Step 1: Create the file**

```typescript
// src/session/clip-editors/clip-editor-router.ts
// Detects the kind of clip and dispatches to the appropriate editor renderer.

import type { SessionClip, SessionLane } from '../session';
import type { Sequencer } from '../../core/sequencer';
import type { LanePlayState } from '../session-runtime';
import { createPianoRoll, type PianoRollHandle } from '../../core/pianoroll';
import { TICKS_PER_STEP, type NoteEvent } from '../../core/notes';
import { renderDrumBusEditor } from './clip-editor-drum-bus';
import { renderDrumLaneEditor } from './clip-editor-drum-lane';
import { renderBassStepEditor } from './clip-editor-bass-step';
import { renderPolyStepEditor } from './clip-editor-poly-step';

export interface ClipEditorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  laneStates: Map<string, LanePlayState>;
  midiLabel: (m: number) => string;
}

/** Renders the appropriate editor into `host`, returns piano-roll handle if created (else null). */
export function renderClipEditor(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
): PianoRollHandle | null {
  host.innerHTML = '';

  // ── Drum-bus ──────────────────────────────────────────────────────────────
  if (lane.kind === 'drum-bus' && clip.drumSteps) {
    renderDrumBusEditor(host, clip);
    return null;
  }

  // ── Drum-lane ─────────────────────────────────────────────────────────────
  if (lane.kind === 'drum-lane' && clip.drumLane && clip.drumLaneSteps) {
    renderDrumLaneEditor(host, clip);
    return null;
  }

  // ── Bass step ─────────────────────────────────────────────────────────────
  if (lane.kind === 'bass' && clip.bassMode === 'step' && clip.bassSteps) {
    renderBassStepEditor(host, clip, deps.midiLabel);
    return null;
  }

  // ── Poly step ─────────────────────────────────────────────────────────────
  if (lane.kind === 'poly' && clip.polyMode === 'step' && clip.polySteps) {
    renderPolyStepEditor(host, clip, deps.midiLabel);
    return null;
  }

  // ── Bass piano-roll ───────────────────────────────────────────────────────
  if (lane.kind === 'bass' && (clip.bassMode === 'piano' || clip.bassNotes)) {
    return buildPianoRoll(host, lane, clip, deps, true);
  }

  // ── Poly piano-roll ───────────────────────────────────────────────────────
  if (lane.kind === 'poly' && (clip.polyMode === 'piano' || clip.polyNotes)) {
    return buildPianoRoll(host, lane, clip, deps, false);
  }

  // Fallback: nothing to render
  const msg = document.createElement('p');
  msg.style.cssText = 'color:#888;font-size:12px;padding:8px';
  msg.textContent = 'No editor available for this clip type.';
  host.appendChild(msg);
  return null;
}

function buildPianoRoll(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
  isBass: boolean,
): PianoRollHandle {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(800, clip.lengthBars * 240);
  canvas.height = 240;
  canvas.style.height = '240px';
  canvas.style.width = `${canvas.width}px`;
  host.appendChild(canvas);

  const getNotes = (): NoteEvent[] => isBass ? (clip.bassNotes ?? []) : (clip.polyNotes ?? []);
  const setNotes = (notes: NoteEvent[]) => {
    if (isBass) clip.bassNotes = notes;
    else        clip.polyNotes = notes;
  };

  const { ctx, seq, laneStates } = deps;
  return createPianoRoll({
    canvas,
    getNotes,
    setNotes,
    patternTicks: clip.lengthBars * 16 * TICKS_PER_STEP,
    minMidi: isBass ? 24 : 36,
    maxMidi: isBass ? 60 : 96,
    onChange: () => {},
    getPlayheadTick: () => {
      const lp = laneStates.get(lane.id);
      if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
      const now = ctx.currentTime;
      const stepDur = 60 / seq.bpm / 4;
      const stepsElapsed = Math.max(0, (now - lp.startTime) / stepDur);
      const clipSteps = clip.lengthBars * 16;
      return (stepsElapsed % clipSteps) * TICKS_PER_STEP;
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors.

---

## Task 6: Wire router into `session-inspector.ts` + auto-render on open

**Files:**
- Modify: `src/session/session-inspector.ts`

Changes:
1. Import `renderClipEditor` and `ClipEditorDeps` from the router.
2. Add `midiLabel` to `InspectorDeps`.
3. Remove the `openPianoRoll` method (logic moves into router).
4. In `openInspector()`: call `renderClipEditor` to auto-populate `insp-roll-host`.
5. Wire `insp-open-roll` button (renamed in HTML) to re-call `openInspector` (or keep for refresh).

The full new `session-inspector.ts` content:

```typescript
// Session inspector panel + per-clip editor.
// Manages the clip detail panel (name, length, quantize, duplicate, delete)
// and the embedded clip editor (piano roll, step grids, drum grids).

import type { SessionState, SessionClip } from './session';
import type { LanePlayState } from './session-runtime';
import type { Sequencer } from '../core/sequencer';
import { renderClipEditor, type ClipEditorDeps } from './clip-editors/clip-editor-router';
import type { PianoRollHandle } from '../core/pianoroll';

export interface InspectorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  state: SessionState;
  laneStates: Map<string, LanePlayState>;
  renderWithMixer: () => void;
  midiLabel: (m: number) => string;
}

export class SessionInspector {
  roll: PianoRollHandle | null = null;
  private selectedClip: { laneId: string; clipIdx: number } | null = null;

  constructor(private deps: InspectorDeps) {}

  getSelectedClip(): { laneId: string; clipIdx: number } | null {
    return this.selectedClip;
  }

  setSelectedClip(sel: { laneId: string; clipIdx: number } | null): void {
    this.selectedClip = sel;
  }

  openInspector(): void {
    const panel = document.getElementById('session-inspector');
    if (!panel || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!clip) { panel.hidden = true; return; }
    panel.hidden = false;

    const nameEl = document.getElementById('insp-name') as HTMLInputElement;
    const lenEl  = document.getElementById('insp-length') as HTMLInputElement;
    const qEl    = document.getElementById('insp-quantize') as HTMLSelectElement;

    nameEl.value = clip.name ?? '';
    lenEl.value  = String(clip.lengthBars);
    qEl.value    = clip.launchQuantize ?? '';

    nameEl.oninput = () => { clip.name = nameEl.value || undefined; this.deps.renderWithMixer(); };
    lenEl.oninput  = () => { clip.lengthBars = Math.max(1, parseInt(lenEl.value, 10) || 1); };
    qEl.onchange   = () => {
      clip.launchQuantize = (qEl.value || undefined) as import('./session').LaunchQuantize | undefined;
    };

    document.getElementById('insp-duplicate')!.onclick = () => {
      if (!this.selectedClip) return;
      const ln = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId)!;
      const dup: SessionClip = JSON.parse(JSON.stringify(clip));
      dup.id = `clip-${Date.now().toString(36)}`;
      dup.name = (clip.name ?? '') + ' copy';
      ln.clips.push(dup);
      this.deps.renderWithMixer();
    };
    document.getElementById('insp-delete')!.onclick = () => {
      if (!this.selectedClip) return;
      const ln = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId)!;
      ln.clips[this.selectedClip.clipIdx] = null;
      panel.hidden = true;
      this.selectedClip = null;
      this.deps.renderWithMixer();
    };

    // Copy / paste
    document.getElementById('insp-copy')!.onclick = () => {
      clipClipboard = JSON.parse(JSON.stringify(clip)) as SessionClip;
      updatePasteBtnState();
    };
    document.getElementById('insp-paste-replace')!.onclick = () => this.pasteReplace();
    document.getElementById('insp-paste-layer')!.onclick   = () => this.pasteLayer();
    updatePasteBtnState();

    // Auto-render editor
    this.renderEditor();
  }

  private renderEditor(): void {
    const host = document.getElementById('insp-roll-host');
    if (!host || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;

    const editorDeps: ClipEditorDeps = {
      ctx: this.deps.ctx,
      seq: this.deps.seq,
      laneStates: this.deps.laneStates,
      midiLabel: this.deps.midiLabel,
    };

    this.roll = renderClipEditor(host, lane, clip, editorDeps);
  }

  // ── Copy / paste ───────────────────────────────────────────────────────────

  private pasteReplace(): void {
    if (!clipClipboard || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;

    const src = clipClipboard;

    // Cross-kind guard: drum → poly is disallowed
    if ((src.drumSteps || src.drumLaneSteps) && lane.kind === 'poly') {
      alert('Cannot paste drum clip into a poly lane');
      return;
    }

    const dst = clip;

    // Replace content fields based on target lane kind
    if (lane.kind === 'drum-bus' && src.drumSteps) {
      dst.drumSteps = JSON.parse(JSON.stringify(src.drumSteps));
    } else if (lane.kind === 'drum-lane' && src.drumLane && src.drumLaneSteps) {
      dst.drumLaneSteps = JSON.parse(JSON.stringify(src.drumLaneSteps));
    } else if (lane.kind === 'drum-bus' && src.drumLane && src.drumLaneSteps && src.drumLane) {
      // drum-lane → drum-bus: put steps at the matching slot
      if (!dst.drumSteps) dst.drumSteps = {} as import('./session').SessionClip['drumSteps'] & {};
      dst.drumSteps![src.drumLane] = JSON.parse(JSON.stringify(src.drumLaneSteps));
    } else if (lane.kind === 'drum-lane' && src.drumSteps && clip.drumLane) {
      // drum-bus → drum-lane: use that lane's steps
      const laneSteps = src.drumSteps[clip.drumLane];
      if (laneSteps) dst.drumLaneSteps = JSON.parse(JSON.stringify(laneSteps));
    } else if (lane.kind === 'bass' && (src.bassNotes || src.bassSteps)) {
      if (clip.bassMode === 'piano') {
        // bass-piano → bass-piano, OR poly-piano → bass-piano (clamp midi)
        const notes: import('../core/notes').NoteEvent[] =
          src.bassNotes
            ? JSON.parse(JSON.stringify(src.bassNotes))
            : src.polyNotes
              ? JSON.parse(JSON.stringify(src.polyNotes))
              : [];
        for (const n of notes) n.midi = Math.max(24, Math.min(60, n.midi));
        dst.bassNotes = notes;
      } else {
        dst.bassSteps = JSON.parse(JSON.stringify(src.bassSteps ?? []));
      }
    } else if (lane.kind === 'poly' && (src.polyNotes || src.polySteps || src.bassNotes)) {
      if (clip.polyMode === 'piano') {
        dst.polyNotes = JSON.parse(JSON.stringify(src.polyNotes ?? src.bassNotes ?? []));
      } else {
        dst.polySteps = JSON.parse(JSON.stringify(src.polySteps ?? []));
      }
    }

    this.renderEditor();
    this.deps.renderWithMixer();
  }

  private pasteLayer(): void {
    if (!clipClipboard || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;

    const src = clipClipboard;

    if ((src.drumSteps || src.drumLaneSteps) && lane.kind === 'poly') {
      alert('Cannot paste drum clip into a poly lane');
      return;
    }

    // Layer (additive merge) per kind
    if (lane.kind === 'drum-bus' && clip.drumSteps && src.drumSteps) {
      import('../../core/drums').then(({ DRUM_LANES }) => {
        for (const dl of DRUM_LANES) {
          const srcLane = src.drumSteps![dl];
          const dstLane = clip.drumSteps![dl];
          if (!srcLane || !dstLane) continue;
          for (let i = 0; i < Math.min(srcLane.length, dstLane.length); i++) {
            if (srcLane[i].on) {
              dstLane[i].on = true;
              if (srcLane[i].accent) dstLane[i].accent = true;
            }
          }
        }
        this.renderEditor();
        this.deps.renderWithMixer();
      });
      return;
    }

    if (lane.kind === 'drum-lane' && clip.drumLaneSteps && src.drumLaneSteps) {
      const s = src.drumLaneSteps;
      const d = clip.drumLaneSteps;
      for (let i = 0; i < Math.min(s.length, d.length); i++) {
        if (s[i].on) { d[i].on = true; if (s[i].accent) d[i].accent = true; }
      }
    } else if (lane.kind === 'bass') {
      if (clip.bassMode === 'piano' && clip.bassNotes) {
        clip.bassNotes = [...clip.bassNotes, ...JSON.parse(JSON.stringify(src.bassNotes ?? src.polyNotes ?? []))];
      } else if (clip.bassMode === 'step' && clip.bassSteps && src.bassSteps) {
        const s = src.bassSteps;
        const d = clip.bassSteps;
        for (let i = 0; i < Math.min(s.length, d.length); i++) {
          if (s[i].on) { d[i].on = true; d[i].note = s[i].note; if (s[i].accent) d[i].accent = true; if (s[i].slide) d[i].slide = true; }
        }
      }
    } else if (lane.kind === 'poly') {
      if (clip.polyMode === 'piano' && clip.polyNotes) {
        clip.polyNotes = [...clip.polyNotes, ...JSON.parse(JSON.stringify(src.polyNotes ?? src.bassNotes ?? []))];
      } else if (clip.polyMode === 'step' && clip.polySteps && src.polySteps) {
        const s = src.polySteps;
        const d = clip.polySteps;
        for (let i = 0; i < Math.min(s.length, d.length); i++) {
          if (s[i].on) {
            d[i].on = true;
            for (const n of s[i].notes) if (!d[i].notes.includes(n)) d[i].notes.push(n);
            if (s[i].accent) d[i].accent = true;
          }
        }
      }
    }

    this.renderEditor();
    this.deps.renderWithMixer();
  }
}

// ── Module-level clipboard ─────────────────────────────────────────────────
let clipClipboard: SessionClip | null = null;

function updatePasteBtnState(): void {
  const hasClip = clipClipboard !== null;
  const pasteR = document.getElementById('insp-paste-replace') as HTMLButtonElement | null;
  const pasteL = document.getElementById('insp-paste-layer')   as HTMLButtonElement | null;
  if (pasteR) pasteR.disabled = !hasClip;
  if (pasteL) pasteL.disabled = !hasClip;
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors. If there are type errors in pasteReplace dynamic import block, see step 3.

- [ ] **Step 3: Fix dynamic import in `pasteLayer`**

The `import('../../core/drums')` dynamic import for `DRUM_LANES` inside `pasteLayer` is awkward (async in a sync method). Replace it with a static import at the top of the file instead:

Add to the top of `session-inspector.ts`:
```typescript
import { DRUM_LANES } from '../core/drums';
```

And replace the dynamic import block in `pasteLayer` with a direct synchronous loop using the statically imported `DRUM_LANES`.

The pasteLayer drum-bus section should be:
```typescript
if (lane.kind === 'drum-bus' && clip.drumSteps && src.drumSteps) {
  for (const dl of DRUM_LANES) {
    const srcLane = src.drumSteps[dl];
    const dstLane = clip.drumSteps[dl];
    if (!srcLane || !dstLane) continue;
    for (let i = 0; i < Math.min(srcLane.length, dstLane.length); i++) {
      if (srcLane[i].on) {
        dstLane[i].on = true;
        if (srcLane[i].accent) dstLane[i].accent = true;
      }
    }
  }
  this.renderEditor();
  this.deps.renderWithMixer();
  return;
}
```

- [ ] **Step 4: Typecheck again**

```
npx tsc --noEmit
```

Expected: 0 errors.

---

## Task 7: Update `session-host.ts` to pass `midiLabel` to inspector

**Files:**
- Modify: `src/session/session-host.ts`

The `InspectorDeps` now requires `midiLabel`. Add it to the `SessionHostDeps` interface and pass it through.

- [ ] **Step 1: Add `midiLabel` to `SessionHostDeps`**

In `src/session/session-host.ts`, add to the `SessionHostDeps` interface:
```typescript
midiLabel: (m: number) => string;
```

- [ ] **Step 2: Pass `midiLabel` when constructing the inspector**

In `SessionHost.init()`, update the `new SessionInspector({...})` call to include:
```typescript
midiLabel: this.deps.midiLabel,
```

- [ ] **Step 3: Typecheck**

```
npx tsc --noEmit
```

Expected: error about `midiLabel` missing in `main.ts` where `SessionHost` is constructed. Fix in next task.

---

## Task 8: Pass `midiLabel` from `main.ts` to `SessionHost`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Find where `SessionHost` is constructed in `main.ts`**

Search for `new SessionHost(` and add `midiLabel` to the deps object passed in:
```typescript
midiLabel,
```

`midiLabel` is already defined in `main.ts` at line 250:
```typescript
const midiLabel = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors.

---

## Task 9: Update `index.html` — replace "Open Piano Roll" button, add copy/paste buttons

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the inspector button row**

Find this section in `index.html`:
```html
<button class="rnd" id="insp-open-roll">Open Piano Roll</button>
<button class="rnd" id="insp-duplicate">Duplicate</button>
<button class="rnd" id="insp-delete">Delete</button>
```

Replace with:
```html
<button class="rnd" id="insp-copy">Copy Clip</button>
<button class="rnd" id="insp-paste-replace" disabled>Paste (Replace)</button>
<button class="rnd" id="insp-paste-layer" disabled>Paste (Layer)</button>
<button class="rnd" id="insp-duplicate">Duplicate</button>
<button class="rnd" id="insp-delete">Delete</button>
```

Note: `insp-open-roll` is removed since the editor auto-renders on inspector open. If code still references that ID it should be cleaned up.

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors. (There may be a TS warning if any `.ts` file still accesses `insp-open-roll` via `getElementById` — clean that up.)

---

## Task 10: Remove dead `insp-open-roll` reference from inspector code

**Files:**
- Modify: `src/session/session-inspector.ts`

The old code had:
```typescript
document.getElementById('insp-open-roll')!.onclick = () => this.openPianoRoll();
```

This was already removed when we rewrote the file in Task 6. Confirm it is gone. Also remove the old `openPianoRoll()` method (it was replaced by the router).

- [ ] **Step 1: Verify the method is gone and no dead references exist**

```
npx tsc --noEmit
```

Expected: 0 errors.

---

## Task 11: Build check

- [ ] **Step 1: Run typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Run build**

```
npm run build
```

Expected: build succeeds with no errors.

---

## Task 12: Manual smoke test checklist

- [ ] Open the app in browser (`npm run dev` → http://localhost:5173)
- [ ] Switch to Session view.
- [ ] Click an empty drum-bus cell → creates clip → inspector opens → drum grid renders immediately (no button click needed).
- [ ] Click drum cells to toggle on/accent. Shift+click to cycle roll.
- [ ] Click an empty bass cell → creates clip with `bassMode: 'piano'` → piano roll renders.
- [ ] Click "Copy Clip" — clipboard is set.
- [ ] Click another clip → "Paste (Replace)" and "Paste (Layer)" become enabled.
- [ ] Paste Replace: target clip content is overwritten.
- [ ] Paste Layer: target clip content is merged (steps OR, notes concat).
- [ ] Cross-kind guard: copy drum clip → select poly clip → Paste Replace shows alert.

---

## Task 13: Commit Feature 1 (Clip Editors)

- [ ] **Step 1: Stage and commit**

```bash
git add \
  src/session/clip-editors/clip-editor-drum-bus.ts \
  src/session/clip-editors/clip-editor-drum-lane.ts \
  src/session/clip-editors/clip-editor-bass-step.ts \
  src/session/clip-editors/clip-editor-poly-step.ts \
  src/session/clip-editors/clip-editor-router.ts \
  src/session/session-inspector.ts \
  src/session/session-host.ts \
  src/main.ts \
  index.html

git commit -m "feat(session): add type-aware clip editors in inspector (drum/bass/poly step grids)"
```

---

## Task 14: Commit Feature 2 (Copy/Paste)

The copy/paste logic is already in `session-inspector.ts` from Task 6. If commits were done per-task, amend or separate. Otherwise:

- [ ] **Step 1: Verify everything is committed**

```bash
git status
```

Expected: clean working tree.

- [ ] **Step 2: If copy/paste was in same commit, it's fine — they're logically inseparable from the inspector rewrite. Both features can live in one commit or two separate ones at your discretion.**

If separating: cherry-pick the HTML changes + copy/paste-specific methods into a second commit:

```bash
git add index.html
git commit -m "feat(session): add copy/paste clipboard for clips (Replace + Layer modes)"
```

---

## Self-Review Notes

### Spec coverage check

| Requirement | Task |
|---|---|
| Drum-bus editor (multi-row grid, click cycles off→on→accent, shift+click roll) | Task 1 |
| Drum-lane editor (single row) | Task 2 |
| Bass-step editor (note sel + on/accent/slide) | Task 3 |
| Poly-step editor (note sel + chord + on/accent/tie) | Task 4 |
| Router dispatches by type | Task 5 |
| Piano-roll cases stay in router | Task 5 |
| Auto-render on inspector open (no button) | Task 6 |
| Remove "Open Piano Roll" button | Task 9 |
| Copy/Paste UI (3 buttons) | Tasks 6 + 9 |
| `clipClipboard` module-level variable | Task 6 |
| Paste Replace semantics | Task 6 |
| Paste Layer semantics | Task 6 |
| Cross-kind guard (drum → poly alert) | Task 6 |
| Cross-kind: bass→poly/poly→bass notes | Task 6 |
| Cross-kind: drum-bus↔drum-lane | Task 6 |
| Enabled/disabled state for paste buttons | Task 6 |
| `midiLabel` wired through deps | Tasks 7 + 8 |
| Typecheck passes | Tasks 2, 3, 4, 5, 7, 8, 11 |
| Build passes | Task 11 |
| Each file ≤ 300 lines | All tasks (checked inline) |

### Type consistency check

- `SessionClip` from `src/session/session.ts` — used consistently across all editors
- `DrumVoice` and `DRUM_LANES` from `src/core/drums.ts` — consistently imported
- `BassStep`, `DrumStep`, `PolyStep` from `src/core/sequencer.ts` — consistently typed
- `cycleDrumStep`, `cycleDrumRoll`, `applyDrumCellState` from `src/classic/drum-cells.ts` — reused (no duplicates)
- `ClipEditorDeps` defined in `clip-editor-router.ts`, referenced in `session-inspector.ts`
- `InspectorDeps.midiLabel` added consistently in Tasks 6, 7, 8

### Potential issues

1. **`pasteReplace` type narrowing**: The `dst.drumSteps!` non-null assertion requires `clip.drumSteps` to exist. The code sets it on the `else if` branch where `lane.kind === 'drum-lane'` source goes to drum-bus. Review that branch carefully — it may need `if (!dst.drumSteps) dst.drumSteps = {} as ...` before assigning. ✓ Already added in Task 6 code.

2. **`DrumStep[]` record partial init**: `emptyClip()` in `session.ts` creates `drumSteps = {} as Record<DrumVoice, DrumStep[]>` — all lanes are empty. The `renderDrumBusEditor` fills them in. This is intentional.

3. **Piano-roll handle in `SessionHost.startRenderTick`**: The tick loop calls `this.inspector.roll.redraw()` — this still works since `roll` is set to the return value of `renderClipEditor` for piano types, and null for step editors (`.redraw` won't be called on null due to `?.` or need `if`). Check the existing call:
   ```typescript
   if (this.inspector.roll) this.inspector.roll.redraw();
   ```
   This is safe — `this.inspector.roll` is already guarded.
