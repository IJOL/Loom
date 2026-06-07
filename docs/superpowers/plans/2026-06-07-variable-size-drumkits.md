# Variable-size sample drumkits — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** A sampler drumkit can hold any number of pads; the per-pad rack and the drum-grid
clip editor both render N rows so every pad is playable/editable in "drums".

**Architecture:** Replace the 8-locked, `DrumVoice`-keyed drum-grid logic with a note-addressed
`DrumRows` model. Synth drums use `gmDrumRows()` (unchanged behaviour); sample drumkits use
`noteDrumRows(keymapNotes)`. Add ＋/－ Pad to the sampler drumkit UI.

**Tech stack:** TS, Vitest, Web Audio. Spec: [../specs/2026-06-07-variable-size-drumkits-design.md](../specs/2026-06-07-variable-size-drumkits-design.md).

---

### Task 1: `DrumRows` model + refactor the pure logic

**Files:** Modify `src/core/drum-grid-editing.ts`; Test `src/core/drum-grid-editing.test.ts`.

- [ ] **Add the model + constructors** to `drum-grid-editing.ts`:

```ts
export interface DrumRows {
  count: number;
  noteToRow(midi: number): number;   // -1 when the note has no row
  rowToNote(row: number): number;
}
export function gmDrumRows(voices: readonly DrumVoice[] = DRUM_LANES): DrumRows {
  const idxOf = new Map(voices.map((v, i) => [v, i] as const));
  return {
    count: voices.length,
    noteToRow: (midi) => { const v = GM_DRUM_MAP[midi]; return v !== undefined ? (idxOf.get(v) ?? -1) : -1; },
    rowToNote: (row) => VOICE_MIDI[voices[row]],
  };
}
export function noteDrumRows(notes: readonly number[]): DrumRows {
  const idxOf = new Map(notes.map((n, i) => [n, i] as const));
  return { count: notes.length, noteToRow: (midi) => idxOf.get(midi) ?? -1, rowToNote: (row) => notes[row] };
}
```

- [ ] **Refactor the six functions** to take `rows: DrumRows` instead of `voice` / `voicesInOrder`
  / `rowOfVoice`. New signatures (bodies use `rows.noteToRow(n.midi)` and `rows.rowToNote(row)`):

```ts
export function hitInCell(notes, row: number, cellTick, snap, rows: DrumRows): NoteEvent | null
export function hitsInCell(notes, row: number, cellTick, snap, rows: DrumRows): NoteEvent[]
export function rowsInRect(notes, rect: DrumRect, rows: DrumRows): NoteEvent[]
export function rowMove(selected, dRows, rows: DrumRows): Map<NoteEvent, number>   // clamp to rows.count-1
export function serializeDrumClipboard(selected, rows: DrumRows): DrumClipNote[]
export function pasteDrumClipboard(clip, anchorTick, anchorRow, patternTicks, rows: DrumRows): NoteEvent[]
```

`rowMove` clamp: `const d = Math.max(-minR, Math.min((rows.count - 1) - maxR, dRows));` then
`out.set(n, rows.rowToNote(r + d))`. `hitInCell/hitsInCell` filter on `rows.noteToRow(n.midi) === row`.

- [ ] **Update the test** to the new API and ADD a variable-kit case:

```ts
import { gmDrumRows, noteDrumRows } from './drum-grid-editing';
const GM = gmDrumRows();                       // 8 GM rows
// existing cases: pass GM and a row index instead of the voice string, e.g.
expect(hitInCell(notes, GM.noteToRow(36), 24, 24, GM)).toBe(notes[1]);
expect(rowMove([kick(0)], 1, GM).get(...)).toBe(38);
// NEW — a 12-pad kit on arbitrary notes:
const NOTES = [36,37,38,39,40,41,42,43,44,45,46,47];
const K = noteDrumRows(NOTES);               // 12 rows
const padN = (note: number): NoteEvent => ({ start: 0, midi: note, duration: 12, velocity: 80 });
expect(K.count).toBe(12);
expect(rowMove([padN(44)], 2, K).get(...)).toBe(46);      // row 8 → row 10
expect(rowMove([padN(47)], 5, K).get(...)).toBe(47);      // last row clamps
const cb = serializeDrumClipboard([padN(45)], K);          // row 9
expect(pasteDrumClipboard(cb, 96, 11, 384, K)[0]).toMatchObject({ start: 96, midi: 47 });
```

- [ ] Run `NO_COLOR=1 npx vitest run src/core/drum-grid-editing.test.ts` → PASS. Commit.

### Task 2: drive the canvas editor from a row model

**Files:** Modify `src/session/clip-editors/clip-editor-drum-grid.ts`.

- [ ] Add a param `model: DrumGridModel = { rows: gmDrumRows(), labels: DRUM_LANES.map(v => LANE_LABELS[v]) }`
  where `interface DrumGridModel { rows: DrumRows; labels: string[] }`. Keep `LANE_LABELS`.
- [ ] Replace the module `ROWS`/`rowOfVoice` and the literal `8`s:
  - `const ROWS_N = model.rows.count;`
  - `const FRAME_H = RULER_H + ROW_H * ROWS_N + VEL_LANE_H;` (computed after `model` is known — move into the function body).
  - `rowFromY = (y) => Math.max(0, Math.min(ROWS_N - 1, Math.floor((y - RULER_H) / ROW_H)));`
  - draw loop `for (let r = 0; r < ROWS_N; r++)` → label `model.labels[r]`.
  - note→row in draw + velocity lane: `const r = model.rows.noteToRow(n.midi); if (r < 0) continue;`
  - `laneTop = RULER_H + ROW_H * ROWS_N` (three sites).
  - `pencilClick(row, ...)`: `const midi = model.rows.rowToNote(row);` push `{ midi, ... }`; audition `midi`;
    cell lookups use `hitsInCell(notes(), row, cell, snap, model.rows)`.
  - pointer/keyboard: `hitInCell(..., row, ..., model.rows)`, `rowsInRect(notes(), marquee, model.rows)`,
    `rowMove([...selection], d, model.rows)`, `serializeDrumClipboard(..., model.rows)`,
    `pasteDrumClipboard(clip, t, r, patternTicks, model.rows)`.
- [ ] Existing `clip-editor-drum-grid.test.ts` must still pass with the default (GM) model. Run it.
- [ ] `npx tsc --noEmit`. Commit.

### Task 3: router builds the model per lane + robust detection

**Files:** Modify `src/session/clip-editors/clip-editor-router.ts`; Test `clip-editor-router.test.ts`.

- [ ] `chooseClipEditor`: make the sampler-drumkit test note-agnostic:

```ts
const km = lane.engineState?.sampler?.keymap ?? [];
const allSingleNote = km.length > 0 && km.every((e) => e.loNote === e.hiNote && e.hiNote === e.rootNote);
const isDrumkitSampler = lane.engineId === 'sampler' && (!!lane.engineState?.sampler?.drumkitId || allSingleNote);
```

- [ ] In `renderClipEditor`, when `editor === 'drum-grid'`, build the model:

```ts
import { gmDrumRows, noteDrumRows } from '../../core/drum-grid-editing';
import { GM_DRUM_MAP } from '../../engines/drum-gm-map';
import { LANE_LABELS } from './clip-editor-drum-grid';       // export it from Task 2
function drumModel(lane: SessionLane, midiLabel: (m: number) => string) {
  const km = lane.engineId === 'sampler' ? (lane.engineState?.sampler?.keymap ?? []) : [];
  if (km.length) {
    const notes = [...new Set(km.map((e) => e.rootNote))].sort((a, b) => a - b);
    const labels = notes.map((n) => { const v = GM_DRUM_MAP[n]; return v ? LANE_LABELS[v] : midiLabel(n); });
    return { rows: noteDrumRows(notes), labels };
  }
  return { rows: gmDrumRows(), labels: undefined };       // editor default fills GM labels
}
```

  Pass it: `renderDrumGridEditor(bodyBox, clip, deps.historyDeps, deps.seq.meter, { auditionNote, getPlayheadTick }, model)`.
  (Add `model?` as the 6th param of `renderDrumGridEditor`, defaulting to GM when undefined.)

- [ ] Add a router test: a sampler lane with a 12-single-note keymap and **no** `drumkitId` →
  `chooseClipEditor` returns `'drum-grid'`; a melodic sampler (range zones) returns `'piano-roll'`.
- [ ] Run `clip-editor-router.test.ts` + `npx tsc --noEmit`. Commit.

### Task 4: sampler `isDrumkit` + ＋/－ Pad

**Files:** Modify `src/engines/sampler.ts`.

- [ ] `isDrumkit()` → structural: `this.keymap.length > 0 && this.keymap.every((e) => e.loNote === e.hiNote && e.hiNote === e.rootNote)`.
- [ ] In the drumkit branch of `buildParamUI` (above `renderDrumVoiceRack`), add a toolbar:

```ts
const padBar = document.createElement('div'); padBar.className = 'sampler-padbar';
const count = document.createElement('span'); count.textContent = `${this.keymap.length} pads`;
const addBtn = document.createElement('button'); addBtn.textContent = '＋ Pad';
const delBtn = document.createElement('button'); delBtn.textContent = '－ Pad';
addBtn.onclick = () => {
  const used = new Set(this.keymap.map((e) => e.rootNote));
  let note = Math.max(...this.keymap.map((e) => e.rootNote)) + 1; while (used.has(note)) note++;
  const proto = this.keymap[this.keymap.length - 1];
  this.setKeymap([...this.keymap, { sampleId: proto.sampleId, rootNote: note, loNote: note, hiNote: note }]);
  if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, this.keymap);
  rebuild();
};
delBtn.onclick = () => {
  if (this.keymap.length <= 1) return;
  this.setKeymap(this.keymap.slice(0, -1));
  if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, this.keymap);
  rebuild();
};
padBar.append(count, addBtn, delBtn); container.appendChild(padBar);
```

  Import `mirrorKeymapChange` from `../session/session-engine-state`. `rebuild` already exists in
  `buildParamUI` (it re-runs the UI). Note: the rack/grid re-route because the keymap (and its
  single-note shape) changed; `drumkitId` is preserved by `mirrorKeymapChange`.
- [ ] `npx tsc --noEmit`. Add a tiny `sampler-padbar` SCSS rule (flex, gap) if needed for layout.

### Task 5: build, full tests, browser verification

- [ ] `npm run build` (tsc + bundle). Fix any type errors.
- [ ] `npm run test:fast` (unit + scheduling, no DSP) → green (re-run once if `ERR_IPC_CHANNEL_CLOSED`).
- [ ] `npm run preview`; with Playwright: add a sampler lane, load a drumkit, click ＋ Pad to reach
  12 pads, open the clip's drum grid, confirm **12 rows + 12 rack columns**, place a note on a row
  beyond 8, confirm it sounds; screenshot rack + grid. Compare to the mockup Drumkit view.
- [ ] Commit. Rebase onto main, `merge --ff-only`, ExitWorktree (per the worktree finish flow).
