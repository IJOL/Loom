# Flexible Drum Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-16th drum button matrix with a canvas drum-rack editor: selectable resolution (1/4…1/32 + triplets + free), free off-grid placement, and selection/copy-paste/group-move — with the resolution persisted per clip.

**Architecture:** All non-canvas logic goes in a new pure module `src/core/drum-grid-editing.ts` (resolution↔snap, per-cell hit lookup, marquee row×tick hit-test, **row-based** group-move and clipboard — drum rows are non-contiguous GM midis, so this is row-indexed, not midi-indexed). `src/session/clip-editors/clip-editor-drum-grid.ts` is rewritten as a fit-to-width canvas (8 voice rows, no zoom) that is thin glue over that module; it keeps the same exported `renderDrumGridEditor` signature so the router and the sampler-drumkit path are unchanged. Resolution is an additive optional `SessionClip.gridResolution?`. No top-level schema change.

**Tech Stack:** TypeScript, Vite, Vitest, Canvas 2D. Tests colour-free (`NO_COLOR=1`).

**Spec:** [docs/superpowers/specs/2026-06-04-flexible-drum-editor-design.md](../specs/2026-06-04-flexible-drum-editor-design.md)

---

## Execution notes (read first)

- **Worktree:** already on branch `feat/flexible-drum-editor` (spec commit `acfe768`). Commit each task here. On green: `git rebase main` (literal) → `git merge --ff-only feat/flexible-drum-editor` → `ExitWorktree`.
- **Commits** end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Stage only the task's files.
- **Tests:** `NO_COLOR=1 npx vitest run <file>`; `npm run test:unit` for all (re-run once if `ERR_IPC_CHANNEL_CLOSED` teardown after the summary shows green). The `src/samples/drumkit-loader.dsp.test.ts` ENOENT on `public/drumkits/**/*.wav` is a gitignored-fixture env failure unrelated to this work — ignore it (or copy the WAVs from the main checkout).
- **Canvas reality:** the canvas editor (Task 3) is verified by tsc/build + existing tests + Task 5 smoke; the tested logic is all in Task 1.

## File structure

**Created:**
- `src/core/drum-grid-editing.ts` — pure drum-editor logic.
- `src/core/drum-grid-editing.test.ts` — its unit tests.

**Modified:**
- `src/session/session.ts` — `SessionClip.gridResolution?`.
- `src/session/clip-editors/clip-editor-drum-grid.ts` — **rewritten** as the canvas editor.
- `src/session/clip-editors/clip-editor-router.ts` — pass `auditionNote` (+ existing meter) to the drum editor.
- `src/session/clip-editors/clip-editor-drum-grid.test.ts` — adjust to the canvas API (keep data-shape asserts).

**No** top-level `SavedStateV3` / `schemaVersion` change. **No** `session-migration.ts` change needed — `migrateClip`'s modern path preserves unknown fields, and the editor clamps `gridResolution` on read (`clampResolution`), so an invalid persisted value is corrected at render without a migration pass.

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
  snapTickToRes, hitInCell, rowsInRect, rowMove,
  serializeDrumClipboard, pasteDrumClipboard, clampGroupTick,
} from './drum-grid-editing';
import type { NoteEvent } from './notes';
import { DRUM_LANES } from './drums';

const VOICES = DRUM_LANES;
const rowOf = (v: typeof VOICES[number]) => VOICES.indexOf(v);
// kick=36 (row 0), snare=38 (row 1), closedHat=42 (row 2)
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

describe('hitInCell', () => {
  it('finds a hit of the voice within [cell, cell+snap)', () => {
    const notes = [kick(0), kick(24), snare(24)];
    expect(hitInCell(notes, 'kick', 24, 24)).toBe(notes[1]);
    expect(hitInCell(notes, 'kick', 48, 24)).toBeNull();
    expect(hitInCell(notes, 'snare', 24, 24)).toBe(notes[2]);
  });
});

describe('rowsInRect', () => {
  it('selects hits by row index and tick span', () => {
    const notes = [kick(0), snare(48), kick(120)];
    const hit = rowsInRect(notes, { row0: 0, row1: 1, tick0: 60, tick1: -1 }, rowOf);
    // rows 0..1, ticks 0..60 → kick@0 and snare@48
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
 *  tick + row; clamp ticks to [0,patternTicks] and rows to the voice list. */
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

> Recompute check for the reviewer: `pasteDrumClipboard` test — `serializeDrumClipboard([kick@48 row0, snare@72 row1])` → `[{dStart:0,row:0},{dStart:24,row:1}]`, ref.row=0; paste anchorRow=2 → rows 2 and 3 → `VOICE_MIDI[closedHat]=42`, `VOICE_MIDI[openHat]=46`; ticks 96 and 120. Matches the asserts.

- [ ] **Step 5: Commit**

```bash
git add src/core/drum-grid-editing.ts src/core/drum-grid-editing.test.ts
git commit -m "feat(drums): pure canvas drum-editor logic + tests"
```

---

## Task 2: `SessionClip.gridResolution?` field

**Files:**
- Modify: `src/session/session.ts:31-42` (`SessionClip`)

- [ ] **Step 1: Add the field**

In `src/session/session.ts`, in `SessionClip` (after `sample?: ClipSample;`), add:

```ts
  /** Drum-editor grid resolution key (Spec 3). Additive/optional; absent ⇒ '1/16'.
   *  Clamped on read by the editor, so an unknown value self-corrects. */
  gridResolution?: import('../core/drum-grid-editing').ResolutionKey;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (additive optional field; nothing reads it yet).

- [ ] **Step 3: Commit**

```bash
git add src/session/session.ts
git commit -m "feat(drums): persist per-clip gridResolution on SessionClip"
```

---

## Task 3: Rewrite the drum editor as a canvas

**Files:**
- Rewrite: `src/session/clip-editors/clip-editor-drum-grid.ts`

Full file replacement. Fit-to-width canvas (8 voice rows, no zoom). Pencil = click-cycle
off→on→accent→off at the snapped cell + audition; Select = marquee/click/group-move/clipboard;
resolution `<select>` persists to `clip.gridResolution`. Verified by tsc/build + Task 5.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/session/clip-editors/clip-editor-drum-grid.ts` with:

```ts
// Canvas drum-rack editor (Spec 3): 8 voice rows × time, variable resolution +
// free off-grid placement, selection/clipboard/group-move. Replaces the button
// matrix. Same NoteEvent + GM-midi data model; serves synth-drums and the
// sampler drumkit (rows are always DRUM_LANES). Pure logic in core/drum-grid-editing.ts.

import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import type { SessionClip } from '../session';
import type { NoteEvent } from '../../core/notes';
import { VOICE_MIDI } from '../../engines/drum-gm-map';
import { withUndo, isTextEditTarget, type HistoryDeps } from '../../save/history-wiring';
import { ticksPerBar, stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';
import { TICKS_PER_STEP } from '../../core/notes';
import {
  RESOLUTIONS, resolutionToSnap, clampResolution, DEFAULT_RESOLUTION, snapTickToRes,
  hitInCell, rowsInRect, rowMove, serializeDrumClipboard, pasteDrumClipboard, clampGroupTick,
  type ResolutionKey, type DrumClipNote,
} from '../../core/drum-grid-editing';

const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};
const ROWS = DRUM_LANES;
const rowOfVoice = (v: DrumVoice): number => ROWS.indexOf(v);

// Layout (CSS px)
const LABEL_W = 54;
const RULER_H = 20;
const ROW_H = 26;
const FRAME_H = RULER_H + ROW_H * 8; // 8 voices

type Tool = 'draw' | 'select';
let currentTool: Tool = 'draw';            // persists across clips (session)
let clipboard: DrumClipNote[] | null = null;

export interface DrumEditorDeps { auditionNote?: (midi: number) => void; }

export function renderDrumGridEditor(
  host: HTMLElement, clip: SessionClip,
  historyDeps?: HistoryDeps, meter: TimeSignature = DEFAULT_METER,
  deps: DrumEditorDeps = {},
): void {
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
  const beatTicks = barTicks / (stepsPerBar(meter) / stepsPerBeat(meter)); // ticks per beat-pulse

  const selection = new Set<NoteEvent>();
  let marquee: { row0: number; tick0: number; row1: number; tick1: number } | null = null;
  let groupDrag: { lastTick: number; lastRow: number } | null = null;
  let lastMouse: { row: number; tick: number } | null = null;
  let mutated = false;

  // ── DOM: toolbar + frame ──────────────────────────────────────────────────
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
  canvas.style.display = 'block';
  canvas.style.cursor = 'crosshair';
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
    // voice labels + row bands
    for (let r = 0; r < 8; r++) {
      const y = yForRow(r);
      ctx.fillStyle = r % 2 ? '#121212' : '#161616'; ctx.fillRect(LABEL_W, y, gridW, ROW_H);
      ctx.fillStyle = '#202020'; ctx.fillRect(0, y, LABEL_W, ROW_H);
      ctx.fillStyle = '#9a9a9a'; ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'middle';
      ctx.fillText(LANE_LABELS[ROWS[r]], 4, y + ROW_H / 2);
    }
    // snap + bar/beat columns
    const s = snap();
    for (let t = 0; t <= patternTicks; t += s) {
      const x = xForTick(t);
      ctx.strokeStyle = (t % barTicks === 0) ? '#555' : (t % beatTicks === 0) ? '#2f2f2f' : '#1c1c1c';
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
    // hits
    for (const n of notes()) {
      const v = (Object.keys(LANE_LABELS) as DrumVoice[]).find((vv) => VOICE_MIDI[vv] === n.midi) ?? rowsVoiceOf(n);
      const r = v ? rowOfVoice(v) : -1;
      if (r < 0) continue;
      const x = xForTick(n.start);
      const w = Math.max(4, n.duration * pxPerTick);
      const y = yForRow(r) + 3;
      const sel = selection.has(n);
      ctx.fillStyle = sel ? '#7fd4ff' : (n.velocity >= 100 ? '#ffaa44' : '#3498db');
      ctx.fillRect(x, y, Math.min(w, ROW_H - 6 + w), ROW_H - 6);
      ctx.strokeStyle = sel ? '#fff' : '#0a0a0a'; ctx.strokeRect(x + 0.5, y + 0.5, Math.max(3, w - 1), ROW_H - 7);
    }
    // marquee
    if (marquee) {
      const x0 = xForTick(Math.min(marquee.tick0, marquee.tick1));
      const x1 = xForTick(Math.max(marquee.tick0, marquee.tick1));
      const y0 = yForRow(Math.min(marquee.row0, marquee.row1));
      const y1 = yForRow(Math.max(marquee.row0, marquee.row1)) + ROW_H;
      ctx.strokeStyle = '#7fd4ff'; ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      ctx.setLineDash([]);
    }
  }

  // map a note's GM midi back to a voice via GM_DRUM_MAP (covers non-canonical midis)
  function rowsVoiceOf(n: NoteEvent): DrumVoice | undefined {
    return (require('../../engines/drum-gm-map') as typeof import('../../engines/drum-gm-map')).GM_DRUM_MAP[n.midi];
  }

  // ── Pencil: click-cycle off → normal → accent → off ───────────────────────
  function pencilClick(row: number, rawTick: number): void {
    const voice = ROWS[row];
    const cell = snapTickToRes(rawTick, snap());
    const hit = hitInCell(notes(), voice, cell, snap());
    const run = () => {
      if (!hit) {
        const dur = Math.max(1, Math.floor(snap() * 0.9));
        notes().push({ midi: VOICE_MIDI[voice], start: cell, duration: dur, velocity: 80 });
        audition?.(VOICE_MIDI[voice]);
      } else if (hit.velocity < 100) {
        hit.velocity = 115;
        audition?.(hit.midi);
      } else {
        setNotes(notes().filter((n) => n !== hit));
      }
      draw();
    };
    if (historyDeps) withUndo(historyDeps, run); else run();
  }

  // ── Pointer handling ──────────────────────────────────────────────────────
  const pos = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { row: rowFromY(e.clientY - rect.top), tick: tickFromX(e.clientX - rect.left) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const { row, tick } = pos(e); wrap.focus();
    if (e.clientX - canvas.getBoundingClientRect().left < LABEL_W) return; // label gutter
    if (currentTool === 'draw' || e.altKey || e.button === 2) {
      if (e.altKey || e.button === 2) {
        const v = ROWS[row]; const cell = snapTickToRes(tick, snap());
        const hit = hitInCell(notes(), v, cell, snap());
        if (hit) { const run = () => { setNotes(notes().filter((n) => n !== hit)); draw(); }; historyDeps ? withUndo(historyDeps, run) : run(); }
        e.preventDefault(); return;
      }
      pencilClick(row, tick); e.preventDefault(); return;
    }
    // select mode
    const v = ROWS[row]; const cell = snapTickToRes(tick, snap());
    const hit = hitInCell(notes(), v, cell, snap());
    if (hit) {
      if (e.shiftKey) { selection.has(hit) ? selection.delete(hit) : selection.add(hit); }
      else if (!selection.has(hit)) { selection.clear(); selection.add(hit); }
      groupDrag = { lastTick: snapTickToRes(tick, snap()), lastRow: row };
      historyDeps?.history.beginGesture(historyDeps.snapshot()); mutated = false;
    } else {
      if (!e.shiftKey) selection.clear();
      marquee = { row0: row, tick0: tick, row1: row, tick1: tick };
    }
    canvas.setPointerCapture(e.pointerId); draw(); e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e); lastMouse = p;
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

  // ── Keyboard (focus-scoped): tool, select-all, esc, delete, clipboard, nudge ─
  wrap.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();

    if (!cmd && e.key === '1') { currentTool = 'draw'; refreshToolbar(); e.preventDefault(); return; }
    if (!cmd && e.key === '2') { currentTool = 'select'; refreshToolbar(); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'a') { selection.clear(); for (const n of notes()) selection.add(n); draw(); e.preventDefault(); return; }
    if (e.key === 'Escape') { selection.clear(); draw(); e.preventDefault(); return; }

    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
      const run = () => { setNotes(notes().filter((n) => !selection.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run();
      e.preventDefault(); return;
    }
    if (cmd && e.key.toLowerCase() === 'c' && selection.size) { clipboard = serializeDrumClipboard([...selection], rowOfVoice); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'x' && selection.size) {
      clipboard = serializeDrumClipboard([...selection], rowOfVoice);
      const run = () => { setNotes(notes().filter((n) => !selection.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run();
      e.preventDefault(); return;
    }
    if (cmd && e.key.toLowerCase() === 'v' && clipboard && clipboard.length) {
      const anchorTick = snapTickToRes(lastMouse?.tick ?? 0, snap());
      const anchorRow = lastMouse?.row ?? 0;
      const pasted = pasteDrumClipboard(clipboard, anchorTick, anchorRow, patternTicks, ROWS);
      const run = () => { for (const n of pasted) notes().push(n); selection.clear(); for (const n of pasted) selection.add(n); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run();
      e.preventDefault(); return;
    }
    // nudge
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
      historyDeps ? withUndo(historyDeps, run) : run();
      e.preventDefault(); return;
    }
  });

  // ── Mount + resize tracking via the host RAF (no window listener) ──────────
  resize();
  let lastW = wrap.clientWidth;
  const ro = () => { const w = wrap.clientWidth; if (w !== lastW) { lastW = w; resize(); } };
  // session-host drives a RAF that calls roll.redraw(); for the drum editor we
  // expose nothing, so attach a cheap resize check to pointer focus instead.
  wrap.addEventListener('pointerenter', ro);
}
```

> Implementation note for the reviewer/executor: the `rowsVoiceOf`/`require(...)` line is a stylistic
> wart — replace it with a top-level `import { GM_DRUM_MAP } from '../../engines/drum-gm-map';` and
> `const v = GM_DRUM_MAP[n.midi];` in `draw()`. `require` is not available in this ESM/Vite codebase
> and will fail at runtime; use the static import. (Kept visible here so the executor fixes it.)

- [ ] **Step 2: Fix the GM_DRUM_MAP import (apply the note above)**

Add `GM_DRUM_MAP` to the existing drum-gm-map import:

```ts
import { GM_DRUM_MAP, VOICE_MIDI } from '../../engines/drum-gm-map';
```

Replace the hit-drawing voice lookup in `draw()`:

```ts
    for (const n of notes()) {
      const v = GM_DRUM_MAP[n.midi];
      const r = v ? rowOfVoice(v) : -1;
      if (r < 0) continue;
```

and delete the `rowsVoiceOf` function entirely.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → success.

- [ ] **Step 4: Commit**

```bash
git add src/session/clip-editors/clip-editor-drum-grid.ts
git commit -m "feat(drums): canvas drum-rack editor (resolution, free placement, selection)"
```

---

## Task 4: Router wiring (audition) + test update

**Files:**
- Modify: `src/session/clip-editors/clip-editor-router.ts:55-57`
- Modify: `src/session/clip-editors/clip-editor-drum-grid.test.ts`

- [ ] **Step 1: Pass `auditionNote` to the drum editor**

In `clip-editor-router.ts`, the drum-grid branch currently is:

```ts
  if (editor === 'drum-grid') {
    renderDrumGridEditor(host, clip, deps.historyDeps, deps.seq.meter);
    return null;
  }
```

Replace with (build the same audition closure the piano-roll uses; `deps.triggerForLane` and
`deps.ctx` exist on `ClipEditorDeps` from Spec 2):

```ts
  if (editor === 'drum-grid') {
    const audition = deps.triggerForLane
      ? (midi: number) => deps.triggerForLane!(lane.id, midi, deps.ctx.currentTime, 0.25, false, false)
      : undefined;
    renderDrumGridEditor(host, clip, deps.historyDeps, deps.seq.meter, { auditionNote: audition });
    return null;
  }
```

- [ ] **Step 2: Update the existing drum-grid test to the canvas API**

The existing `clip-editor-drum-grid.test.ts` calls `renderDrumGridEditor(makeHost(), clip)` and
expects `clip.notes` to be initialised. The canvas version still does `if (!clip.notes) clip.notes = []`
before any DOM work, so that test stays valid. Confirm it still passes; no edit needed unless it
imports something removed. Run it:

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-drum-grid.test.ts`
Expected: PASS (the `clip.notes` init test + the data-shape roll test both still hold).

If the test fails to compile because it referenced a now-removed helper, update only the broken
import/line; keep the two assertions.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/session/clip-editors/clip-editor-router.ts src/session/clip-editors/clip-editor-drum-grid.test.ts
git commit -m "feat(drums): wire auditionNote into the canvas drum editor"
```

---

## Task 5: Final gate + manual smoke

**Files:** none.

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → success.
Run: `npm run test:unit` → green (re-run once if `ERR_IPC_CHANNEL_CLOSED`; ignore the gitignored
`drumkit-loader.dsp` WAV ENOENT if those fixtures aren't in the worktree).

- [ ] **Step 2: Manual smoke (dev server)**

`npm run dev`, open <http://localhost:5173>, open a **drums** clip:
1. The editor is a canvas with 8 voice rows + a resolution `<select>` + Draw/Select buttons.
2. Draw mode: click a cell → hit (audible); click again → accent (colour); again → off. Switch resolution to **1/8T** (triplets) and **1/32**; columns change; placing lands on the new grid.
3. **free** resolution: place hits between grid lines (off-grid) and hear them; reload-independent because notes are in ticks.
4. Select (key `2`): marquee selects hits; drag the group horizontally (time) and vertically (changes voice); **Delete** removes selection (NOT the clip); **Ctrl/Cmd+C** then move the mouse and **Ctrl/Cmd+V** pastes at the mouse; works across two drum clips.
5. Set resolution to 1/8, reload the page, reload the save → the clip opens at **1/8** (persisted).
6. A **sampler drumkit** clip still edits (same canvas).

- [ ] **Step 3: Finish the branch**

When green + smoke-verified: `git rebase main` → (from main) `git merge --ff-only feat/flexible-drum-editor` → `ExitWorktree`. (Operator step.)

---

## Self-review (completed by plan author)

**Spec coverage:**
- Canvas drum-rack (8 voice rows), replaces button matrix, same data model → Task 3. ✓
- Resolution selector (7 keys incl. triplets + free), per-clip persisted → Tasks 1 (snap map), 2 (field), 3 (select + read/write `clip.gridResolution`). ✓
- Free off-grid placement → `free` snap=1 in Task 1 + Pencil/free in Task 3. ✓
- Pencil click-cycle off→on→accent→off + audition; rolls dropped → Task 3 `pencilClick`. ✓
- Select: marquee (row×tick), click/shift, group move (H=tick clamp, V=row), delete, copy/cut/paste-at-mouse, nudge, tool toggle → Tasks 1 (rowsInRect/rowMove/clipboard/clampGroupTick) + 3. ✓
- Audition wiring → Task 4. ✓
- Persistence (no schema bump; editor clamps on read; migration untouched) → Task 2 + note. ✓
- Delete scoping vs inspector clip-delete → Task 3 keydown `stopPropagation` on Delete/Backspace. ✓
- Sampler drumkit unaffected → same `renderDrumGridEditor` signature + DRUM_LANES rows. ✓

**Placeholder scan:** Task 3 Step 1 ships a deliberately-flagged `require(...)` wart that **Step 2
fixes** with a static import — the executor must apply Step 2 (it is a real step, not a TODO). No
other placeholders.

**Type consistency:** `ResolutionKey`/`RESOLUTIONS`/`resolutionToSnap`/`clampResolution`/
`DEFAULT_RESOLUTION`/`snapTickToRes`/`hitInCell`/`rowsInRect`/`rowMove`/`serializeDrumClipboard`/
`pasteDrumClipboard`/`clampGroupTick`/`DrumClipNote` are defined once in Task 1 and consumed with
those exact names in Task 3. `renderDrumGridEditor`'s signature gains a trailing optional
`deps: DrumEditorDeps` (router passes it in Task 4; the existing 4-arg test call still compiles).
`SessionClip.gridResolution?` (Task 2) is the type used by `clip.gridResolution` reads/writes in Task 3.

**Known weak spots for the adversarial review to probe:** (1) the canvas has no zoom/scroll —
long clips at 1/32 get cramped (acceptable, matches the old grid); (2) resize handling is a cheap
`pointerenter` check rather than the piano-roll's RAF path — confirm the editor lays out on first
mount and after a panel resize; (3) verify `deps.ctx`/`deps.triggerForLane` are actually on
`ClipEditorDeps` (added in Spec 2) before Task 4 relies on them.
```
