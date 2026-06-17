// Canvas drum-rack editor (Spec 3): N voice rows × time, variable resolution +
// free off-grid placement, selection/clipboard/group-move, and a canvas playhead.
// Replaces the button matrix. Same NoteEvent data model; serves synth-drums (the
// fixed 8 GM rows) AND a variable-size sample drumkit (one row per pad) via an
// injected DrumRows model. Returns a { redraw } handle driven by the session-host
// RAF. Pure logic in core/drum-grid-editing.ts.

import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import { velToColor } from '../../core/velocity-color';
import { velocityToBarHeight, barHitTest, yToVelocity, setVelocity, applyGroupDelta, FAN_PX } from '../../core/velocity-lane-editing';
import { DEFAULT_VELOCITY } from '../../core/velocity-gain';
import type { SessionClip } from '../session';
import type { NoteEvent } from '../../core/notes';
import { withUndo, isTextEditTarget, type HistoryDeps } from '../../save/history-wiring';
import { ticksPerBar, stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';
import {
  resolutionToSnap, clampResolution, DEFAULT_RESOLUTION, snapTickToRes,
  hitInCell, hitsInCell, rowsInRect, rowMove, serializeDrumClipboard, pasteDrumClipboard, clampGroupTick,
  gmDrumRows, type DrumRows, type ResolutionKey, type DrumClipNote,
} from '../../core/drum-grid-editing';
import { createToolToggle, createHelpButton, createResolutionSelect } from '../../core/clip-editor-toolbar';

export const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

/** The rows the editor draws: how many (rows.count), how notes map to them, and a
 *  label per row. Defaults to the fixed 8 GM voices when the caller omits it. */
export interface DrumGridModel { rows: DrumRows; labels: string[] }
const GM_MODEL: DrumGridModel = { rows: gmDrumRows(), labels: DRUM_LANES.map((v) => LANE_LABELS[v]) };

export const LABEL_W = 54;
const RULER_H = 20;
const ROW_H = 26;
const VEL_LANE_H = 46;                       // velocity lane band

type Tool = 'draw' | 'select';
let currentTool: Tool = 'draw';          // persists across clips (session)
let clipboard: DrumClipNote[] | null = null;

// Drum-grid keyboard legend (the real key set handled in the keydown below — no
// note-typing here). Kept next to the handler so the on-screen help cannot drift.
export const DRUM_KEY_LEGEND =
  'Keyboard:  1 / 2 = pencil / select · ←/→ = move · ↑/↓ = change voice\n' +
  '           Ctrl+A = select all · Ctrl+C / Ctrl+X / Ctrl+V = copy / cut / paste\n' +
  '           Esc = deselect · ⌫ = delete';

export interface DrumEditorDeps {
  auditionNote?: (midi: number) => void;
  getPlayheadTick?: () => number;        // -1 when not playing
}
export interface DrumEditorHandle { redraw: () => void; }

export function renderDrumGridEditor(
  host: HTMLElement, clip: SessionClip,
  historyDeps?: HistoryDeps, meter: TimeSignature = DEFAULT_METER,
  deps: DrumEditorDeps = {},
  model: DrumGridModel = GM_MODEL,
): DrumEditorHandle {
  host.innerHTML = '';
  if (!clip.notes) clip.notes = [];
  const notes = (): NoteEvent[] => clip.notes;
  const setNotes = (n: NoteEvent[]) => { clip.notes = n; };
  const audition = deps.auditionNote;

  const rows = model.rows;
  const labels = model.labels;
  const ROWS_N = Math.max(1, rows.count);
  const FRAME_H = RULER_H + ROW_H * ROWS_N + VEL_LANE_H;

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
  let laneDrag: NoteEvent | null = null;
  let lastMouse: { row: number; tick: number } | null = null;
  let mutated = false;
  let playheadTick = -1;

  // ── DOM: toolbar + canvas ─────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.tabIndex = 0; wrap.style.outline = 'none';
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, { display: 'flex', gap: '6px', alignItems: 'center', padding: '4px 2px' } as Partial<CSSStyleDeclaration>);
  const tools = createToolToggle(currentTool, (t) => { currentTool = t; });
  const drawBtn = tools.drawBtn, selBtn = tools.selBtn;

  // Grid resolution select — shared with the piano-roll; persisted on the clip.
  const { control: resCtl } = createResolutionSelect(resolution, (r) => {
    resolution = r; clip.gridResolution = r; draw();
  });

  const help = createHelpButton(DRUM_KEY_LEGEND);
  const helpPopover = help.popover;

  toolbar.append(drawBtn, selBtn, resCtl, help.btn);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block'; canvas.style.cursor = 'crosshair';
  // Popover lives just below the toolbar (inside the wrap), positioned by SCSS.
  wrap.append(toolbar, helpPopover, canvas);
  host.appendChild(wrap);

  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('canvas 2d unavailable');
  const ctx = c2d;

  let gridW = 600, pxPerTick = gridW / patternTicks;
  const xForTick = (t: number) => LABEL_W + t * pxPerTick;
  const yForRow = (r: number) => RULER_H + r * ROW_H;
  const tickFromX = (x: number) => Math.max(0, Math.min(patternTicks - 1, (x - LABEL_W) / pxPerTick));
  const rowFromY = (y: number) => Math.max(0, Math.min(ROWS_N - 1, Math.floor((y - RULER_H) / ROW_H)));

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
    for (let r = 0; r < ROWS_N; r++) {
      const y = yForRow(r);
      ctx.fillStyle = r % 2 ? '#121212' : '#161616'; ctx.fillRect(LABEL_W, y, gridW, ROW_H);
      ctx.fillStyle = '#202020'; ctx.fillRect(0, y, LABEL_W, ROW_H);
      ctx.fillStyle = '#9a9a9a'; ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'middle';
      ctx.fillText(labels[r] ?? '', 4, y + ROW_H / 2);
    }
    // gridlines: in free mode draw only bar/beat reference lines (snap=1 would draw one per tick).
    const lineStep = resolution === 'free' ? beatTicks : snap();
    for (let t = 0; t <= patternTicks; t += lineStep) {
      const x = xForTick(t);
      ctx.strokeStyle = (t % barTicks === 0) ? '#555' : (t % beatTicks === 0) ? '#2f2f2f' : '#1c1c1c';
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
    for (const n of notes()) {
      const r = rows.noteToRow(n.midi);
      if (r < 0) continue;
      const x = xForTick(n.start);
      const maxW = (LABEL_W + gridW) - x;
      const w = Math.max(3, Math.min(n.duration * pxPerTick, maxW));
      const y = yForRow(r) + 3;
      const sel = selection.has(n);
      ctx.fillStyle = sel ? '#7fd4ff' : velToColor(n.velocity);
      ctx.fillRect(x, y, w, ROW_H - 6);
      ctx.strokeStyle = sel ? '#fff' : (n.velocity >= 100 ? '#ffffff' : '#0a0a0a');
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(3, w - 1), ROW_H - 7);
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
    // ── Velocity lane band ────────────────────────────────────────────────────
    const laneTop = RULER_H + ROW_H * ROWS_N;
    ctx.fillStyle = '#0e0e0e'; ctx.fillRect(LABEL_W, laneTop, gridW, VEL_LANE_H);
    ctx.fillStyle = '#202020'; ctx.fillRect(0, laneTop, LABEL_W, VEL_LANE_H);
    const accentY = laneTop + VEL_LANE_H - velocityToBarHeight(100, VEL_LANE_H);
    ctx.strokeStyle = '#ff8c2e'; ctx.globalAlpha = 0.6; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(LABEL_W, accentY); ctx.lineTo(LABEL_W + gridW, accentY); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const seen = new Map<number, number>();
    for (const n of notes()) {
      if (rows.noteToRow(n.midi) < 0) continue;
      const fan = seen.get(n.start) ?? 0; seen.set(n.start, fan + 1);
      const x = xForTick(n.start) + fan * FAN_PX;
      const h = velocityToBarHeight(n.velocity, VEL_LANE_H);
      ctx.fillStyle = selection.has(n) ? '#7fd4ff' : velToColor(n.velocity);
      ctx.fillRect(x, laneTop + VEL_LANE_H - h, 6, h);
    }
  }

  // ── Pencil: click-cycle off → normal → accent → off over the whole cell ───
  function pencilClick(row: number, rawTick: number): void {
    const midi = rows.rowToNote(row);
    const cell = snapTickToRes(rawTick, snap());
    const cluster = hitsInCell(notes(), row, cell, snap(), rows);
    const run = () => {
      if (cluster.length === 0) {
        const dur = Math.max(1, Math.floor(snap() * 0.9));
        notes().push({ midi, start: cell, duration: dur, velocity: DEFAULT_VELOCITY });
        audition?.(midi);
      } else if (cluster.every((n) => n.velocity < 100)) {
        for (const n of cluster) n.velocity = 115;
        audition?.(midi);
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
    const laneTop = RULER_H + ROW_H * ROWS_N;
    const localY = e.clientY - canvas.getBoundingClientRect().top;
    if (localY >= laneTop) {
      const hit = barHitTest(notes(), p.x, xForTick);
      if (hit) {
        historyDeps?.beginGesture?.(); mutated = false;
        laneDrag = hit;
        const vel = yToVelocity(localY - laneTop, VEL_LANE_H);
        if (selection.has(hit) && selection.size > 1) applyGroupDelta([...selection], vel - hit.velocity);
        else setVelocity(hit, vel);
        mutated = true; draw();
        canvas.setPointerCapture(e.pointerId); e.preventDefault();
      }
      return;
    }
    if (e.altKey || e.button === 2) {
      const cell = snapTickToRes(p.tick, snap());
      const cluster = hitsInCell(notes(), p.row, cell, snap(), rows);
      if (cluster.length) { const set = new Set(cluster); const run = () => { setNotes(notes().filter((n) => !set.has(n))); draw(); }; historyDeps ? withUndo(historyDeps, run) : run(); }
      e.preventDefault(); return;
    }
    if (currentTool === 'draw') { pencilClick(p.row, p.tick); e.preventDefault(); return; }
    const cell = snapTickToRes(p.tick, snap());
    const hit = hitInCell(notes(), p.row, cell, snap(), rows);
    if (hit) {
      if (e.shiftKey) { selection.has(hit) ? selection.delete(hit) : selection.add(hit); }
      else if (!selection.has(hit)) { selection.clear(); selection.add(hit); }
      groupDrag = { lastTick: snapTickToRes(p.tick, snap()), lastRow: p.row };
      historyDeps?.beginGesture?.(); mutated = false;
    } else {
      if (!e.shiftKey) selection.clear();
      marquee = { row0: p.row, tick0: p.tick, row1: p.row, tick1: p.tick };
    }
    canvas.setPointerCapture(e.pointerId); draw(); e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e); lastMouse = { row: p.row, tick: p.tick };
    if (laneDrag) {
      const localY = e.clientY - canvas.getBoundingClientRect().top;
      const laneTop = RULER_H + ROW_H * ROWS_N;
      const vel = yToVelocity(localY - laneTop, VEL_LANE_H);
      if (selection.has(laneDrag) && selection.size > 1) applyGroupDelta([...selection], vel - laneDrag.velocity);
      else {
        const hit = barHitTest(notes(), e.clientX - canvas.getBoundingClientRect().left, xForTick) ?? laneDrag;
        setVelocity(hit, vel);
      }
      mutated = true; draw();
      return;
    }
    if (marquee) { marquee.row1 = p.row; marquee.tick1 = p.tick; draw(); return; }
    if (groupDrag) {
      const wantTick = snapTickToRes(p.tick, snap());
      const dTick = clampGroupTick([...selection], wantTick - groupDrag.lastTick, patternTicks);
      const dRow = p.row - groupDrag.lastRow;
      if (dTick !== 0) { for (const n of selection) n.start += dTick; groupDrag.lastTick += dTick; mutated = true; }
      if (dRow !== 0) {
        const moved = rowMove([...selection], dRow, rows);
        for (const [n, midi] of moved) n.midi = midi;
        groupDrag.lastRow += dRow; mutated = true;
      }
      if (dTick !== 0 || dRow !== 0) draw();
      return;
    }
  });

  const endPointer = (e: PointerEvent) => {
    if (laneDrag) {
      laneDrag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      historyDeps?.endGesture?.();
      return;
    }
    if (marquee) {
      for (const n of rowsInRect(notes(), marquee, rows)) selection.add(n);
      marquee = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } draw(); return;
    }
    if (groupDrag) {
      groupDrag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      historyDeps?.endGesture?.();
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
    if (!cmd && e.key === '1') { currentTool = 'draw'; tools.set('draw'); e.preventDefault(); return; }
    if (!cmd && e.key === '2') { currentTool = 'select'; tools.set('select'); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'a') { selection.clear(); for (const n of notes()) selection.add(n); draw(); e.preventDefault(); return; }
    if (e.key === 'Escape') { selection.clear(); draw(); e.preventDefault(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
      const set = new Set(selection);
      const run = () => { setNotes(notes().filter((n) => !set.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
    if (cmd && e.key.toLowerCase() === 'c' && selection.size) { clipboard = serializeDrumClipboard([...selection], rows); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'x' && selection.size) {
      clipboard = serializeDrumClipboard([...selection], rows);
      const set = new Set(selection);
      const run = () => { setNotes(notes().filter((n) => !set.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
    if (cmd && e.key.toLowerCase() === 'v' && clipboard && clipboard.length) {
      const anchorTick = snapTickToRes(lastMouse?.tick ?? 0, snap());
      const anchorRow = lastMouse?.row ?? 0;
      const pasted = pasteDrumClipboard(clipboard, anchorTick, anchorRow, patternTicks, rows);
      const run = () => { for (const n of pasted) notes().push(n); selection.clear(); for (const n of pasted) selection.add(n); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
    if (selection.size && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const run = () => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const d = clampGroupTick([...selection], e.key === 'ArrowRight' ? snap() : -snap(), patternTicks);
          for (const n of selection) n.start += d;
        } else {
          const moved = rowMove([...selection], e.key === 'ArrowDown' ? 1 : -1, rows);
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
