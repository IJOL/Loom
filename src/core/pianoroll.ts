// Piano-roll editor for a NoteEvent[] array. Drag-create, drag-move,
// drag-resize from the right edge, alt-click / right-click to delete.
// Ableton-style zoom: scrub the time ruler (↕ zoom time, ↔ pan) and the piano
// keyboard (↕ zoom pitch); native scrollbars pan. Snap defaults to 16th notes.

import { TICKS_PER_STEP, type NoteEvent } from './notes';
import {
  clampZoom, scrubToZoom, zoomAroundAnchor, maxZoomX, maxZoomY,
  defaultViewState, type ViewState,
} from './pianoroll-zoom';

export interface PianoRollOpts {
  /** Host element; the editor frame is built inside it. */
  host: HTMLElement;
  getNotes: () => NoteEvent[];
  setNotes: (notes: NoteEvent[]) => void;
  patternTicks: number;
  minMidi?: number;
  maxMidi?: number;
  snapTicks?: number;
  onChange?: () => void;
  getPlayheadTick?: () => number; // -1 when not playing
  /** Initial zoom/scroll for this clip (defaults to fit). */
  viewState?: ViewState;
  /** Called on every zoom/scroll so the caller can persist per-clip state. */
  onViewChange?: (v: ViewState) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  onGestureCancel?: () => void;
}

export interface PianoRollHandle {
  redraw: () => void;
}

const BLACK_KEY_PCS = [1, 3, 6, 8, 10];

// Frame geometry (CSS px).
const KEYS_W = 42;
const RULER_H = 26;
const FRAME_H = 320; // total editor height; grid viewport gets FRAME_H - RULER_H

export interface PianoRollFrame {
  frame: HTMLDivElement;
  rulerWrap: HTMLDivElement; keysWrap: HTMLDivElement; gridVp: HTMLDivElement;
  rulerCanvas: HTMLCanvasElement; keysCanvas: HTMLCanvasElement; gridCanvas: HTMLCanvasElement;
}

/** Build the 2×2 editor frame (corner / ruler / keyboard / grid-viewport)
 *  inside `host`. Ruler and keyboard live OUTSIDE the scroll viewport so they
 *  can be pinned (repositioned via transform) as the grid scrolls. */
export function buildEditorFrame(host: HTMLElement): PianoRollFrame {
  host.innerHTML = '';

  const frame = document.createElement('div');
  frame.className = 'pr-frame';
  Object.assign(frame.style, {
    display: 'grid',
    gridTemplateColumns: `${KEYS_W}px 1fr`,
    gridTemplateRows: `${RULER_H}px 1fr`,
    height: `${FRAME_H}px`,
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: '6px',
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const corner = document.createElement('div');
  corner.className = 'pr-corner';
  Object.assign(corner.style, { background: '#202020', borderRight: '1px solid #2a2a2a', borderBottom: '1px solid #2a2a2a' } as Partial<CSSStyleDeclaration>);

  const mkWrap = (cls: string, cursor: string): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = cls;
    Object.assign(d.style, { overflow: 'hidden', position: 'relative', cursor } as Partial<CSSStyleDeclaration>);
    return d;
  };
  const mkCanvas = (absolute: boolean): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    if (absolute) Object.assign(c.style, { position: 'absolute', top: '0', left: '0', display: 'block' } as Partial<CSSStyleDeclaration>);
    else c.style.display = 'block';
    return c;
  };

  const rulerWrap = mkWrap('pr-ruler', 'ns-resize');
  rulerWrap.style.borderBottom = '1px solid #2a2a2a';
  rulerWrap.style.background = '#181818';
  const rulerCanvas = mkCanvas(true);
  rulerWrap.appendChild(rulerCanvas);

  const keysWrap = mkWrap('pr-keys', 'ns-resize');
  keysWrap.style.borderRight = '1px solid #2a2a2a';
  keysWrap.style.background = '#1a1a1a';
  const keysCanvas = mkCanvas(true);
  keysWrap.appendChild(keysCanvas);

  const gridVp = document.createElement('div');
  gridVp.className = 'pr-grid-vp';
  Object.assign(gridVp.style, { overflow: 'auto', position: 'relative', background: '#0a0a0a' } as Partial<CSSStyleDeclaration>);
  const gridCanvas = mkCanvas(false);
  gridVp.appendChild(gridCanvas);

  frame.append(corner, rulerWrap, keysWrap, gridVp);
  host.appendChild(frame);

  return { frame, rulerWrap, keysWrap, gridVp, rulerCanvas, keysCanvas, gridCanvas };
}

function ctx2d(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const c = cv.getContext('2d');
  if (!c) throw new Error('canvas 2d context unavailable');
  return c;
}

function setSize(cv: HTMLCanvasElement, w: number, h: number): void {
  cv.width = w; cv.height = h;
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
}

export function createPianoRoll(opts: PianoRollOpts): PianoRollHandle {
  const minMidi = opts.minMidi ?? 36;
  const maxMidi = opts.maxMidi ?? 96;
  const snap = opts.snapTicks ?? TICKS_PER_STEP;
  const noteCount = maxMidi - minMidi + 1;

  const f = buildEditorFrame(opts.host);
  const gctx = ctx2d(f.gridCanvas);
  const rctx = ctx2d(f.rulerCanvas);
  const kctx = ctx2d(f.keysCanvas);

  // View state (mutable). Initialised from the caller, defaults to fit.
  let { zoomX, zoomY, scrollLeft, scrollTop } = opts.viewState ?? defaultViewState();
  // Geometry derived from zoom + viewport (recomputed in geom()).
  let gridW = 0, gridH = 0, pxPerTick = 0, rowHeight = 0;

  const xForTick = (t: number) => t * pxPerTick;
  const yForMidi = (m: number) => (maxMidi - m) * rowHeight;
  const tickFromX = (x: number) => Math.max(0, Math.min(opts.patternTicks - 1, pxPerTick > 0 ? x / pxPerTick : 0));
  const midiFromY = (y: number) => maxMidi - Math.max(0, Math.min(noteCount - 1, Math.floor(rowHeight > 0 ? y / rowHeight : 0)));

  function geom(): void {
    const vw = f.gridVp.clientWidth || 1;
    const vh = f.gridVp.clientHeight || 1;
    zoomX = clampZoom(zoomX, maxZoomX(vw));
    zoomY = clampZoom(zoomY, maxZoomY(vh, noteCount));
    gridW = Math.round(vw * zoomX);
    gridH = Math.round(vh * zoomY);
    pxPerTick = gridW / opts.patternTicks;
    rowHeight = gridH / noteCount;
  }

  function drawGrid(): void {
    const w = gridW, h = gridH;
    gctx.fillStyle = '#0a0a0a'; gctx.fillRect(0, 0, w, h);
    for (let i = 0; i < noteCount; i++) {
      const midi = maxMidi - i;
      if (BLACK_KEY_PCS.includes(((midi % 12) + 12) % 12)) {
        gctx.fillStyle = '#161616'; gctx.fillRect(0, i * rowHeight, w, rowHeight);
      }
      if (midi % 12 === 0) {
        gctx.strokeStyle = '#2a2a2a';
        gctx.beginPath(); gctx.moveTo(0, i * rowHeight); gctx.lineTo(w, i * rowHeight); gctx.stroke();
      }
    }
    const steps = opts.patternTicks / TICKS_PER_STEP;
    for (let s = 0; s <= steps; s++) {
      const x = s * TICKS_PER_STEP * pxPerTick;
      if (s % 16 === 0) gctx.strokeStyle = '#555';
      else if (s % 4 === 0) gctx.strokeStyle = '#2f2f2f';
      else gctx.strokeStyle = '#1c1c1c';
      gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, h); gctx.stroke();
    }
    for (const n of opts.getNotes()) {
      if (n.midi < minMidi || n.midi > maxMidi) continue;
      const x = xForTick(n.start), x2 = xForTick(n.start + n.duration), y = yForMidi(n.midi);
      gctx.fillStyle = n.velocity >= 100 ? '#ffaa44' : '#3498db';
      gctx.fillRect(x + 1, y + 1, Math.max(2, x2 - x - 2), rowHeight - 2);
      gctx.strokeStyle = '#0a0a0a'; gctx.strokeRect(x + 0.5, y + 0.5, x2 - x - 1, rowHeight - 1);
    }
    const ph = opts.getPlayheadTick?.() ?? -1;
    if (ph >= 0) {
      const x = xForTick(ph);
      gctx.strokeStyle = '#f7d000'; gctx.lineWidth = 1;
      gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, h); gctx.stroke();
      // Follow the playhead horizontally (assignment triggers the scroll
      // listener, which re-pins the strips and persists).
      if (gridW > f.gridVp.clientWidth) {
        const target = Math.max(0, x - f.gridVp.clientWidth / 2);
        if (Math.abs(f.gridVp.scrollLeft - target) > 2) f.gridVp.scrollLeft = target;
      }
    }
  }

  function drawRuler(): void {
    rctx.fillStyle = '#181818'; rctx.fillRect(0, 0, gridW, RULER_H);
    const steps = opts.patternTicks / TICKS_PER_STEP;
    for (let s = 0; s <= steps; s++) {
      const x = s * TICKS_PER_STEP * pxPerTick;
      if (s % 16 === 0) {
        rctx.strokeStyle = '#6a6a6a';
        rctx.beginPath(); rctx.moveTo(x, 4); rctx.lineTo(x, RULER_H); rctx.stroke();
        rctx.fillStyle = '#c8c8c8'; rctx.font = '11px ui-monospace, monospace'; rctx.textBaseline = 'middle';
        rctx.fillText(String(s / 16 + 1), x + 4, RULER_H / 2);
      } else if (s % 4 === 0) {
        rctx.strokeStyle = '#333';
        rctx.beginPath(); rctx.moveTo(x, RULER_H - 8); rctx.lineTo(x, RULER_H); rctx.stroke();
      }
    }
  }

  function drawKeys(): void {
    kctx.fillStyle = '#1a1a1a'; kctx.fillRect(0, 0, KEYS_W, gridH);
    for (let i = 0; i < noteCount; i++) {
      const midi = maxMidi - i, pc = ((midi % 12) + 12) % 12;
      kctx.fillStyle = BLACK_KEY_PCS.includes(pc) ? '#0e0e0e' : '#1f1f1f';
      kctx.fillRect(0, i * rowHeight, KEYS_W - 1, rowHeight);
      kctx.strokeStyle = '#070707'; kctx.strokeRect(0, i * rowHeight + 0.5, KEYS_W - 1, rowHeight);
      if (pc === 0 && rowHeight >= 9) {
        kctx.fillStyle = '#9a9a9a'; kctx.font = '9px ui-monospace, monospace'; kctx.textBaseline = 'middle';
        kctx.fillText(`C${Math.floor(midi / 12) - 1}`, 4, i * rowHeight + rowHeight / 2);
      }
    }
  }

  function syncStrips(): void {
    f.rulerCanvas.style.transform = `translateX(${-f.gridVp.scrollLeft}px)`;
    f.keysCanvas.style.transform = `translateY(${-f.gridVp.scrollTop}px)`;
  }
  function persist(): void {
    opts.onViewChange?.({ zoomX, zoomY, scrollLeft: f.gridVp.scrollLeft, scrollTop: f.gridVp.scrollTop });
  }

  /** Full relayout: resize all canvases, redraw all three surfaces. */
  function layoutAll(): void {
    geom();
    setSize(f.gridCanvas, gridW, gridH);
    setSize(f.rulerCanvas, gridW, RULER_H);
    setSize(f.keysCanvas, KEYS_W, gridH);
    drawGrid(); drawRuler(); drawKeys();
  }

  // ── Scroll: re-pin strips + persist ───────────────────────────────────────
  f.gridVp.addEventListener('scroll', () => {
    scrollLeft = f.gridVp.scrollLeft; scrollTop = f.gridVp.scrollTop;
    syncStrips(); persist();
  });

  // ── Ruler scrub: ↕ zoom-H (anchored), ↔ pan-H ─────────────────────────────
  let rulerDrag = false, rLastX = 0, rLastY = 0;
  f.rulerWrap.addEventListener('pointerdown', (e) => {
    rulerDrag = true; rLastX = e.clientX; rLastY = e.clientY;
    f.rulerWrap.setPointerCapture(e.pointerId); e.preventDefault();
  });
  f.rulerWrap.addEventListener('pointermove', (e) => {
    if (!rulerDrag) return;
    const dy = e.clientY - rLastY, dx = e.clientX - rLastX;
    rLastX = e.clientX; rLastY = e.clientY;
    const oldGridW = gridW;
    zoomX = scrubToZoom(zoomX, dy);
    geom();
    setSize(f.gridCanvas, gridW, gridH); setSize(f.rulerCanvas, gridW, RULER_H);
    drawGrid(); drawRuler();
    const anchorPx = e.clientX - f.rulerWrap.getBoundingClientRect().left;
    f.gridVp.scrollLeft = zoomAroundAnchor(f.gridVp.scrollLeft, anchorPx, oldGridW, gridW) - dx;
    syncStrips(); persist();
  });
  const rulerEnd = (e: PointerEvent) => { rulerDrag = false; try { f.rulerWrap.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
  f.rulerWrap.addEventListener('pointerup', rulerEnd);
  f.rulerWrap.addEventListener('pointercancel', rulerEnd);

  // ── Keyboard scrub: ↕ zoom-V (anchored) ───────────────────────────────────
  let keysDrag = false, kLastY = 0;
  f.keysWrap.addEventListener('pointerdown', (e) => {
    keysDrag = true; kLastY = e.clientY;
    f.keysWrap.setPointerCapture(e.pointerId); e.preventDefault();
  });
  f.keysWrap.addEventListener('pointermove', (e) => {
    if (!keysDrag) return;
    const dy = e.clientY - kLastY; kLastY = e.clientY;
    const oldGridH = gridH;
    zoomY = scrubToZoom(zoomY, dy);
    geom();
    setSize(f.gridCanvas, gridW, gridH); setSize(f.keysCanvas, KEYS_W, gridH);
    drawGrid(); drawKeys();
    const anchorPy = e.clientY - f.keysWrap.getBoundingClientRect().top;
    f.gridVp.scrollTop = zoomAroundAnchor(f.gridVp.scrollTop, anchorPy, oldGridH, gridH);
    syncStrips(); persist();
  });
  const keysEnd = (e: PointerEvent) => { keysDrag = false; try { f.keysWrap.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
  f.keysWrap.addEventListener('pointerup', keysEnd);
  f.keysWrap.addEventListener('pointercancel', keysEnd);

  // ── Note editing on the grid (unchanged logic, sans keyboard column) ──────
  type Interaction = { type: 'move' | 'resize'; note: NoteEvent; offsetTick: number };
  let interaction: Interaction | null = null;
  let gestureMutated = false;

  const isResizeEdge = (n: NoteEvent, tick: number) => {
    const edgeRange = Math.max(snap / 3, 6);
    return tick >= n.start + n.duration - edgeRange && tick <= n.start + n.duration + edgeRange / 2;
  };
  const findNoteAt = (tick: number, midi: number): NoteEvent | null => {
    const notes = opts.getNotes();
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.midi === midi && tick >= n.start && tick < n.start + n.duration) return n;
    }
    return null;
  };
  const pointerPos = (e: PointerEvent) => {
    const rect = f.gridCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return { tick: tickFromX(x), midi: midiFromY(y) };
  };

  f.gridCanvas.addEventListener('pointerdown', (e) => {
    const { tick, midi } = pointerPos(e);

    if (e.altKey || e.button === 2) {
      const hit = findNoteAt(tick, midi);
      if (hit) {
        opts.onGestureStart?.();
        opts.setNotes(opts.getNotes().filter((n) => n !== hit));
        opts.onChange?.();
        drawGrid();
        opts.onGestureEnd?.();
      }
      e.preventDefault();
      return;
    }

    opts.onGestureStart?.();
    gestureMutated = false;

    const hit = findNoteAt(tick, midi);
    if (hit) {
      if (isResizeEdge(hit, tick)) interaction = { type: 'resize', note: hit, offsetTick: 0 };
      else interaction = { type: 'move', note: hit, offsetTick: tick - hit.start };
    } else {
      const snappedStart = Math.floor(tick / snap) * snap;
      const newNote: NoteEvent = { start: snappedStart, duration: snap, midi, velocity: 80 };
      opts.getNotes().push(newNote);
      interaction = { type: 'resize', note: newNote, offsetTick: 0 };
      gestureMutated = true;
      opts.onChange?.();
    }
    f.gridCanvas.setPointerCapture(e.pointerId);
    drawGrid();
    e.preventDefault();
  });

  f.gridCanvas.addEventListener('pointermove', (e) => {
    const { tick, midi } = pointerPos(e);
    if (!interaction) {
      const hit = findNoteAt(tick, midi);
      f.gridCanvas.style.cursor = hit ? (isResizeEdge(hit, tick) ? 'ew-resize' : 'move') : 'crosshair';
      return;
    }
    if (interaction.type === 'move') {
      const newStart = Math.max(0, Math.floor((tick - interaction.offsetTick) / snap) * snap);
      const maxStart = opts.patternTicks - interaction.note.duration;
      interaction.note.start = Math.min(maxStart, newStart);
      interaction.note.midi = Math.max(minMidi, Math.min(maxMidi, midi));
    } else {
      const newDur = Math.max(snap, Math.ceil((tick - interaction.note.start) / snap) * snap);
      interaction.note.duration = Math.min(opts.patternTicks - interaction.note.start, newDur);
    }
    gestureMutated = true;
    drawGrid();
    opts.onChange?.();
  });

  const endDrag = (e: PointerEvent) => {
    if (!interaction) return;
    interaction = null;
    try { f.gridCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (gestureMutated) opts.onGestureEnd?.();
    else opts.onGestureCancel?.();
  };
  f.gridCanvas.addEventListener('pointerup', endDrag);
  f.gridCanvas.addEventListener('pointercancel', endDrag);
  f.gridCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Initial mount ─────────────────────────────────────────────────────────
  let lastVW = f.gridVp.clientWidth, lastVH = f.gridVp.clientHeight;
  layoutAll();
  f.gridVp.scrollLeft = scrollLeft;
  f.gridVp.scrollTop = scrollTop;
  syncStrips();

  // redraw() runs every animation frame (driven by session-host's RAF loop) to
  // animate the playhead. It also cheaply detects a viewport resize and does a
  // full relayout when needed — so there is NO window 'resize' listener to leak
  // across clip re-renders.
  function redraw(): void {
    const vw = f.gridVp.clientWidth, vh = f.gridVp.clientHeight;
    if (vw !== lastVW || vh !== lastVH) {
      lastVW = vw; lastVH = vh;
      layoutAll();
      f.gridVp.scrollLeft = scrollLeft; f.gridVp.scrollTop = scrollTop;
      syncStrips();
    } else {
      drawGrid();
    }
  }

  return { redraw };
}
