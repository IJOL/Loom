// src/session/clip-editors/clip-editor-loop.ts
// Unified loop editor (layout A): toolbar (bpm/bars/warp/mode/resolution) +
// waveform strip with slice markers + a slice grid (rows = slices). Canvas glue
// over core/slice-grid-editing.ts + sample-cache for the waveform. Returns a
// { redraw } handle driven by the session-host RAF.

import type { SessionClip } from '../session';
import type { NoteEvent } from '../../core/notes';
import { sampleCache } from '../../samples/sample-cache';
import { SLICE_BASE_NOTE } from '../../core/slice-clip';
import { withUndo, isTextEditTarget, type HistoryDeps } from '../../save/history-wiring';
import { ticksPerBar, stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';
import {
  RESOLUTIONS, resolutionToSnap, clampResolution, DEFAULT_RESOLUTION, snapTickToRes, type ResolutionKey,
} from '../../core/drum-grid-editing';
import {
  hitInCellRow, hitsInCellRow, rowsInRectRow, rowMoveContig, clampGroupTickContig,
} from '../../core/slice-grid-editing';

const LABEL_W = 54;
const RULER_H = 20;
const WAVE_H = 56;
const ROW_H = 22;

export interface LoopEditorDeps {
  auditionNote?: (midi: number) => void;
  getPlayheadTick?: () => number;
}
export interface LoopEditorHandle { redraw: () => void; }

let currentTool: 'draw' | 'select' = 'draw';

export function renderLoopEditor(
  host: HTMLElement, clip: SessionClip,
  historyDeps?: HistoryDeps, meter: TimeSignature = DEFAULT_METER,
  deps: LoopEditorDeps = {},
): LoopEditorHandle {
  host.innerHTML = '';
  const sample = clip.sample!;
  const slices = sample.slices ?? [];
  const rowCount = Math.max(1, slices.length);
  if (!clip.notes) clip.notes = [];
  const notes = (): NoteEvent[] => clip.notes;
  const setNotes = (n: NoteEvent[]) => { clip.notes = n; };

  let resolution: ResolutionKey = clampResolution(clip.gridResolution ?? DEFAULT_RESOLUTION);
  clip.gridResolution = resolution;
  const snap = () => resolutionToSnap(resolution);

  const patternTicks = Math.max(1, clip.lengthBars * ticksPerBar(meter));
  const barTicks = ticksPerBar(meter);
  const beatsPerBar = stepsPerBar(meter) / stepsPerBeat(meter);
  const beatTicks = barTicks / beatsPerBar;
  const FRAME_H = RULER_H + WAVE_H + ROW_H * rowCount;

  const selection = new Set<NoteEvent>();
  let marquee: { row0: number; tick0: number; row1: number; tick1: number } | null = null;
  let groupDrag: { lastTick: number; lastRow: number } | null = null;
  let lastMouse: { row: number; tick: number } | null = null;
  let mutated = false;
  let playheadTick = -1;

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.tabIndex = 0; wrap.style.outline = 'none';
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 2px', flexWrap: 'wrap', fontSize: '11px' } as Partial<CSSStyleDeclaration>);

  const bpmLabel = document.createElement('span');
  bpmLabel.textContent = `BPM ${Math.round(sample.originalBpm ?? 120)}`;
  bpmLabel.title = 'Click to edit detected tempo';
  bpmLabel.style.cursor = 'pointer';
  bpmLabel.addEventListener('click', () => {
    const v = Number(prompt('Loop tempo (BPM)', String(Math.round(sample.originalBpm ?? 120))));
    if (Number.isFinite(v) && v > 1) { sample.originalBpm = v; bpmLabel.textContent = `BPM ${Math.round(v)}`; }
  });

  const barsLabel = document.createElement('span');
  barsLabel.textContent = `${clip.lengthBars} bar${clip.lengthBars > 1 ? 's' : ''}`;

  const warpBtn = document.createElement('button');
  const refreshWarp = () => { warpBtn.textContent = sample.warp ? '♺ Warp ON' : '♺ Warp OFF'; };
  warpBtn.addEventListener('click', () => { sample.warp = !sample.warp; refreshWarp(); });
  refreshWarp();

  const modeSel = document.createElement('select');
  for (const m of ['slice', 'stretch']) { const o = document.createElement('option'); o.value = m; o.textContent = m; modeSel.appendChild(o); }
  modeSel.value = sample.warpMode ?? 'slice';
  modeSel.addEventListener('change', () => { sample.warpMode = modeSel.value as 'slice' | 'stretch'; });

  const resSel = document.createElement('select');
  for (const r of RESOLUTIONS) { const o = document.createElement('option'); o.value = r; o.textContent = r; resSel.appendChild(o); }
  resSel.value = resolution;
  resSel.addEventListener('change', () => { resolution = clampResolution(resSel.value); clip.gridResolution = resolution; draw(); });

  const sliceCount = document.createElement('span');
  sliceCount.textContent = `${slices.length} slices`;

  toolbar.append(bpmLabel, barsLabel, warpBtn, modeSel, resSel, sliceCount);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block'; canvas.style.cursor = 'crosshair';
  wrap.append(toolbar, canvas);
  host.appendChild(wrap);

  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('canvas 2d unavailable');
  const ctx = c2d;

  let gridW = 600, pxPerTick = gridW / patternTicks;
  const xForTick = (t: number) => LABEL_W + t * pxPerTick;
  const yForRow = (r: number) => RULER_H + WAVE_H + r * ROW_H;
  const tickFromX = (x: number) => Math.max(0, Math.min(patternTicks - 1, (x - LABEL_W) / pxPerTick));
  const rowFromY = (y: number) => Math.max(0, Math.min(rowCount - 1, Math.floor((y - RULER_H - WAVE_H) / ROW_H)));

  function resize(): void {
    const w = Math.max(320, wrap.clientWidth || host.clientWidth || 600);
    gridW = w - LABEL_W; pxPerTick = gridW / patternTicks;
    canvas.width = w; canvas.height = FRAME_H;
    canvas.style.width = `${w}px`; canvas.style.height = `${FRAME_H}px`;
    draw();
  }

  function drawWaveform(): void {
    ctx.fillStyle = '#0c0c12'; ctx.fillRect(LABEL_W, RULER_H, gridW, WAVE_H);
    const buf = sampleCache.get(sample.sampleId);
    if (buf) {
      const data = buf.getChannelData(0);
      const mid = RULER_H + WAVE_H / 2;
      ctx.strokeStyle = '#4a6a8a'; ctx.beginPath();
      for (let px = 0; px < gridW; px++) {
        const i0 = Math.floor((px / gridW) * data.length);
        const i1 = Math.floor(((px + 1) / gridW) * data.length);
        let peak = 0; for (let i = i0; i < i1 && i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        const x = LABEL_W + px;
        ctx.moveTo(x, mid - peak * (WAVE_H / 2)); ctx.lineTo(x, mid + peak * (WAVE_H / 2));
      }
      ctx.stroke();
    }
    // slice markers
    ctx.strokeStyle = '#ffb454';
    for (const s of slices) {
      const frac = s.start / Math.max(0.001, sample.trimEnd - sample.trimStart);
      const x = LABEL_W + frac * gridW;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, RULER_H + WAVE_H); ctx.stroke();
    }
  }

  function draw(): void {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, canvas.width, FRAME_H);
    drawWaveform();
    for (let r = 0; r < rowCount; r++) {
      const y = yForRow(r);
      ctx.fillStyle = r % 2 ? '#121212' : '#161616'; ctx.fillRect(LABEL_W, y, gridW, ROW_H);
      ctx.fillStyle = '#202020'; ctx.fillRect(0, y, LABEL_W, ROW_H);
      ctx.fillStyle = '#9a9a9a'; ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'middle';
      ctx.fillText(`S${r + 1}`, 4, y + ROW_H / 2);
    }
    const lineStep = resolution === 'free' ? beatTicks : snap();
    for (let t = 0; t <= patternTicks; t += lineStep) {
      const x = xForTick(t);
      ctx.strokeStyle = (t % barTicks === 0) ? '#555' : (t % beatTicks === 0) ? '#2f2f2f' : '#1c1c1c';
      ctx.beginPath(); ctx.moveTo(x, RULER_H + WAVE_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
    for (const n of notes()) {
      const r = n.midi - SLICE_BASE_NOTE;
      if (r < 0 || r >= rowCount) continue;
      const x = xForTick(n.start);
      const w = Math.max(3, Math.min(n.duration * pxPerTick, (LABEL_W + gridW) - x));
      const y = yForRow(r) + 3;
      const sel = selection.has(n);
      ctx.fillStyle = sel ? '#7fd4ff' : (n.velocity >= 100 ? '#ffaa44' : '#3498db');
      ctx.fillRect(x, y, w, ROW_H - 6);
    }
    if (marquee) {
      const x0 = xForTick(Math.min(marquee.tick0, marquee.tick1));
      const x1 = xForTick(Math.max(marquee.tick0, marquee.tick1));
      const y0 = yForRow(Math.min(marquee.row0, marquee.row1));
      const y1 = yForRow(Math.max(marquee.row0, marquee.row1)) + ROW_H;
      ctx.strokeStyle = '#7fd4ff'; ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, x1 - x0), Math.max(1, y1 - y0)); ctx.setLineDash([]);
    }
    if (playheadTick >= 0) {
      const x = xForTick(playheadTick);
      ctx.strokeStyle = '#f7d000'; ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
  }

  function pencilClick(row: number, rawTick: number): void {
    const cell = snapTickToRes(rawTick, snap());
    const midi = SLICE_BASE_NOTE + row;
    const cluster = hitsInCellRow(notes(), row, cell, snap(), SLICE_BASE_NOTE);
    const run = () => {
      if (cluster.length === 0) {
        notes().push({ midi, start: cell, duration: Math.max(1, Math.floor(snap() * 0.9)), velocity: 90 });
        deps.auditionNote?.(midi);
      } else if (cluster.every((n) => n.velocity < 100)) {
        for (const n of cluster) n.velocity = 115; deps.auditionNote?.(midi);
      } else {
        const set = new Set(cluster); setNotes(notes().filter((n) => !set.has(n)));
      }
      draw();
    };
    historyDeps ? withUndo(historyDeps, run) : run();
  }

  const pos = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return { row: rowFromY(e.clientY - rect.top), x, tick: tickFromX(x) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const p = pos(e); wrap.focus();
    if (p.x < LABEL_W || (e.clientY - canvas.getBoundingClientRect().top) < RULER_H + WAVE_H) return;
    if (e.altKey || e.button === 2) {
      const cluster = hitsInCellRow(notes(), p.row, snapTickToRes(p.tick, snap()), snap(), SLICE_BASE_NOTE);
      if (cluster.length) { const set = new Set(cluster); const run = () => { setNotes(notes().filter((n) => !set.has(n))); draw(); }; historyDeps ? withUndo(historyDeps, run) : run(); }
      e.preventDefault(); return;
    }
    if (currentTool === 'draw') { pencilClick(p.row, p.tick); e.preventDefault(); return; }
    const hit = hitInCellRow(notes(), p.row, snapTickToRes(p.tick, snap()), snap(), SLICE_BASE_NOTE);
    if (hit) {
      if (e.shiftKey) { selection.has(hit) ? selection.delete(hit) : selection.add(hit); }
      else if (!selection.has(hit)) { selection.clear(); selection.add(hit); }
      groupDrag = { lastTick: snapTickToRes(p.tick, snap()), lastRow: p.row };
      historyDeps?.history.beginGesture(historyDeps.snapshot()); mutated = false;
    } else { if (!e.shiftKey) selection.clear(); marquee = { row0: p.row, tick0: p.tick, row1: p.row, tick1: p.tick }; }
    canvas.setPointerCapture(e.pointerId); draw(); e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e); lastMouse = { row: p.row, tick: p.tick };
    if (marquee) { marquee.row1 = p.row; marquee.tick1 = p.tick; draw(); return; }
    if (groupDrag) {
      const wantTick = snapTickToRes(p.tick, snap());
      const dTick = clampGroupTickContig([...selection], wantTick - groupDrag.lastTick, patternTicks);
      const dRow = p.row - groupDrag.lastRow;
      if (dTick !== 0) { for (const n of selection) n.start += dTick; groupDrag.lastTick += dTick; mutated = true; }
      if (dRow !== 0) { const moved = rowMoveContig([...selection], dRow, SLICE_BASE_NOTE, rowCount); for (const [n, m] of moved) n.midi = m; groupDrag.lastRow += dRow; mutated = true; }
      if (dTick !== 0 || dRow !== 0) draw();
    }
  });

  const endPointer = (e: PointerEvent) => {
    if (marquee) { for (const n of rowsInRectRow(notes(), marquee, SLICE_BASE_NOTE)) selection.add(n); marquee = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* */ } draw(); return; }
    if (groupDrag) { groupDrag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* */ } if (mutated) historyDeps?.history.commitGesture(); else historyDeps?.history.cancelGesture(); }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  wrap.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd && e.key === '1') { currentTool = 'draw'; e.preventDefault(); return; }
    if (!cmd && e.key === '2') { currentTool = 'select'; e.preventDefault(); return; }
    if (e.key === 'Escape') { selection.clear(); draw(); e.preventDefault(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
      const set = new Set(selection); const run = () => { setNotes(notes().filter((n) => !set.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault();
    }
  });

  resize();
  let lastW = wrap.clientWidth;
  function redraw(): void {
    const w = wrap.clientWidth;
    if (w && w !== lastW) { lastW = w; resize(); }
    const ph = deps.getPlayheadTick?.() ?? -1;
    if (ph !== playheadTick) { playheadTick = ph; draw(); }
  }
  // suppress unused variable warning for lastMouse
  void lastMouse;
  return { redraw };
}
