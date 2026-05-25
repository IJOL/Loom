# Classic-Mode Track Rendering Extraction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract ~700 lines of Classic-mode track rendering from `src/main.ts` into a new `src/classic/` subdirectory, each file ≤300 lines, with no behavior changes.

**Architecture:** A shared `classicState` object in `src/classic/classic-state.ts` holds all previously-`let` variables and cell maps. A `ClassicDeps` interface carries external references (seq, bank, polysynth, etc.) passed once at boot. Each module exports pure functions that receive deps + read/write classicState. `main.ts` builds the deps object once and calls a single `wireClassicUI(deps)` entry point.

**Tech Stack:** TypeScript, Vite, Web Audio API (no new deps — zero runtime behavior change)

---

## File Map

| File | Responsibility | Approx lines |
|------|---------------|-------------|
| `src/classic/classic-state.ts` | Shared mutable state + interface types | ~60 |
| `src/classic/piano-roll-helper.ts` | `addPianoRollFor`, `rangeForNotes`, `autoScrollRoll` | ~80 |
| `src/classic/drum-cells.ts` | `cycleDrumStep`, `cycleDrumRoll`, `applyDrumCellState`, `refreshAllCellsFromState` | ~70 |
| `src/classic/bass-grid.ts` | `renderBassStepGrid` | ~80 |
| `src/classic/poly-step-row.ts` | `renderMainPolyStepRow` | ~100 |
| `src/classic/poly-track-area.ts` | `rebuildPolyTrack` | ~80 |
| `src/classic/rolls-view.ts` | `rebuildRollsView` | ~60 |
| `src/classic/synth-tabs.ts` | `rebuildSynthTabs`, `setCurrentSynthLane` | ~80 |
| `src/classic/poly-target.ts` | `setActivePolyTarget`, `ensureExtraTrack`, `refreshPolyTargetSelect`, `wirePolyTargetSelect` | ~100 |
| `src/classic/classic-tracks.ts` | `rebuildTracks` orchestrator + `visibleRange` + `updatePager` + `wireClassicUI` | ~120 |
| `src/main.ts` | Remove all moved code; import + call `wireClassicUI` | net ~-700 lines |

---

## Shared State Design

All previously-`let` variables and cell maps migrate to a single exported object in `classic-state.ts`:

```ts
// src/classic/classic-state.ts
export interface RollEntry {
  handle: PianoRollHandle;
  scrollEl: HTMLElement;
  canvasEl: HTMLCanvasElement;
}

export interface BassCellRefs {
  el: HTMLDivElement;
  noteSel: HTMLSelectElement;
  onBtn: HTMLButtonElement;
  accentBtn: HTMLButtonElement;
  slideBtn: HTMLButtonElement;
}

export interface MelodyCellRefs {
  el: HTMLDivElement;
  noteSel: HTMLSelectElement;
  onBtn: HTMLButtonElement;
  accentBtn: HTMLButtonElement;
  tieBtn: HTMLButtonElement;
  chordBtn: HTMLButtonElement;
}

export const classicState = {
  bassCells:        {} as Record<number, BassCellRefs>,
  melodyCells:      {} as Record<number, MelodyCellRefs>,
  drumCells:        {
    kick: {}, snare: {}, closedHat: {}, openHat: {},
    clap: {}, cowbell: {}, tom: {}, ride: {},
  } as Record<DrumVoice, Record<number, HTMLButtonElement>>,
  mainRollEntry:    null as RollEntry | null,
  bassRollEntry:    null as RollEntry | null,
  extraRolls:       new Map<string, RollEntry>(),
  pianoRoll:        null as PianoRollHandle | null,
  viewStart:        0,
  currentSynthLane: 'main' as string,
  activePolyTarget: null as PolySynth | null,   // set at boot
};
```

`ClassicDeps` carries everything that lives in `main.ts` scope:

```ts
export interface ClassicDeps {
  seq: Sequencer;
  bank: PatternBank;
  polysynth: PolySynth;
  extraPolys: Partial<Record<ExtraId, PolySynth>>;
  extraStrips: Partial<Record<ExtraId, ChannelStrip>>;
  ensureExtraPoly: (id: ExtraId) => PolySynth;
  extraPolyIds: readonly ExtraId[];
  laneLabels: Record<string, string>;
  bassTracksEl: HTMLDivElement;
  drumTracksEl: HTMLDivElement;
  polyTracksEl: HTMLDivElement;
  VIEW_SIZE: number;
  midiLabel: (m: number) => string;
  setBassMode: (mode: 'step' | 'piano') => void;
  refreshPolyKnobsFromState: () => void;
  refreshPolyPresetSelect: () => void;
  setActiveEngineLane: (laneId: string) => void;
  rebuildMixer: () => void;
  buildArpUI: (opts: { getExtraPolyTracks: () => PolyTrack[] }) => void;
}
```

---

## Task 1: Create `src/classic/` directory and `classic-state.ts`

**Files:**
- Create: `src/classic/classic-state.ts`

- [ ] **Step 1.1: Create the directory and state file**

Create `src/classic/classic-state.ts` with exact content:

```ts
import type { PianoRollHandle } from '../core/pianoroll';
import type { PolySynth } from '../polysynth/polysynth';
import type { DrumVoice } from '../core/drums';
import type { Sequencer } from '../core/sequencer';
import type { PatternBank, PolyTrack } from '../core/pattern';
import type { ChannelStrip } from '../core/fx';

export type ExtraId =
  | 'poly1' | 'poly2' | 'poly3' | 'poly4' | 'poly5' | 'poly6' | 'poly7' | 'poly8'
  | 'poly9' | 'poly10' | 'poly11' | 'poly12' | 'poly13' | 'poly14' | 'poly15' | 'poly16';

export const EXTRA_IDS: ExtraId[] = [
  'poly1','poly2','poly3','poly4','poly5','poly6','poly7','poly8',
  'poly9','poly10','poly11','poly12','poly13','poly14','poly15','poly16',
];

export interface RollEntry {
  handle: PianoRollHandle;
  scrollEl: HTMLElement;
  canvasEl: HTMLCanvasElement;
}

export interface BassCellRefs {
  el: HTMLDivElement;
  noteSel: HTMLSelectElement;
  onBtn: HTMLButtonElement;
  accentBtn: HTMLButtonElement;
  slideBtn: HTMLButtonElement;
}

export interface MelodyCellRefs {
  el: HTMLDivElement;
  noteSel: HTMLSelectElement;
  onBtn: HTMLButtonElement;
  accentBtn: HTMLButtonElement;
  tieBtn: HTMLButtonElement;
  chordBtn: HTMLButtonElement;
}

export const classicState = {
  bassCells:        {} as Record<number, BassCellRefs>,
  melodyCells:      {} as Record<number, MelodyCellRefs>,
  drumCells: {
    kick: {}, snare: {}, closedHat: {}, openHat: {},
    clap: {}, cowbell: {}, tom: {}, ride: {},
  } as Record<DrumVoice, Record<number, HTMLButtonElement>>,
  mainRollEntry:    null as RollEntry | null,
  bassRollEntry:    null as RollEntry | null,
  extraRolls:       new Map<string, RollEntry>(),
  pianoRoll:        null as PianoRollHandle | null,
  viewStart:        0,
  currentSynthLane: 'main' as string,
  activePolyTarget: null as PolySynth | null,
};

export interface ClassicDeps {
  seq: Sequencer;
  bank: PatternBank;
  polysynth: PolySynth;
  extraPolys: Partial<Record<ExtraId, PolySynth>>;
  extraStrips: Partial<Record<ExtraId, ChannelStrip>>;
  ensureExtraPoly: (id: ExtraId) => PolySynth;
  extraPolyIds: readonly ExtraId[];
  laneLabels: Record<string, string>;
  bassTracksEl: HTMLDivElement;
  drumTracksEl: HTMLDivElement;
  polyTracksEl: HTMLDivElement;
  VIEW_SIZE: number;
  midiLabel: (m: number) => string;
  setBassMode: (mode: 'step' | 'piano') => void;
  refreshPolyKnobsFromState: () => void;
  refreshPolyPresetSelect: () => void;
  setActiveEngineLane: (laneId: string) => void;
  rebuildMixer: () => void;
  buildArpUI: (opts: { getExtraPolyTracks: () => PolyTrack[] }) => void;
}
```

- [ ] **Step 1.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes (main.ts still has all original code; new file is just types/state, not imported yet)

---

## Task 2: Create `src/classic/piano-roll-helper.ts`

**Files:**
- Create: `src/classic/piano-roll-helper.ts`
- No changes to `main.ts` yet

- [ ] **Step 2.1: Create the file**

```ts
import { createPianoRoll } from '../core/pianoroll';
import { TICKS_PER_STEP, patternTicks as ptTicks, type NoteEvent } from '../core/notes';
import type { ClassicDeps, RollEntry } from './classic-state';

export function rangeForNotes(notes: NoteEvent[]): { lo: number; hi: number } {
  if (notes.length === 0) return { lo: 48, hi: 72 };
  let lo = Infinity, hi = -Infinity;
  for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
  let pLo = Math.max(0, lo - 2);
  let pHi = Math.min(127, hi + 2);
  if (pHi - pLo < 12) {
    const center = Math.floor((pLo + pHi) / 2);
    pLo = Math.max(0, center - 6);
    pHi = Math.min(127, pLo + 12);
  }
  return { lo: pLo, hi: pHi };
}

export function autoScrollRoll(entry: RollEntry, deps: ClassicDeps) {
  if (!deps.seq.isPlaying()) return;
  const playTick = deps.seq.currentPlayPosition() * TICKS_PER_STEP;
  const playX = (playTick / ptTicks(deps.seq.length)) * entry.canvasEl.width;
  const sw = entry.scrollEl;
  const visW = sw.clientWidth;
  if (playX > sw.scrollLeft + visW * 0.7 || playX < sw.scrollLeft) {
    sw.scrollLeft = Math.max(0, playX - visW * 0.3);
  }
}

export function addPianoRollFor(
  opts: {
    parent: HTMLElement;
    labelText: string;
    height?: number;
    getNotes: () => NoteEvent[];
    setNotes: (notes: NoteEvent[]) => void;
    trailingControls?: HTMLElement;
    onLabelClick?: () => void;
    trackId?: string;
  },
  deps: ClassicDeps,
): RollEntry {
  const wrap = document.createElement('div');
  wrap.className = 'track melody-track piano-roll-wrap';
  const label = document.createElement('div');
  label.className = 'track-label';
  label.dataset.polyTarget = opts.labelText;
  if (opts.trackId) label.dataset.trackId = opts.trackId;
  const labelText = document.createElement('span');
  labelText.textContent = opts.labelText;
  label.appendChild(labelText);
  if (opts.onLabelClick) {
    label.style.cursor = 'pointer';
    label.title = 'Click to edit this synth';
    label.addEventListener('click', () => opts.onLabelClick?.());
  }
  if (opts.trailingControls) {
    label.style.display = 'flex';
    label.style.flexDirection = 'column';
    label.style.gap = '4px';
    label.style.justifyContent = 'center';
    label.appendChild(opts.trailingControls);
  }
  wrap.appendChild(label);

  const { lo, hi } = rangeForNotes(opts.getNotes());
  const rows = hi - lo + 1;
  const ROW_PX = 10;
  const height = opts.height ?? Math.min(360, Math.max(140, rows * ROW_PX));

  const PX_PER_STEP = 6;
  const canvasWidth = Math.max(1024, deps.seq.length * PX_PER_STEP);
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'piano-roll-scroll';
  const canvas = document.createElement('canvas');
  canvas.className = 'piano-roll-canvas';
  canvas.width = canvasWidth;
  canvas.height = height;
  canvas.style.height = `${height}px`;
  canvas.style.width = `${canvasWidth}px`;
  scrollWrap.appendChild(canvas);
  wrap.appendChild(scrollWrap);
  opts.parent.appendChild(wrap);

  const handle = createPianoRoll({
    canvas,
    patternTicks: ptTicks(deps.seq.length),
    getNotes: opts.getNotes,
    setNotes: opts.setNotes,
    minMidi: lo,
    maxMidi: hi,
    onChange: () => {},
    getPlayheadTick: () =>
      deps.seq.isPlaying() ? deps.seq.currentPlayPosition() * TICKS_PER_STEP : -1,
  });
  return { handle, scrollEl: scrollWrap, canvasEl: canvas };
}
```

- [ ] **Step 2.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes (file is created but not yet imported from anywhere — no breaking changes)

---

## Task 3: Create `src/classic/drum-cells.ts`

**Files:**
- Create: `src/classic/drum-cells.ts`

- [ ] **Step 3.1: Create the file**

```ts
import { DRUM_LANES, type DrumVoice, type DrumStep } from '../core/drums';
import { classicState } from './classic-state';
import type { ClassicDeps } from './classic-state';

export function cycleDrumStep(s: DrumStep): void {
  if (!s.on) { s.on = true; s.accent = false; }
  else if (!s.accent) { s.accent = true; }
  else { s.on = false; s.accent = false; s.roll = 0; }
}

export function cycleDrumRoll(s: DrumStep): void {
  if (!s.on) { s.on = true; s.accent = false; }
  const cur = s.roll ?? 0;
  s.roll = cur === 0 ? 2 : cur === 2 ? 4 : 0;
}

export function applyDrumCellState(b: HTMLButtonElement, s: DrumStep): void {
  b.classList.toggle('on', s.on && !s.accent);
  b.classList.toggle('accent', s.on && s.accent);
  b.classList.toggle('roll-2', !!s.on && s.roll === 2);
  b.classList.toggle('roll-4', !!s.on && s.roll === 4);
}

export function refreshAllCellsFromState(deps: ClassicDeps): void {
  const { viewStart, bassCells, melodyCells, drumCells } = classicState;
  const { VIEW_SIZE, seq } = deps;
  const start = viewStart;
  const end = Math.min(viewStart + VIEW_SIZE, seq.length);

  for (let i = start; i < end; i++) {
    const c = bassCells[i];
    if (c) {
      const step = seq.bass[i];
      c.noteSel.value = String(step.note);
      c.onBtn.classList.toggle('active', step.on);
      c.accentBtn.classList.toggle('active', step.accent);
      c.slideBtn.classList.toggle('active', step.slide);
    }
    const mc = melodyCells[i];
    if (mc) {
      const mstep = seq.melody[i];
      mc.noteSel.value = String(mstep.notes[0] ?? 60);
      mc.onBtn.classList.toggle('active', mstep.on);
      mc.accentBtn.classList.toggle('active', mstep.accent);
      mc.tieBtn.classList.toggle('active', mstep.tie);
      const n = mstep.notes.length === 4 ? 4 : mstep.notes.length === 3 ? 3 : 1;
      mc.chordBtn.textContent = n === 1 ? '♪1' : n === 3 ? '♪3' : '♪4';
      mc.chordBtn.classList.toggle('active', n > 1);
    }
    for (const lane of DRUM_LANES) {
      const b = (drumCells as Record<DrumVoice, Record<number, HTMLButtonElement>>)[lane][i];
      if (b) applyDrumCellState(b, seq.drums[lane][i]);
    }
  }
}
```

- [ ] **Step 3.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes

---

## Task 4: Create `src/classic/bass-grid.ts`

**Files:**
- Create: `src/classic/bass-grid.ts`

- [ ] **Step 4.1: Create the file**

```ts
import { classicState } from './classic-state';
import type { ClassicDeps } from './classic-state';

export function renderBassStepGrid(start: number, end: number, deps: ClassicDeps): void {
  const { seq, bassTracksEl, laneLabels, midiLabel } = deps;

  const bassRow = document.createElement('div');
  bassRow.className = 'track bass-track';
  const bassLabel = document.createElement('div');
  bassLabel.className = 'track-label';
  bassLabel.textContent = laneLabels.bass;
  bassRow.appendChild(bassLabel);
  const bassCellsEl = document.createElement('div');
  bassCellsEl.className = 'cells bass-cells';
  bassRow.appendChild(bassCellsEl);

  for (let i = start; i < end; i++) {
    const step = seq.bass[i];
    const cell = document.createElement('div');
    cell.className = 'bcell';
    if (i > start && (i - start) % 16 === 0) cell.classList.add('seg-start');

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

    const mkToggle = (label: string, key: 'on' | 'accent' | 'slide') => {
      const b = document.createElement('button');
      b.className = `toggle ${key}`;
      b.textContent = label;
      if (step[key]) b.classList.add('active');
      b.addEventListener('click', () => {
        step[key] = !step[key];
        b.classList.toggle('active', step[key]);
      });
      return b;
    };

    const onBtn = mkToggle('●', 'on');
    const accentBtn = mkToggle('A', 'accent');
    const slideBtn = mkToggle('S', 'slide');
    cell.appendChild(noteSel);
    cell.appendChild(onBtn);
    cell.appendChild(accentBtn);
    cell.appendChild(slideBtn);
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1);
    cell.appendChild(num);

    bassCellsEl.appendChild(cell);
    classicState.bassCells[i] = { el: cell, noteSel, onBtn, accentBtn, slideBtn };
  }
  bassTracksEl.appendChild(bassRow);
}
```

- [ ] **Step 4.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes

---

## Task 5: Create `src/classic/poly-step-row.ts`

**Files:**
- Create: `src/classic/poly-step-row.ts`

- [ ] **Step 5.1: Create the file**

```ts
import { classicState } from './classic-state';
import type { ClassicDeps } from './classic-state';

export function renderMainPolyStepRow(deps: ClassicDeps): void {
  const { seq, polyTracksEl, VIEW_SIZE, midiLabel } = deps;
  const { viewStart } = classicState;
  const start = viewStart;
  const end = Math.min(viewStart + VIEW_SIZE, seq.length);
  const count = end - start;
  polyTracksEl.style.setProperty('--steps', String(count));

  const row = document.createElement('div');
  row.className = 'track melody-track';
  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = 'POLYSYNTH';
  row.appendChild(label);
  const cellsEl = document.createElement('div');
  cellsEl.className = 'cells melody-cells';
  row.appendChild(cellsEl);

  for (let i = start; i < end; i++) {
    const step = seq.melody[i];
    const cell = document.createElement('div');
    cell.className = 'bcell mcell';
    if (i > start && (i - start) % 16 === 0) cell.classList.add('seg-start');

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
    const renderChordBtn = () => {
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
      renderChordBtn();
    });
    renderChordBtn();

    const mkToggle = (label: string, key: 'on' | 'accent' | 'tie') => {
      const b = document.createElement('button');
      b.className = `toggle ${key === 'tie' ? 'slide' : key}`;
      b.textContent = label;
      if (step[key]) b.classList.add('active');
      b.addEventListener('click', () => {
        step[key] = !step[key];
        b.classList.toggle('active', step[key]);
      });
      return b;
    };

    const onBtn = mkToggle('●', 'on');
    const accentBtn = mkToggle('A', 'accent');
    const tieBtn = mkToggle('T', 'tie');
    cell.appendChild(noteSel);
    cell.appendChild(onBtn);
    cell.appendChild(accentBtn);
    cell.appendChild(tieBtn);
    cell.appendChild(chordBtn);
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1);
    cell.appendChild(num);

    cellsEl.appendChild(cell);
    classicState.melodyCells[i] = { el: cell, noteSel, onBtn, accentBtn, tieBtn, chordBtn };
  }
  polyTracksEl.appendChild(row);
}
```

- [ ] **Step 5.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes

---

## Task 6: Create `src/classic/poly-target.ts`

Depends on: `classic-state.ts`

**Files:**
- Create: `src/classic/poly-target.ts`

- [ ] **Step 6.1: Create the file**

```ts
import { classicState, EXTRA_IDS, type ClassicDeps, type ExtraId } from './classic-state';
import type { PolyTrack } from '../core/pattern';
import type { PolySynth } from '../polysynth/polysynth';

// Lazily imported at call time to avoid circular deps (rebuildPolyTrack etc.)
type RebuildPolyTrack = () => void;

export function setActivePolyTarget(
  target: PolySynth,
  labelText: string,
  deps: ClassicDeps,
  rebuildPolyTrackFn?: RebuildPolyTrack,
): void {
  classicState.activePolyTarget = target;
  const labelEl = document.getElementById('poly-active-label');
  if (labelEl) labelEl.textContent = labelText;
  deps.refreshPolyKnobsFromState();
  deps.refreshPolyPresetSelect();
  refreshPolyTargetSelect(deps);
  document.querySelectorAll('.track-label.active-edit').forEach((el) =>
    el.classList.remove('active-edit'),
  );
  const node = document.querySelector(`.track-label[data-poly-target="${labelText}"]`);
  if (node) node.classList.add('active-edit');
  // Switch engine selector + params panel to this lane
  let laneId: string = 'main';
  if (target !== deps.polysynth) {
    for (const id of EXTRA_IDS) {
      if (deps.extraPolys[id] && deps.extraPolys[id] === target) { laneId = id; break; }
    }
  }
  deps.setActiveEngineLane(laneId);
}

export function ensureExtraTrack(id: ExtraId, deps: ClassicDeps): PolyTrack {
  let track = deps.seq.pattern.extraPolyTracks.find((t) => t.id === id);
  if (!track) {
    track = { id, name: deps.laneLabels[id], enabled: true, notes: [] };
    deps.seq.pattern.extraPolyTracks.push(track);
  }
  deps.ensureExtraPoly(id);
  return track;
}

export function refreshPolyTargetSelect(deps: ClassicDeps): void {
  const sel = document.getElementById('poly-target-select') as HTMLSelectElement | null;
  if (!sel) return;
  sel.innerHTML = '';
  const opts: Array<{ value: string; label: string }> = [{ value: 'main', label: 'MAIN' }];
  for (const id of EXTRA_IDS) {
    const hasTrack = !!deps.seq.pattern.extraPolyTracks.find((t) => t.id === id);
    opts.push({
      value: id,
      label: hasTrack ? `${deps.laneLabels[id]} ●` : `${deps.laneLabels[id]} (empty)`,
    });
  }
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  if (classicState.activePolyTarget === deps.polysynth) {
    sel.value = 'main';
  } else {
    for (const id of EXTRA_IDS) {
      if (deps.extraPolys[id] && deps.extraPolys[id] === classicState.activePolyTarget) {
        sel.value = id;
        break;
      }
    }
  }
}

export function wirePolyTargetSelect(
  deps: ClassicDeps,
  rebuildPolyTrackFn: RebuildPolyTrack,
): void {
  const sel = document.getElementById('poly-target-select') as HTMLSelectElement;
  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v === 'main') {
      setActivePolyTarget(deps.polysynth, 'MAIN', deps, rebuildPolyTrackFn);
    } else {
      const id = v as ExtraId;
      const track = ensureExtraTrack(id, deps);
      setActivePolyTarget(deps.ensureExtraPoly(id), track.name, deps, rebuildPolyTrackFn);
      rebuildPolyTrackFn();
      deps.rebuildMixer();
    }
  });

  const addBtn = document.getElementById('poly-add-track') as HTMLButtonElement | null;
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const used = new Set(deps.seq.pattern.extraPolyTracks.map((t) => t.id));
      const free = EXTRA_IDS.find((id) => !used.has(id));
      if (!free) {
        alert(`All ${EXTRA_IDS.length} extra polysynth slots are in use.`);
        return;
      }
      const track = ensureExtraTrack(free, deps);
      setActivePolyTarget(deps.ensureExtraPoly(free), track.name, deps, rebuildPolyTrackFn);
      rebuildPolyTrackFn();
      deps.rebuildMixer();
    });
  }

  refreshPolyTargetSelect(deps);
}
```

- [ ] **Step 6.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes

---

## Task 7: Create `src/classic/synth-tabs.ts`

**Files:**
- Create: `src/classic/synth-tabs.ts`

- [ ] **Step 7.1: Create the file**

```ts
import { classicState, EXTRA_IDS, type ClassicDeps, type ExtraId } from './classic-state';
import { setActivePolyTarget, ensureExtraTrack } from './poly-target';

type RebuildPolyTrack = () => void;

export function rebuildSynthTabs(
  deps: ClassicDeps,
  rebuildPolyTrackFn: RebuildPolyTrack,
  rebuildMixerFn: () => void,
): void {
  const host = document.getElementById('synth-tabs');
  if (!host) return;
  host.innerHTML = '';

  const mkTab = (laneId: string, label: string) => {
    const b = document.createElement('button');
    b.className = 'tab synth-tab';
    b.dataset.tab = 'poly';
    b.dataset.synthLane = laneId;
    b.textContent = label;
    if (laneId === classicState.currentSynthLane) b.classList.add('active');
    b.addEventListener('click', () =>
      setCurrentSynthLane(laneId, deps, rebuildPolyTrackFn, rebuildMixerFn),
    );
    host.appendChild(b);
  };
  mkTab('main', 'MAIN');
  for (const track of deps.seq.pattern.extraPolyTracks) {
    mkTab(track.id, track.name.slice(0, 12));
  }

  // Refresh ARP scope checkboxes (depend on extras list)
  if (document.getElementById('poly-arp-controls')?.childElementCount) {
    deps.buildArpUI({ getExtraPolyTracks: () => deps.seq.pattern.extraPolyTracks });
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'tab synth-tab-add';
  addBtn.textContent = '+ Synth';
  addBtn.title = 'Add a new polysynth lane';
  addBtn.addEventListener('click', () => {
    const used = new Set(deps.seq.pattern.extraPolyTracks.map((t) => t.id));
    const free = EXTRA_IDS.find((id) => !used.has(id));
    if (!free) {
      alert(`All ${EXTRA_IDS.length} extra polysynth slots are in use.`);
      return;
    }
    ensureExtraTrack(free, deps);
    rebuildSynthTabs(deps, rebuildPolyTrackFn, rebuildMixerFn);
    rebuildMixerFn();
    setCurrentSynthLane(free, deps, rebuildPolyTrackFn, rebuildMixerFn);
  });
  host.appendChild(addBtn);
}

export function setCurrentSynthLane(
  laneId: string,
  deps: ClassicDeps,
  rebuildPolyTrackFn: RebuildPolyTrack,
  _rebuildMixerFn?: () => void,
): void {
  classicState.currentSynthLane = laneId;
  document.querySelectorAll<HTMLButtonElement>('button.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === 'poly' && t.dataset.synthLane === laneId);
  });
  document.querySelectorAll<HTMLButtonElement>('button.tab').forEach((t) => {
    if (!t.dataset.synthLane && t.dataset.tab !== 'poly') t.classList.remove('active');
  });
  document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
    p.hidden = p.dataset.page !== 'poly';
  });
  if (laneId === 'main') {
    setActivePolyTarget(deps.polysynth, 'MAIN', deps);
  } else {
    const id = laneId as ExtraId;
    const track = ensureExtraTrack(id, deps);
    setActivePolyTarget(deps.ensureExtraPoly(id), track.name, deps);
  }
  rebuildPolyTrackFn();
}
```

- [ ] **Step 7.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes

---

## Task 8: Create `src/classic/rolls-view.ts`

**Files:**
- Create: `src/classic/rolls-view.ts`

- [ ] **Step 8.1: Create the file**

```ts
import { bassStepsToNotes, notesToBassSteps, stepsToNotes, notesToPolySteps } from '../core/notes';
import { addPianoRollFor } from './piano-roll-helper';
import type { ClassicDeps, RollEntry } from './classic-state';

// Module-level array so the animation tick in main.ts can iterate it.
export const rollsRollEntries: RollEntry[] = [];

export function rebuildRollsView(deps: ClassicDeps): void {
  const stackEl = document.getElementById('rolls-stack') as HTMLDivElement | null;
  if (!stackEl) return;
  stackEl.innerHTML = '';
  rollsRollEntries.length = 0;

  // Bass 303 — piano-mode or step-mode (round-trip via converters)
  const bassEntry = addPianoRollFor(
    {
      parent: stackEl,
      labelText: deps.seq.pattern.bassMode === 'piano' ? 'BASS' : 'BASS (step)',
      trackId: 'bass',
      getNotes: () =>
        deps.seq.pattern.bassMode === 'piano'
          ? deps.seq.pattern.bassNotes
          : bassStepsToNotes(deps.seq.pattern.bass),
      setNotes: (n) => {
        if (deps.seq.pattern.bassMode === 'piano') deps.seq.pattern.bassNotes = n;
        else deps.seq.pattern.bass = notesToBassSteps(n, deps.seq.pattern.length);
      },
    },
    deps,
  );
  rollsRollEntries.push(bassEntry);

  // Main poly
  const mainEntry = addPianoRollFor(
    {
      parent: stackEl,
      labelText: deps.seq.pattern.polyMode === 'piano' ? 'MAIN' : 'MAIN (step)',
      trackId: 'main',
      getNotes: () =>
        deps.seq.pattern.polyMode === 'piano'
          ? deps.seq.pattern.polyNotes
          : stepsToNotes(deps.seq.pattern.melody),
      setNotes: (n) => {
        if (deps.seq.pattern.polyMode === 'piano') deps.seq.pattern.polyNotes = n;
        else deps.seq.pattern.melody = notesToPolySteps(n, deps.seq.pattern.length);
      },
    },
    deps,
  );
  rollsRollEntries.push(mainEntry);

  // Extra poly tracks
  for (const track of deps.seq.pattern.extraPolyTracks) {
    const entry = addPianoRollFor(
      {
        parent: stackEl,
        labelText: track.name.slice(0, 14),
        trackId: track.id,
        getNotes: () => track.notes,
        setNotes: (n) => { track.notes = n; },
      },
      deps,
    );
    rollsRollEntries.push(entry);
  }
}
```

- [ ] **Step 8.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes

---

## Task 9: Create `src/classic/poly-track-area.ts`

**Files:**
- Create: `src/classic/poly-track-area.ts`

- [ ] **Step 9.1: Create the file**

```ts
import { classicState, type ClassicDeps, type ExtraId } from './classic-state';
import { addPianoRollFor } from './piano-roll-helper';
import { renderMainPolyStepRow } from './poly-step-row';
import { refreshPolyTargetSelect } from './poly-target';
import { rebuildRollsView } from './rolls-view';

export function rebuildPolyTrack(deps: ClassicDeps, updatePagerFn: () => void): void {
  const { polyTracksEl } = deps;
  polyTracksEl.innerHTML = '';
  classicState.melodyCells = {};
  classicState.pianoRoll = null;
  classicState.extraRolls.clear();

  if (classicState.currentSynthLane === 'main') {
    if (deps.seq.pattern.polyMode === 'piano') {
      classicState.mainRollEntry = addPianoRollFor(
        {
          parent: polyTracksEl,
          labelText: 'MAIN',
          getNotes: () => deps.seq.pattern.polyNotes,
          setNotes: (notes) => { deps.seq.pattern.polyNotes = notes; },
          trackId: 'main',
        },
        deps,
      );
      classicState.pianoRoll = classicState.mainRollEntry.handle;
    } else {
      renderMainPolyStepRow(deps);
      classicState.mainRollEntry = null;
    }
  } else {
    // Show only the active extra lane
    const track = deps.seq.pattern.extraPolyTracks.find(
      (t) => t.id === classicState.currentSynthLane,
    );
    if (track) {
      const ctrl = document.createElement('div');
      ctrl.style.display = 'flex';
      ctrl.style.gap = '4px';
      const toggle = document.createElement('button');
      toggle.className = 'enable' + (track.enabled ? ' active' : '');
      toggle.textContent = track.enabled ? 'ON' : 'OFF';
      toggle.style.fontSize = '9px';
      toggle.style.padding = '2px 4px';
      toggle.addEventListener('click', () => {
        track.enabled = !track.enabled;
        toggle.classList.toggle('active', track.enabled);
        toggle.textContent = track.enabled ? 'ON' : 'OFF';
      });
      ctrl.appendChild(toggle);
      const labelText = track.name.slice(0, 14);
      const entry = addPianoRollFor(
        {
          parent: polyTracksEl,
          labelText,
          getNotes: () => track.notes,
          setNotes: (notes) => { track.notes = notes; },
          trailingControls: ctrl,
          trackId: track.id as ExtraId,
        },
        deps,
      );
      classicState.extraRolls.set(track.id, entry);
    }
  }

  // Re-apply active-edit highlight
  const activeLabel =
    (document.getElementById('poly-active-label') as HTMLElement | null)?.textContent ?? 'MAIN';
  document.querySelectorAll('.track-label.active-edit').forEach((el) =>
    el.classList.remove('active-edit'),
  );
  const node = document.querySelector(`.track-label[data-poly-target="${activeLabel}"]`);
  if (node) node.classList.add('active-edit');

  refreshPolyTargetSelect(deps);
  updatePagerFn();
  rebuildRollsView(deps);
}
```

- [ ] **Step 9.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes

---

## Task 10: Create `src/classic/classic-tracks.ts`

This is the top-level orchestrator. It provides `rebuildTracks`, `visibleRange`, `updatePager`, and a `wireClassicUI` entry-point that main.ts will call once at boot.

**Files:**
- Create: `src/classic/classic-tracks.ts`

- [ ] **Step 10.1: Create the file**

```ts
import { DRUM_LANES } from '../core/drums';
import { classicState, type ClassicDeps } from './classic-state';
import { addPianoRollFor } from './piano-roll-helper';
import { renderBassStepGrid } from './bass-grid';
import { cycleDrumStep, cycleDrumRoll, applyDrumCellState } from './drum-cells';
import { rebuildPolyTrack } from './poly-track-area';
import { rebuildSynthTabs } from './synth-tabs';
import { wirePolyTargetSelect } from './poly-target';

export function visibleRange(deps: ClassicDeps): { start: number; end: number } {
  const { seq, VIEW_SIZE } = deps;
  if (classicState.viewStart >= seq.length) classicState.viewStart = 0;
  return {
    start: classicState.viewStart,
    end: Math.min(classicState.viewStart + VIEW_SIZE, seq.length),
  };
}

export function updatePager(deps: ClassicDeps): void {
  const totalPages = Math.max(1, Math.ceil(deps.seq.length / deps.VIEW_SIZE));
  const currentPage = Math.floor(classicState.viewStart / deps.VIEW_SIZE) + 1;
  const pageLabelEl = document.getElementById('page-label');
  const pagePrevBtn = document.getElementById('page-prev') as HTMLButtonElement | null;
  const pageNextBtn = document.getElementById('page-next') as HTMLButtonElement | null;
  const pagerEl = document.getElementById('pager');
  if (pageLabelEl) pageLabelEl.textContent = `${currentPage} / ${totalPages}`;
  if (pagePrevBtn) pagePrevBtn.disabled = currentPage <= 1;
  if (pageNextBtn) pageNextBtn.disabled = currentPage >= totalPages;
  if (pagerEl) pagerEl.style.display = totalPages > 1 ? 'flex' : 'none';
}

export function rebuildTracks(deps: ClassicDeps): void {
  const { bassTracksEl, drumTracksEl, seq } = deps;
  bassTracksEl.innerHTML = '';
  drumTracksEl.innerHTML = '';
  classicState.bassCells = {};
  for (const k of Object.keys(classicState.drumCells) as Array<keyof typeof classicState.drumCells>) {
    classicState.drumCells[k] = {};
  }

  const { start, end } = visibleRange(deps);
  const count = end - start;
  bassTracksEl.style.setProperty('--steps', String(count));
  drumTracksEl.style.setProperty('--steps', String(count));

  if (seq.pattern.bassMode === 'piano') {
    classicState.bassRollEntry = addPianoRollFor(
      {
        parent: bassTracksEl,
        labelText: deps.laneLabels.bass,
        getNotes: () => seq.pattern.bassNotes,
        setNotes: (notes) => { seq.pattern.bassNotes = notes; },
        trackId: 'bass',
      },
      deps,
    );
  } else {
    classicState.bassRollEntry = null;
    renderBassStepGrid(start, end, deps);
  }

  for (const lane of DRUM_LANES) {
    const row = document.createElement('div');
    row.className = `track drum-track ${lane}`;
    const label = document.createElement('div');
    label.className = 'track-label';
    label.textContent = deps.laneLabels[lane];
    row.appendChild(label);
    const cellsEl = document.createElement('div');
    cellsEl.className = 'cells drum-cells';
    row.appendChild(cellsEl);

    for (let i = start; i < end; i++) {
      const step = seq.drums[lane][i];
      const b = document.createElement('button');
      b.className = `dcell ${lane}`;
      if (i > start && (i - start) % 16 === 0) b.classList.add('seg-start');
      if (i % 4 === 0) b.classList.add('downbeat');
      applyDrumCellState(b, step);
      b.addEventListener('click', (e) => {
        if (e.shiftKey) cycleDrumRoll(step);
        else cycleDrumStep(step);
        applyDrumCellState(b, step);
      });
      b.title = 'Click: off → on → accent. Shift+click: roll x2 → x4';
      cellsEl.appendChild(b);
      classicState.drumCells[lane][i] = b;
    }
    drumTracksEl.appendChild(row);
  }

  rebuildPolyTrack(deps, () => updatePager(deps));
  updatePager(deps);
}

/**
 * Called once at boot from main.ts.
 * Wires up poly-target dropdown + rebuilds synth tabs, then builds the
 * initial track grid.
 */
export function wireClassicUI(deps: ClassicDeps): void {
  classicState.activePolyTarget = deps.polysynth;
  wirePolyTargetSelect(deps, () => rebuildPolyTrack(deps, () => updatePager(deps)));
  rebuildSynthTabs(deps, () => rebuildPolyTrack(deps, () => updatePager(deps)), deps.rebuildMixer);
  rebuildTracks(deps);
}
```

- [ ] **Step 10.2: Typecheck**

```
npx tsc --noEmit
```

Expected: passes (new file not yet imported by main.ts)

---

## Task 11: Update `main.ts` — import and wire the new modules, remove moved code

This is the largest edit. We do it in two sub-steps: first add the imports and the `classicDeps` construction + replace callsites; then delete the code that was moved.

**Files:**
- Modify: `src/main.ts`

### Sub-step 11A: Add imports at top of main.ts

After the existing imports block (after line 44, `import { wireSlotCopyPanel }...`), add:

```ts
import {
  classicState,
  EXTRA_IDS as CLASSIC_EXTRA_IDS,
  type ClassicDeps,
} from './classic/classic-state';
import { rebuildTracks as classicRebuildTracks, wireClassicUI, updatePager, visibleRange as classicVisibleRange } from './classic/classic-tracks';
import { refreshAllCellsFromState } from './classic/drum-cells';
import { rebuildPolyTrack as classicRebuildPolyTrack } from './classic/poly-track-area';
import { rebuildSynthTabs as classicRebuildSynthTabs, setCurrentSynthLane as classicSetCurrentSynthLane } from './classic/synth-tabs';
import { rebuildRollsView as classicRebuildRollsView } from './classic/rolls-view';
import { rollsRollEntries } from './classic/rolls-view';
import { setActivePolyTarget as classicSetActivePolyTarget } from './classic/poly-target';
import { autoScrollRoll } from './classic/piano-roll-helper';
```

### Sub-step 11B: Remove ExtraId/EXTRA_IDS from main.ts (they move to classic-state.ts)

The `ExtraId` type and `EXTRA_IDS` const in main.ts can be replaced by re-exporting from classic-state, or the main.ts versions can remain as-is since TypeScript structural typing will unify them. The safest approach is to **keep** the main.ts definitions intact for now (they're used by non-classic code like `ensureExtraPoly`, `activeTracks`, etc.), and rely on the fact that `ClassicDeps.extraPolyIds` accepts them.

### Sub-step 11C: Build classicDeps and wire the entry point

In main.ts, in the boot section **after** `buildPolySynthUI(polySynthUIDeps)` is called (currently around line 1994), add the `classicDeps` construction and `wireClassicUI` call. Also replace each callsite of the old functions with forwarding calls:

**Replace the `rebuildTracks()` call at the end of boot:**
The call at line 1999 stays but uses `classicRebuildTracks(classicDeps)` instead.

**Replace `rebuildPolyTrack()` throughout main.ts:**
Every call to `rebuildPolyTrack()` becomes `classicRebuildPolyTrack(classicDeps, () => updatePager(classicDeps))`.

**But wait** — there are many callsites. The cleanest approach is to define thin wrappers right after `classicDeps` is constructed:

```ts
const classicDeps: ClassicDeps = {
  seq,
  bank,
  polysynth,
  extraPolys: extraPolys as Partial<Record<import('./classic/classic-state').ExtraId, PolySynth>>,
  extraStrips: extraStrips as Partial<Record<import('./classic/classic-state').ExtraId, ChannelStrip>>,
  ensureExtraPoly: ensureExtraPoly as (id: import('./classic/classic-state').ExtraId) => PolySynth,
  extraPolyIds: EXTRA_IDS as import('./classic/classic-state').ExtraId[],
  laneLabels: LANE_LABELS as Record<string, string>,
  bassTracksEl,
  drumTracksEl,
  polyTracksEl,
  VIEW_SIZE,
  midiLabel,
  setBassMode,
  refreshPolyKnobsFromState,
  refreshPolyPresetSelect,
  setActiveEngineLane,
  rebuildMixer,
  buildArpUI: (opts) => buildArpUI(opts),
};

// Thin wrappers that preserve existing callsites
function rebuildTracks() { classicRebuildTracks(classicDeps); }
function rebuildPolyTrack() { classicRebuildPolyTrack(classicDeps, () => updatePager(classicDeps)); }
function rebuildSynthTabs() { classicRebuildSynthTabs(classicDeps, rebuildPolyTrack, rebuildMixer); }
function setCurrentSynthLane(laneId: string) { classicSetCurrentSynthLane(laneId, classicDeps, rebuildPolyTrack); }
function setActivePolyTarget(target: PolySynth, labelText: string) { classicSetActivePolyTarget(target, labelText, classicDeps); }
function rebuildRollsView() { classicRebuildRollsView(classicDeps); }
function refreshAllCellsFromState_wrapper() { refreshAllCellsFromState(classicDeps); }
```

Then fix the few callsites that still call `refreshAllCellsFromState()` directly (in wirePresets and MIDI import) to use `refreshAllCellsFromState_wrapper()` or rename to `refreshAllCellsFromState`.

### Sub-step 11D: Move classicState reads/writes in main.ts

The following references in main.ts must be updated to go through `classicState`:

| Old | New |
|-----|-----|
| `let viewStart = 0;` | removed (lives in classicState.viewStart) |
| `viewStart` reads | `classicState.viewStart` |
| `viewStart = 0;` assignments | `classicState.viewStart = 0;` |
| `let bassCells: ...` | removed |
| `bassCells[...]` | `classicState.bassCells[...]` |
| `let melodyCells: ...` | removed |
| `melodyCells[...]` | `classicState.melodyCells[...]` |
| `let drumCells: ...` | removed |
| `drumCells[lane][...]` | `classicState.drumCells[lane][...]` |
| `let mainRollEntry` | removed |
| `mainRollEntry` | `classicState.mainRollEntry` |
| `let bassRollEntry` | removed |
| `bassRollEntry` | `classicState.bassRollEntry` |
| `const extraRolls = new Map(...)` | removed |
| `extraRolls` | `classicState.extraRolls` |
| `let pianoRoll` | removed |
| `pianoRoll` | `classicState.pianoRoll` |
| `let currentSynthLane` | removed |
| `currentSynthLane` | `classicState.currentSynthLane` |
| `let activePolyTarget: PolySynth` | removed |
| `activePolyTarget` | `classicState.activePolyTarget!` |
| `rollsRollEntries` | imported from `'./classic/rolls-view'` |

Also `autoScrollRoll(entry)` calls in main.ts become `autoScrollRoll(entry, classicDeps)`.

### Sub-step 11E: Delete the now-moved code

Remove these blocks from main.ts (each was copied verbatim to the new files):
- `interface BassCellRefs { ... }` (lines 349–355)
- `interface MelodyCellRefs { ... }` (lines 356–363)
- `let bassCells: ...` (line 365)
- `let melodyCells: ...` (line 366)
- `let drumCells: ...` (lines 367–369)
- `function visibleRange()` (lines 371–374)
- `function updatePager()` (lines 376–383)
- `function rebuildTracks()` (lines 385–443)
- `function renderBassStepGrid()` (lines 445–503)
- `interface RollEntry { ... }` (line 505)
- `let pianoRoll ...` (line 506)
- `let mainRollEntry ...` (line 507)
- `let bassRollEntry ...` (line 508)
- `const extraRolls ...` (line 509)
- `function setActivePolyTarget()` (lines 532–548)
- `function ensureExtraTrack()` (lines 553–561)
- `function refreshPolyTargetSelect()` (lines 563–586)
- `function wirePolyTargetSelect()` (lines 588–616)
- `function autoScrollRoll()` (lines 618–628)
- `function rangeForNotes()` (lines 630–643)
- `function addPianoRollFor()` (lines 645–709)
- `let currentSynthLane ...` (line 713)
- `function rebuildPolyTrack()` (lines 715–775)
- `const rollsRollEntries: RollEntry[] = []` (line 778)
- `function rebuildRollsView()` (lines 779–826)
- `function rebuildSynthTabs()` (lines 829–868)
- `function setCurrentSynthLane()` (lines 870–892)
- `function renderMainPolyStepRow()` (lines 894–984)
- `function cycleDrumStep()` (lines 986–990)
- `function cycleDrumRoll()` (lines 992–997)
- `function applyDrumCellState()` (lines 999–1004)
- `function refreshAllCellsFromState()` (lines 1006–1033)
- `let activePolyTarget: PolySynth = polysynth;` (line 1564)

### Sub-step 11F: Wire the boot entry point

Replace the existing `rebuildTracks()` call in the boot section with:
```ts
wireClassicUI(classicDeps);
```
(This internally calls `wirePolyTargetSelect`, `rebuildSynthTabs`, and `rebuildTracks`.)

Remove the separate `wirePolyTargetSelect()` and `rebuildSynthTabs()` calls that were there before (they are now inside `wireClassicUI`).

- [ ] **Step 11.1: Add all imports to top of main.ts** (as described in sub-step 11A)

- [ ] **Step 11.2: Typecheck** — expect errors about duplicate declarations; we'll fix them next

```
npx tsc --noEmit
```

- [ ] **Step 11.3: Build classicDeps object + thin wrappers in main.ts** (as described in sub-steps 11B–11C, placing just before the boot section around line ~1957)

- [ ] **Step 11.4: Typecheck** — should now have only "duplicate declaration" errors for the old functions

```
npx tsc --noEmit
```

- [ ] **Step 11.5: Delete moved code from main.ts** (sub-step 11D/E — remove all the blocks listed above)

- [ ] **Step 11.6: Update classicState references** (sub-step 11D — rewrite `viewStart`, `bassCells`, etc. to go through classicState)

- [ ] **Step 11.7: Replace `wirePolyTargetSelect()` and standalone `rebuildSynthTabs()` in boot section** with single `wireClassicUI(classicDeps)` call

- [ ] **Step 11.8: Typecheck — must pass cleanly**

```
npx tsc --noEmit
```

Expected: zero errors

- [ ] **Step 11.9: Build check**

```
npm run build
```

Expected: successful bundle with no errors

---

## Task 12: Commit

- [ ] **Step 12.1: Stage and commit all new + modified files**

```bash
git add src/classic/classic-state.ts \
        src/classic/piano-roll-helper.ts \
        src/classic/drum-cells.ts \
        src/classic/bass-grid.ts \
        src/classic/poly-step-row.ts \
        src/classic/poly-target.ts \
        src/classic/synth-tabs.ts \
        src/classic/rolls-view.ts \
        src/classic/poly-track-area.ts \
        src/classic/classic-tracks.ts \
        src/main.ts

git commit -m "refactor: extract Classic-mode track rendering into src/classic/

Move ~700 lines of Classic track rendering out of main.ts into 10
focused files under src/classic/. Shared mutable state lives in
classicState (classic-state.ts); external deps passed via ClassicDeps.
main.ts retains thin wrappers preserving all existing call-sites.
No behavior change; npx tsc --noEmit and npm run build both pass."
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| `src/classic/` subdirectory | Task 1 |
| `classic-state.ts` with `classicState` + `ClassicDeps` | Task 1 |
| `piano-roll-helper.ts` — `addPianoRollFor`, `rangeForNotes`, `autoScrollRoll` | Task 2 |
| `drum-cells.ts` — cycle/apply/refresh | Task 3 |
| `bass-grid.ts` — `renderBassStepGrid` | Task 4 |
| `poly-step-row.ts` — `renderMainPolyStepRow` | Task 5 |
| `poly-target.ts` — `setActivePolyTarget`, `ensureExtraTrack`, `refreshPolyTargetSelect`, `wirePolyTargetSelect` | Task 6 |
| `synth-tabs.ts` — `rebuildSynthTabs`, `setCurrentSynthLane` | Task 7 |
| `rolls-view.ts` — `rebuildRollsView` | Task 8 |
| `poly-track-area.ts` — `rebuildPolyTrack` | Task 9 |
| `classic-tracks.ts` — `rebuildTracks` + `visibleRange` + `updatePager` + `wireClassicUI` | Task 10 |
| main.ts updated, imports wired, old code deleted | Task 11 |
| Each new file ≤300 lines | Yes — estimated above |
| `npx tsc --noEmit` passes | Step 11.8 |
| `npm run build` passes | Step 11.9 |
| No behavior changes | Verified by identical logic, thin wrappers |

**Placeholder scan:** None found — all code blocks are complete.

**Type consistency check:**
- `RollEntry`, `BassCellRefs`, `MelodyCellRefs` are defined once in `classic-state.ts` and imported everywhere.
- `ClassicDeps` is the single interface used across all modules.
- `ExtraId` in `classic-state.ts` matches the identical type from main.ts (structural typing — no cast needed beyond the `as` in classicDeps construction).
- `autoScrollRoll(entry, deps)` — consistently two-arg in all usages (piano-roll-helper.ts export + main.ts callsites).
- `rebuildPolyTrack(deps, updatePagerFn)` — consistently two-arg in poly-track-area.ts; thin wrapper in main.ts passes both.

**Potential tricky point:** `refreshAllCellsFromState` is called from two places outside the classic modules — the preset-loading buttons and MIDI import wiring. Task 11C names the thin wrapper `refreshAllCellsFromState_wrapper` to avoid a naming collision while the old function still exists. Once the old function is deleted (step 11E) the wrapper should be renamed back to `refreshAllCellsFromState` (or keep the wrapper name and update the two callsites). Make sure both callsites are updated.

**Another tricky point:** `wireClassicUI` now calls `wirePolyTargetSelect` and `rebuildSynthTabs` internally. The boot section of main.ts currently has separate `wirePolyTargetSelect()` and `rebuildSynthTabs()` calls (lines ~2005 and ~2085). Step 11.7 must remove those to avoid double-wiring the event listeners.
