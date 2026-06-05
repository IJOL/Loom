// Canvas drum-rack editor (Spec 3): 8 voice rows × time, variable resolution +
// free off-grid placement, selection/clipboard/group-move, and a canvas playhead.
// Replaces the button matrix. Same NoteEvent + GM-midi data model; serves
// synth-drums and the sampler drumkit (rows are always DRUM_LANES). Returns a
// { redraw } handle driven by the session-host RAF. Pure logic in core/drum-grid-editing.ts.

import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import { velToColor } from '../../core/velocity-color';
import { DEFAULT_VELOCITY } from '../../core/velocity-gain';
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
  }

  // ── Pencil: click-cycle off → normal → accent → off over the whole cell ───
  function pencilClick(row: number, rawTick: number): void {
    const voice = ROWS[row];
    const cell = snapTickToRes(rawTick, snap());
    const cluster = hitsInCell(notes(), voice, cell, snap());
    const run = () => {
      if (cluster.length === 0) {
        const dur = Math.max(1, Math.floor(snap() * 0.9));
        notes().push({ midi: VOICE_MIDI[voice], start: cell, duration: dur, velocity: DEFAULT_VELOCITY });
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
