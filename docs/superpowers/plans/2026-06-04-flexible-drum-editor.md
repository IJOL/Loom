# Flexible Drum Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-16th drum button matrix with a canvas drum-rack editor: selectable resolution (1/4…1/32 + triplets + free), free off-grid placement, and selection/copy-paste/group-move — with the resolution persisted per clip and the moving playhead preserved.

**Architecture:** Non-canvas logic lives in a new pure module `src/core/drum-grid-editing.ts` (resolution↔snap, per-cell hit lookup, marquee row×tick hit-test, **row-based** group-move and clipboard — drum rows are non-contiguous GM midis, so this is row-indexed). `src/session/clip-editors/clip-editor-drum-grid.ts` is rewritten as a fit-to-width canvas (8 voice rows) that is thin glue over that module and **returns a `{ redraw }` handle** so the existing session-host RAF drives its per-frame width-reflow and the canvas playhead (exactly like the piano-roll). Resolution is an additive optional `SessionClip.gridResolution?`. No top-level schema change.

**Tech Stack:** TypeScript, Vite, Vitest, Canvas 2D. Tests colour-free (`NO_COLOR=1`).

**Spec:** [docs/superpowers/specs/2026-06-04-flexible-drum-editor-design.md](../specs/2026-06-04-flexible-drum-editor-design.md)

> **This plan was hardened after an adversarial review** (10 confirmed findings). Folded in:
> the canvas now keeps a moving **playhead** (returns a `{redraw}` handle driven by the host RAF,
> which also fixes the resize-on-mount glitch); the Pencil cycle clears the **whole cell cluster**
> (legacy rolls); the bogus width clamp, the `free`-mode 1-tick gridline storm, the dead
> `TICKS_PER_STEP` import and the `require()` wart are all fixed; dead drum CSS + the now-defunct
> `updateEditorPlayhead` are removed; `AUDITION_GATE` is shared; the spec's pencil-drag aside is
> scoped to Select mode.

---

## Execution notes (read first)

- **Worktree:** already on branch `feat/flexible-drum-editor` (spec/plan committed). Commit each task here. On green: `git rebase main` (literal) → `git merge --ff-only feat/flexible-drum-editor` → `ExitWorktree`.
- **Commits** end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Stage only the task's files.
- **Tests:** `NO_COLOR=1 npx vitest run <file>`; `npm run test:unit` for all (re-run once if `ERR_IPC_CHANNEL_CLOSED` teardown after the summary shows green). `src/samples/drumkit-loader.dsp.test.ts` ENOENT on `public/drumkits/**/*.wav` is a gitignored-fixture env failure unrelated to this work — ignore it (or copy the WAVs from the main checkout).
- **Canvas reality:** the canvas editor (Task 3) is verified by tsc/build + existing tests + Task 6 smoke; the tested logic is all in Task 1.

## File structure

**Created:**
- `src/core/drum-grid-editing.ts` — pure drum-editor logic.
- `src/core/drum-grid-editing.test.ts` — its unit tests.

**Modified:**
- `src/session/session.ts` — `SessionClip.gridResolution?`.
- `src/session/clip-editors/clip-editor-drum-grid.ts` — **rewritten** as the canvas editor (returns a redraw handle).
- `src/session/clip-editors/clip-editor-router.ts` — pass `auditionNote` + `getPlayheadTick`; return the drum handle; hoist `AUDITION_GATE`.
- `src/session/clip-editors/clip-editor-drum-grid.test.ts` — adjust to the canvas API (keep data-shape asserts).
- `src/session/session-host.ts` — remove the now-defunct `.cells` `updateEditorPlayhead`.
- `src/styles/_tracks.scss` + `src/styles/_session-inspector.scss` — delete dead drum-grid CSS.

**No** top-level `SavedStateV3` / `schemaVersion` change. **No** `session-migration.ts` change — `migrateClip`'s modern path preserves unknown fields and the editor clamps `gridResolution` on read.

---

## Task 1: Pure drum-editing module + tests

**Files:**
- Create: `src/core/drum-grid-editing.ts`
- Test: `src/core/drum-grid-editing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/drum-grid-editing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  RESOLUTIONS, resolutionToSnap, clampResolution, DEFAULT_RESOLUTION,
  snapTickToRes, hitInCell, hitsInCell, rowsInRect, rowMove,
  serializeDrumClipboard, pasteDrumClipboard, clampGroupTick,
} from './drum-grid-editing';
import type { NoteEvent } from './notes';
import { DRUM_LANES } from './drums';

const VOICES = DRUM_LANES;
const rowOf = (v: typeof VOICES[number]) => VOICES.indexOf(v);
const kick = (start: number, vel = 80): NoteEvent => ({ start, midi: 36, duration: 12, velocity: vel });
const snare = (start: number): NoteEvent => ({ start, midi: 38, duration: 12, velocity: 80 });

describe('resolution', () => {
  it('maps every key to the right snap', () => {
    expect(resolutionToSnap('1/4')).toBe(96);
    expect(resolutionToSnap('1/8')).toBe(48);
    expect(resolutionToSnap('1/8T')).toBe(32);
    expect(resolutionToSnap('1/16')).toBe(24);
    expect(resolutionToSnap('1/16T')).toBe(16);
    expect(resolutionToSnap('1/32')).toBe(12);
    expect(resolutionToSnap('free')).toBe(1);
  });
  it('clampResolution corrects junk to the default', () => {
    expect(clampResolution('1/8')).toBe('1/8');
    expect(clampResolution('garbage')).toBe(DEFAULT_RESOLUTION);
    expect(clampResolution(undefined)).toBe(DEFAULT_RESOLUTION);
    expect(RESOLUTIONS).toContain('free');
  });
  it('snapTickToRes floors to the snap grid', () => {
    expect(snapTickToRes(50, 24)).toBe(48);
    expect(snapTickToRes(23, 24)).toBe(0);
  });
});

describe('hitInCell / hitsInCell', () => {
  it('finds a hit of the voice within [cell, cell+snap)', () => {
    const notes = [kick(0), kick(24), snare(24)];
    expect(hitInCell(notes, 'kick', 24, 24)).toBe(notes[1]);
    expect(hitInCell(notes, 'kick', 48, 24)).toBeNull();
    expect(hitInCell(notes, 'snare', 24, 24)).toBe(notes[2]);
  });
  it('hitsInCell returns every hit in the cell (legacy roll cluster)', () => {
    const roll = [kick(0), kick(8), kick(16), snare(0)]; // 3 kicks in one 1/16 cell
    expect(hitsInCell(roll, 'kick', 0, 24)).toEqual([roll[0], roll[1], roll[2]]);
    expect(hitsInCell(roll, 'snare', 0, 24)).toEqual([roll[3]]);
  });
});

describe('rowsInRect', () => {
  it('selects hits by row index and tick span', () => {
    const notes = [kick(0), snare(48), kick(120)];
    const hit = rowsInRect(notes, { row0: 0, row1: 1, tick0: 0, tick1: 60 }, rowOf);
    expect(hit).toEqual([notes[0], notes[1]]);
  });
});

describe('rowMove', () => {
  it('maps a downward move to the next voice midi, clamped at the bottom', () => {
    const sel = [kick(0)];                       // row 0
    expect(rowMove(sel, 1, VOICES).get(sel[0])).toBe(38);   // snare
    const last = [{ start: 0, midi: 51, duration: 12, velocity: 80 }]; // ride = row 7
    expect(rowMove(last, 5, VOICES).get(last[0])).toBe(51); // clamped, unchanged
  });
});

describe('clipboard (row-based) + tick clamp', () => {
  it('serialize→paste anchors to (tick,row) and preserves relative row/tick', () => {
    const sel = [kick(48), snare(72)];           // rows 0,1 ; dStart 0,24
    const clip = serializeDrumClipboard(sel, rowOf);
    const pasted = pasteDrumClipboard(clip, 96, 2, 384, VOICES); // anchor row 2 (closedHat)
    expect(pasted[0]).toMatchObject({ start: 96, midi: 42 });    // row 2
    expect(pasted[1]).toMatchObject({ start: 120, midi: 46 });   // row 3 (openHat), +24 tick
  });
  it('clampGroupTick stops the group at 0 and patternTicks', () => {
    expect(clampGroupTick([kick(24), kick(48)], -100, 384)).toBe(-24);
    expect(clampGroupTick([{ start: 360, midi: 36, duration: 24, velocity: 80 }], 100, 384)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/drum-grid-editing.test.ts`
Expected: FAIL — `Failed to resolve import "./drum-grid-editing"`.

- [ ] **Step 3: Write the module**

Create `src/core/drum-grid-editing.ts`:

```ts
// Pure, DOM-free logic for the canvas drum editor (Spec 3): resolution↔snap,
// per-cell hit lookup, marquee row×tick hit-test, and ROW-BASED group move +
// clipboard. Drum rows are non-contiguous GM midis, so everything vertical is
// row-indexed (not midi-indexed). clip-editor-drum-grid.ts is canvas glue over this.

import type { NoteEvent } from './notes';
import { TICKS_PER_QUARTER } from './notes';
import type { DrumVoice } from './drums';
import { GM_DRUM_MAP, VOICE_MIDI } from '../engines/drum-gm-map';

export type ResolutionKey = '1/4' | '1/8' | '1/8T' | '1/16' | '1/16T' | '1/32' | 'free';
export const RESOLUTIONS: ResolutionKey[] = ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32', 'free'];
export const DEFAULT_RESOLUTION: ResolutionKey = '1/16';

const SNAP: Record<ResolutionKey, number> = {
  '1/4': TICKS_PER_QUARTER,        // 96
  '1/8': TICKS_PER_QUARTER / 2,    // 48
  '1/8T': TICKS_PER_QUARTER / 3,   // 32  (eighth triplet)
  '1/16': TICKS_PER_QUARTER / 4,   // 24
  '1/16T': TICKS_PER_QUARTER / 6,  // 16  (sixteenth triplet)
  '1/32': TICKS_PER_QUARTER / 8,   // 12
  free: 1,
};

export function resolutionToSnap(k: ResolutionKey): number { return SNAP[k]; }

export function clampResolution(x: unknown): ResolutionKey {
  return (typeof x === 'string' && (RESOLUTIONS as string[]).includes(x)) ? (x as ResolutionKey) : DEFAULT_RESOLUTION;
}

export function snapTickToRes(tick: number, snap: number): number {
  return Math.max(0, Math.floor(tick / snap) * snap);
}

/** First hit of `voice` whose start ∈ [cellTick, cellTick + snap). */
export function hitInCell(notes: readonly NoteEvent[], voice: DrumVoice, cellTick: number, snap: number): NoteEvent | null {
  for (const n of notes) {
    if (GM_DRUM_MAP[n.midi] === voice && n.start >= cellTick && n.start < cellTick + snap) return n;
  }
  return null;
}

/** ALL hits of `voice` in the cell (covers legacy roll clusters + finer-res dupes). */
export function hitsInCell(notes: readonly NoteEvent[], voice: DrumVoice, cellTick: number, snap: number): NoteEvent[] {
  return notes.filter((n) => GM_DRUM_MAP[n.midi] === voice && n.start >= cellTick && n.start < cellTick + snap);
}

export interface DrumRect { row0: number; row1: number; tick0: number; tick1: number; }

/** Hits whose voice-row ∈ [row0,row1] and body intersects [tick0,tick1). */
export function rowsInRect(
  notes: readonly NoteEvent[], rect: DrumRect, rowOfVoice: (v: DrumVoice) => number,
): NoteEvent[] {
  const r0 = Math.min(rect.row0, rect.row1), r1 = Math.max(rect.row0, rect.row1);
  const t0 = Math.min(rect.tick0, rect.tick1), t1 = Math.max(rect.tick0, rect.tick1);
  return notes.filter((n) => {
    const v = GM_DRUM_MAP[n.midi];
    if (v === undefined) return false;
    const r = rowOfVoice(v);
    return r >= r0 && r <= r1 && n.start < t1 && n.start + n.duration > t0;
  });
}

/** New GM midi per selected hit after moving by dRows; clamped to the voice list. */
export function rowMove(
  selected: readonly NoteEvent[], dRows: number, voicesInOrder: readonly DrumVoice[],
): Map<NoteEvent, number> {
  const idxOf = new Map(voicesInOrder.map((v, i) => [v, i]));
  let minR = Infinity, maxR = -Infinity;
  for (const n of selected) {
    const v = GM_DRUM_MAP[n.midi]; const r = v !== undefined ? idxOf.get(v) : undefined;
    if (r === undefined) continue;
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  const out = new Map<NoteEvent, number>();
  if (minR === Infinity) return out;
  const d = Math.max(-minR, Math.min((voicesInOrder.length - 1) - maxR, dRows));
  for (const n of selected) {
    const v = GM_DRUM_MAP[n.midi]; const r = v !== undefined ? idxOf.get(v) : undefined;
    if (r === undefined) continue;
    out.set(n, VOICE_MIDI[voicesInOrder[r + d]]);
  }
  return out;
}

export interface DrumClipNote { dStart: number; row: number; duration: number; velocity: number; }

/** Snapshot selection relative to earliest start, storing the voice ROW (not midi). */
export function serializeDrumClipboard(selected: readonly NoteEvent[], rowOfVoice: (v: DrumVoice) => number): DrumClipNote[] {
  const rows: { n: NoteEvent; row: number }[] = [];
  for (const n of selected) {
    const v = GM_DRUM_MAP[n.midi];
    if (v === undefined) continue;
    rows.push({ n, row: rowOfVoice(v) });
  }
  if (rows.length === 0) return [];
  const minStart = Math.min(...rows.map((x) => x.n.start));
  return rows.map((x) => ({ dStart: x.n.start - minStart, row: x.row, duration: x.n.duration, velocity: x.n.velocity }));
}

/** Anchor the earliest clipboard hit to (anchorTick, anchorRow); preserve relative
 *  tick + row; clamp ticks to [0,patternTicks) and rows to the voice list. */
export function pasteDrumClipboard(
  clip: readonly DrumClipNote[], anchorTick: number, anchorRow: number,
  patternTicks: number, voicesInOrder: readonly DrumVoice[],
): NoteEvent[] {
  if (clip.length === 0) return [];
  const ref = clip.find((n) => n.dStart === 0) ?? clip[0];
  const lastRow = voicesInOrder.length - 1;
  return clip.map((n) => {
    const tick = Math.max(0, Math.min(patternTicks - 1, anchorTick + n.dStart));
    const row = Math.max(0, Math.min(lastRow, anchorRow + (n.row - ref.row)));
    return { start: tick, duration: n.duration, midi: VOICE_MIDI[voicesInOrder[row]], velocity: n.velocity };
  });
}

/** Horizontal-only group clamp: the dTick that keeps every hit in [0,patternTicks]. */
export function clampGroupTick(selected: readonly NoteEvent[], dTick: number, patternTicks: number): number {
  if (selected.length === 0) return 0;
  let minStart = Infinity, maxEnd = -Infinity;
  for (const n of selected) { minStart = Math.min(minStart, n.start); maxEnd = Math.max(maxEnd, n.start + n.duration); }
  return Math.max(-minStart, Math.min(patternTicks - maxEnd, dTick));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/drum-grid-editing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/drum-grid-editing.ts src/core/drum-grid-editing.test.ts
git commit -m "feat(drums): pure canvas drum-editor logic + tests"
```

---

## Task 2: `SessionClip.gridResolution?` field

**Files:**
- Modify: `src/session/session.ts` (`SessionClip`)

- [ ] **Step 1: Add the field**

In `src/session/session.ts`, in `SessionClip` (after `sample?: ClipSample;`), add:

```ts
  /** Drum-editor grid resolution key (Spec 3). Additive/optional; absent ⇒ '1/16'.
   *  Clamped on read by the editor, so an unknown value self-corrects. */
  gridResolution?: import('../core/drum-grid-editing').ResolutionKey;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (additive optional; nothing reads it yet).

- [ ] **Step 3: Commit**

```bash
git add src/session/session.ts
git commit -m "feat(drums): persist per-clip gridResolution on SessionClip"
```

---

## Task 3: Rewrite the drum editor as a canvas

**Files:**
- Rewrite: `src/session/clip-editors/clip-editor-drum-grid.ts`

Full file replacement. Fit-to-width canvas (8 voice rows). Returns a `{ redraw }` handle so the
host RAF drives width-reflow + the playhead. Pencil = click-cycle off→on→accent→off over the whole
cell cluster + audition; Select = marquee/click/group-move/clipboard. Verified by tsc/build + Task 6.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/session/clip-editors/clip-editor-drum-grid.ts` with:

```ts
// Canvas drum-rack editor (Spec 3): 8 voice rows × time, variable resolution +
// free off-grid placement, selection/clipboard/group-move, and a canvas playhead.
// Replaces the button matrix. Same NoteEvent + GM-midi data model; serves
// synth-drums and the sampler drumkit (rows are always DRUM_LANES). Returns a
// { redraw } handle driven by the session-host RAF. Pure logic in core/drum-grid-editing.ts.

import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import type { SessionClip } from '../session';
import type { NoteEvent } from '../../core/notes';
import { GM_DRUM_MAP, VOICE_MIDI } from '../../engines/drum-gm-map';
import { withUndo, isTextEditTarget, type HistoryDeps } from '../../save/history-wiring';
import { ticksPerBar, stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';
import {
  RESOLUTIONS, resolutionToSnap, clampResolution, DEFAULT_RESOLUTION, snapTickToRes,
  hitInCell, hitsInCell, rowsInRect, rowMove, serializeDrumClipboard, pasteDrumClipboard, clampGroupTick,
  type ResolutionKey, type DrumClipNote,
} from '../../core/drum-grid-editing';

const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};
const ROWS = DRUM_LANES;
const rowOfVoice = (v: DrumVoice): number => ROWS.indexOf(v);

const LABEL_W = 54;
const RULER_H = 20;
const ROW_H = 26;
const FRAME_H = RULER_H + ROW_H * 8;

type Tool = 'draw' | 'select';
let currentTool: Tool = 'draw';          // persists across clips (session)
let clipboard: DrumClipNote[] | null = null;

export interface DrumEditorDeps {
  auditionNote?: (midi: number) => void;
  getPlayheadTick?: () => number;        // -1 when not playing
}
export interface DrumEditorHandle { redraw: () => void; }

export function renderDrumGridEditor(
  host: HTMLElement, clip: SessionClip,
  historyDeps?: HistoryDeps, meter: TimeSignature = DEFAULT_METER,
  deps: DrumEditorDeps = {},
): DrumEditorHandle {
  host.innerHTML = '';
  if (!clip.notes) clip.notes = [];
  const notes = (): NoteEvent[] => clip.notes;
  const setNotes = (n: NoteEvent[]) => { clip.notes = n; };
  const audition = deps.auditionNote;

  let resolution: ResolutionKey = clampResolution(clip.gridResolution ?? DEFAULT_RESOLUTION);
  clip.gridResolution = resolution;
  const snap = () => resolutionToSnap(resolution);

  const patternTicks = Math.max(1, clip.lengthBars * ticksPerBar(meter));
  const barTicks = ticksPerBar(meter);
  const beatsPerBar = stepsPerBar(meter) / stepsPerBeat(meter);
  const beatTicks = barTicks / beatsPerBar;

  const selection = new Set<NoteEvent>();
  let marquee: { row0: number; tick0: number; row1: number; tick1: number } | null = null;
  let groupDrag: { lastTick: number; lastRow: number } | null = null;
  let lastMouse: { row: number; tick: number } | null = null;
  let mutated = false;
  let playheadTick = -1;

  // ── DOM: toolbar + canvas ─────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.tabIndex = 0; wrap.style.outline = 'none';
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, { display: 'flex', gap: '6px', alignItems: 'center', padding: '4px 2px' } as Partial<CSSStyleDeclaration>);
  const drawBtn = document.createElement('button'); drawBtn.textContent = '✏ Draw';
  const selBtn = document.createElement('button'); selBtn.textContent = '▭ Select';
  const resSel = document.createElement('select');
  for (const r of RESOLUTIONS) { const o = document.createElement('option'); o.value = r; o.textContent = r; resSel.appendChild(o); }
  resSel.value = resolution;
  const refreshToolbar = () => {
    drawBtn.style.fontWeight = currentTool === 'draw' ? '700' : '400';
    selBtn.style.fontWeight = currentTool === 'select' ? '700' : '400';
  };
  drawBtn.addEventListener('click', () => { currentTool = 'draw'; refreshToolbar(); });
  selBtn.addEventListener('click', () => { currentTool = 'select'; refreshToolbar(); });
  resSel.addEventListener('change', () => { resolution = clampResolution(resSel.value); clip.gridResolution = resolution; draw(); });
  toolbar.append(drawBtn, selBtn, resSel);
  refreshToolbar();

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block'; canvas.style.cursor = 'crosshair';
  wrap.append(toolbar, canvas);
  host.appendChild(wrap);

  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('canvas 2d unavailable');
  const ctx = c2d;

  let gridW = 600, pxPerTick = gridW / patternTicks;
  const xForTick = (t: number) => LABEL_W + t * pxPerTick;
  const yForRow = (r: number) => RULER_H + r * ROW_H;
  const tickFromX = (x: number) => Math.max(0, Math.min(patternTicks - 1, (x - LABEL_W) / pxPerTick));
  const rowFromY = (y: number) => Math.max(0, Math.min(7, Math.floor((y - RULER_H) / ROW_H)));

  function resize(): void {
    const w = Math.max(320, wrap.clientWidth || host.clientWidth || 600);
    gridW = w - LABEL_W;
    pxPerTick = gridW / patternTicks;
    canvas.width = w; canvas.height = FRAME_H;
    canvas.style.width = `${w}px`; canvas.style.height = `${FRAME_H}px`;
    draw();
  }

  function draw(): void {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, canvas.width, FRAME_H);
    for (let r = 0; r < 8; r++) {
      const y = yForRow(r);
      ctx.fillStyle = r % 2 ? '#121212' : '#161616'; ctx.fillRect(LABEL_W, y, gridW, ROW_H);
      ctx.fillStyle = '#202020'; ctx.fillRect(0, y, LABEL_W, ROW_H);
      ctx.fillStyle = '#9a9a9a'; ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'middle';
      ctx.fillText(LANE_LABELS[ROWS[r]], 4, y + ROW_H / 2);
    }
    // gridlines: in free mode draw only bar/beat reference lines (snap=1 would draw one per tick).
    const lineStep = resolution === 'free' ? beatTicks : snap();
    for (let t = 0; t <= patternTicks; t += lineStep) {
      const x = xForTick(t);
      ctx.strokeStyle = (t % barTicks === 0) ? '#555' : (t % beatTicks === 0) ? '#2f2f2f' : '#1c1c1c';
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
    for (const n of notes()) {
      const v = GM_DRUM_MAP[n.midi];
      const r = v ? rowOfVoice(v) : -1;
      if (r < 0) continue;
      const x = xForTick(n.start);
      const maxW = (LABEL_W + gridW) - x;
      const w = Math.max(3, Math.min(n.duration * pxPerTick, maxW));
      const y = yForRow(r) + 3;
      const sel = selection.has(n);
      ctx.fillStyle = sel ? '#7fd4ff' : (n.velocity >= 100 ? '#ffaa44' : '#3498db');
      ctx.fillRect(x, y, w, ROW_H - 6);
      ctx.strokeStyle = sel ? '#fff' : '#0a0a0a'; ctx.strokeRect(x + 0.5, y + 0.5, Math.max(3, w - 1), ROW_H - 7);
    }
    if (marquee) {
      const x0 = xForTick(Math.min(marquee.tick0, marquee.tick1));
      const x1 = xForTick(Math.max(marquee.tick0, marquee.tick1));
      const y0 = yForRow(Math.min(marquee.row0, marquee.row1));
      const y1 = yForRow(Math.max(marquee.row0, marquee.row1)) + ROW_H;
      ctx.strokeStyle = '#7fd4ff'; ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      ctx.setLineDash([]);
    }
    if (playheadTick >= 0) {
      const x = xForTick(playheadTick);
      ctx.strokeStyle = '#f7d000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
  }

  // ── Pencil: click-cycle off → normal → accent → off over the whole cell ───
  function pencilClick(row: number, rawTick: number): void {
    const voice = ROWS[row];
    const cell = snapTickToRes(rawTick, snap());
    const cluster = hitsInCell(notes(), voice, cell, snap());
    const run = () => {
      if (cluster.length === 0) {
        const dur = Math.max(1, Math.floor(snap() * 0.9));
        notes().push({ midi: VOICE_MIDI[voice], start: cell, duration: dur, velocity: 80 });
        audition?.(VOICE_MIDI[voice]);
      } else if (cluster.every((n) => n.velocity < 100)) {
        for (const n of cluster) n.velocity = 115;
        audition?.(VOICE_MIDI[voice]);
      } else {
        const set = new Set(cluster);
        setNotes(notes().filter((n) => !set.has(n)));
      }
      draw();
    };
    if (historyDeps) withUndo(historyDeps, run); else run();
  }

  // ── Pointer handling ──────────────────────────────────────────────────────
  const pos = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return { row: rowFromY(e.clientY - rect.top), x, tick: tickFromX(x) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const p = pos(e); wrap.focus();
    if (p.x < LABEL_W) return; // label gutter
    if (e.altKey || e.button === 2) {
      const v = ROWS[p.row]; const cell = snapTickToRes(p.tick, snap());
      const cluster = hitsInCell(notes(), v, cell, snap());
      if (cluster.length) { const set = new Set(cluster); const run = () => { setNotes(notes().filter((n) => !set.has(n))); draw(); }; historyDeps ? withUndo(historyDeps, run) : run(); }
      e.preventDefault(); return;
    }
    if (currentTool === 'draw') { pencilClick(p.row, p.tick); e.preventDefault(); return; }
    const v = ROWS[p.row]; const cell = snapTickToRes(p.tick, snap());
    const hit = hitInCell(notes(), v, cell, snap());
    if (hit) {
      if (e.shiftKey) { selection.has(hit) ? selection.delete(hit) : selection.add(hit); }
      else if (!selection.has(hit)) { selection.clear(); selection.add(hit); }
      groupDrag = { lastTick: snapTickToRes(p.tick, snap()), lastRow: p.row };
      historyDeps?.history.beginGesture(historyDeps.snapshot()); mutated = false;
    } else {
      if (!e.shiftKey) selection.clear();
      marquee = { row0: p.row, tick0: p.tick, row1: p.row, tick1: p.tick };
    }
    canvas.setPointerCapture(e.pointerId); draw(); e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e); lastMouse = { row: p.row, tick: p.tick };
    if (marquee) { marquee.row1 = p.row; marquee.tick1 = p.tick; draw(); return; }
    if (groupDrag) {
      const wantTick = snapTickToRes(p.tick, snap());
      const dTick = clampGroupTick([...selection], wantTick - groupDrag.lastTick, patternTicks);
      const dRow = p.row - groupDrag.lastRow;
      if (dTick !== 0) { for (const n of selection) n.start += dTick; groupDrag.lastTick += dTick; mutated = true; }
      if (dRow !== 0) {
        const moved = rowMove([...selection], dRow, ROWS);
        for (const [n, midi] of moved) n.midi = midi;
        groupDrag.lastRow += dRow; mutated = true;
      }
      if (dTick !== 0 || dRow !== 0) draw();
      return;
    }
  });

  const endPointer = (e: PointerEvent) => {
    if (marquee) {
      for (const n of rowsInRect(notes(), marquee, rowOfVoice)) selection.add(n);
      marquee = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } draw(); return;
    }
    if (groupDrag) {
      groupDrag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (mutated) historyDeps?.history.commitGesture(); else historyDeps?.history.cancelGesture();
      return;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Keyboard (focus-scoped) ───────────────────────────────────────────────
  wrap.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
    if (!cmd && e.key === '1') { currentTool = 'draw'; refreshToolbar(); e.preventDefault(); return; }
    if (!cmd && e.key === '2') { currentTool = 'select'; refreshToolbar(); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'a') { selection.clear(); for (const n of notes()) selection.add(n); draw(); e.preventDefault(); return; }
    if (e.key === 'Escape') { selection.clear(); draw(); e.preventDefault(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
      const set = new Set(selection);
      const run = () => { setNotes(notes().filter((n) => !set.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
    if (cmd && e.key.toLowerCase() === 'c' && selection.size) { clipboard = serializeDrumClipboard([...selection], rowOfVoice); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'x' && selection.size) {
      clipboard = serializeDrumClipboard([...selection], rowOfVoice);
      const set = new Set(selection);
      const run = () => { setNotes(notes().filter((n) => !set.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
    if (cmd && e.key.toLowerCase() === 'v' && clipboard && clipboard.length) {
      const anchorTick = snapTickToRes(lastMouse?.tick ?? 0, snap());
      const anchorRow = lastMouse?.row ?? 0;
      const pasted = pasteDrumClipboard(clipboard, anchorTick, anchorRow, patternTicks, ROWS);
      const run = () => { for (const n of pasted) notes().push(n); selection.clear(); for (const n of pasted) selection.add(n); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
    if (selection.size && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const run = () => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const d = clampGroupTick([...selection], e.key === 'ArrowRight' ? snap() : -snap(), patternTicks);
          for (const n of selection) n.start += d;
        } else {
          const moved = rowMove([...selection], e.key === 'ArrowDown' ? 1 : -1, ROWS);
          for (const [n, midi] of moved) n.midi = midi;
        }
        draw();
      };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
  });

  // ── Mount + the host-RAF redraw handle (per-frame width check + playhead) ──
  resize();
  let lastW = wrap.clientWidth;
  function redraw(): void {
    const w = wrap.clientWidth;
    if (w && w !== lastW) { lastW = w; resize(); }            // reflow on panel/window resize
    const ph = deps.getPlayheadTick?.() ?? -1;
    if (ph !== playheadTick) { playheadTick = ph; draw(); }    // animate the playhead
  }
  return { redraw };
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: errors only at `clip-editor-router.ts` (still returns the old `void`-typed call / no handle) — fixed in Task 4. The drum-grid file itself is error-free.
Run: `npm run build` — defer until Task 4 (the router must return the handle first).

- [ ] **Step 3: Commit**

```bash
git add src/session/clip-editors/clip-editor-drum-grid.ts
git commit -m "feat(drums): canvas drum-rack editor (resolution, free placement, selection, playhead)"
```

---

## Task 4: Router wiring (audition + playhead + handle) + test

**Files:**
- Modify: `src/session/clip-editors/clip-editor-router.ts`
- Modify: `src/session/clip-editors/clip-editor-drum-grid.test.ts`

- [ ] **Step 1: Hoist `AUDITION_GATE` to module scope**

In `clip-editor-router.ts`, `AUDITION_GATE` is currently declared inside `buildPianoRoll`. Move it to
module scope so both editors share it. Add near the top (just below the imports):

```ts
const AUDITION_GATE = 0.25; // seconds — short preview blip, shared by both editors
```

and delete the `const AUDITION_GATE = 0.25; ...` line inside `buildPianoRoll` (its existing usage
there now references the module constant).

- [ ] **Step 2: Return the drum handle with audition + playhead**

In `renderClipEditor`, replace the drum-grid branch:

```ts
  if (editor === 'drum-grid') {
    renderDrumGridEditor(host, clip, deps.historyDeps, deps.seq.meter);
    return null;
  }
```

with (build the same playhead math `buildPianoRoll` uses; `deps.laneStates`/`deps.ctx`/`deps.seq`/
`deps.triggerForLane` are all on `ClipEditorDeps`; `stepsPerBar` and `TICKS_PER_STEP` are already
imported in this file):

```ts
  if (editor === 'drum-grid') {
    const audition = deps.triggerForLane
      ? (midi: number) => deps.triggerForLane!(lane.id, midi, deps.ctx.currentTime, AUDITION_GATE, false, false)
      : undefined;
    const getPlayheadTick = (): number => {
      const lp = deps.laneStates.get(lane.id);
      if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
      const stepDur = 60 / deps.seq.bpm / 4;
      const stepsElapsed = Math.max(0, (deps.ctx.currentTime - lp.startTime) / stepDur);
      const clipSteps = clip.lengthBars * stepsPerBar(deps.seq.meter);
      return (stepsElapsed % clipSteps) * TICKS_PER_STEP;
    };
    return renderDrumGridEditor(host, clip, deps.historyDeps, deps.seq.meter, { auditionNote: audition, getPlayheadTick });
  }
```

(`renderClipEditor`'s declared return type `PianoRollHandle | null` is satisfied: `DrumEditorHandle`
is structurally `{ redraw(): void }` = `PianoRollHandle`. The inspector stores it in `this.roll`, and
session-host's RAF `if (this.inspector.roll) this.inspector.roll.redraw()` now drives the drum editor.)

- [ ] **Step 3: Update the existing drum-grid test**

The existing `clip-editor-drum-grid.test.ts` calls `renderDrumGridEditor(makeHost(), clip)` and
expects `clip.notes` init. The canvas version still does `if (!clip.notes) clip.notes = []` before any
DOM work, so that assertion holds (the renderer then throws on `document` in the node env, caught by
the test's try/catch). Run it:

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-drum-grid.test.ts`
Expected: PASS (the `clip.notes` init test + the data-shape roll test still hold). If it fails to
compile on a removed import, fix only that line; keep the assertions.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → success.

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/clip-editor-router.ts src/session/clip-editors/clip-editor-drum-grid.test.ts
git commit -m "feat(drums): wire audition + canvas playhead; return the drum editor handle"
```

---

## Task 5: Remove the dead button-grid CSS + the defunct DOM playhead

**Files:**
- Modify: `src/session/session-host.ts` (`updateEditorPlayhead`)
- Modify: `src/styles/_tracks.scss`, `src/styles/_session-inspector.scss`

The canvas now draws its own playhead (Task 3) and the piano-roll already drew its own, so
`updateEditorPlayhead` (which toggled `.step-playhead` on the old `.cells` DOM) matches nothing and is
dead. The `.tracks/.track/.cells/.dcell/.seg-start/.downbeat` CSS is now produced by no JS.

- [ ] **Step 1: Remove `updateEditorPlayhead` and its call**

In `src/session/session-host.ts`, delete the `updateEditorPlayhead(...)` method and the line in the
render-tick loop that calls it (search `updateEditorPlayhead`). The RAF loop keeps its
`if (this.inspector.roll) this.inspector.roll.redraw();` line — that now drives BOTH editors'
playheads (piano-roll and the new drum canvas).

- [ ] **Step 2: Delete the dead drum-grid CSS**

In `src/styles/_session-inspector.scss`, delete the rules `#insp-roll-host .cells > .step-playhead`
and `.dcell.roll` (search `.cells` / `.dcell`). In `src/styles/_tracks.scss`, delete the drum-grid
rules (`.tracks`, `.track`, `.track-label`, `.cells`, `.dcell`, `.seg-start`, `.downbeat`,
`.drum-track.*`). If `_tracks.scss` becomes empty, also remove its `@use`/`@import` from the SCSS
entry (`src/styles/*.scss` index). Grep `.dcell`/`.cells` across `src/` first to confirm no remaining
JS produces them (only the now-replaced editor did).

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → success (Vite compiles the SCSS).

- [ ] **Step 4: Commit**

```bash
git add src/session/session-host.ts src/styles/_tracks.scss src/styles/_session-inspector.scss
git commit -m "chore(drums): drop dead button-grid CSS + the defunct DOM step-playhead"
```

---

## Task 6: Final gate + manual smoke

**Files:** none.

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → success.
Run: `npm run test:unit` → green (re-run once if `ERR_IPC_CHANNEL_CLOSED`; ignore the gitignored
`drumkit-loader.dsp` WAV ENOENT if those fixtures aren't in the worktree).

- [ ] **Step 2: Manual smoke (dev server)**

`npm run dev`, open <http://localhost:5173>, open a **drums** clip:
1. Canvas with 8 voice rows + a resolution `<select>` + Draw/Select buttons.
2. Draw: click a cell → hit (audible); again → accent (colour); again → off. Switch to **1/8T** and **1/32**; columns change; placement lands on the new grid.
3. **free**: place hits between grid lines (off-grid) and hear them.
4. **Playhead**: press play → an amber playhead sweeps the canvas and wraps with the loop (this is the regression the review caught — confirm it moves).
5. Select (key `2`): marquee selects; drag the group horizontally (time) and vertically (voice); **Delete** removes selection (NOT the clip); **Ctrl/Cmd+C** then move the mouse + **Ctrl/Cmd+V** pastes at the mouse; works across two drum clips.
6. Set resolution to 1/8, reload the page + load the save → clip opens at **1/8** (persisted).
7. A **sampler drumkit** clip still edits (same canvas). Resize the window → the grid reflows.
8. A clip that contained a legacy **roll** (multiple hits in one 1/16 cell): one Pencil click on that cell clears the whole cluster (no orphan hits).

- [ ] **Step 3: Finish the branch**

When green + smoke-verified: `git rebase main` → (from main) `git merge --ff-only feat/flexible-drum-editor` → `ExitWorktree`. (Operator step.)

---

## Self-review (completed by plan author, post adversarial review)

**Spec coverage:** canvas drum-rack (Task 3); resolution 7 keys + persistence (Tasks 1/2/3); free
off-grid (Task 1 snap=1 + Task 3); Pencil cluster cycle + audition (Tasks 1 `hitsInCell` + 3);
Select marquee/move/clipboard/delete/nudge (Tasks 1+3); audition + **playhead** wiring (Task 4);
dead-code cleanup (Task 5); persistence without schema bump (Task 2 + read-clamp). ✓

**Findings folded in (10 confirmed):** playhead regression → canvas playhead + `{redraw}` handle
driven by the host RAF (Tasks 3+4); resize-on-mount glitch → same handle's per-frame width check;
Pencil only removed first hit → `hitsInCell` cluster removal + accent-all (Tasks 1+3); bogus width
clamp → `Math.min(n.duration*pxPerTick, maxW)`; `free` 1-tick gridline storm → `lineStep =
beatTicks` in free; dead `TICKS_PER_STEP` import dropped + `require()` wart removed (static
`GM_DRUM_MAP` import); dead CSS + `updateEditorPlayhead` removed (Task 5); `AUDITION_GATE` shared
(Task 4); spec pencil-drag aside scoped to Select mode (spec edit).

**Type consistency:** `ResolutionKey`/`RESOLUTIONS`/`resolutionToSnap`/`clampResolution`/
`DEFAULT_RESOLUTION`/`snapTickToRes`/`hitInCell`/`hitsInCell`/`rowsInRect`/`rowMove`/
`serializeDrumClipboard`/`pasteDrumClipboard`/`clampGroupTick`/`DrumClipNote` defined once (Task 1),
consumed by Task 3. `renderDrumGridEditor` returns `DrumEditorHandle` ({redraw}); the router returns
it where it used to return `null`, satisfying `PianoRollHandle | null` structurally.
`SessionClip.gridResolution?` (Task 2) is the type read/written in Task 3.

**Placeholder scan:** none — the previous `require()`/Step-2 wart is gone; Task 3 ships a single
correct file. Every code step is complete.
