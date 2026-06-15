// Piano-roll editor for a NoteEvent[] array. Drag-create, drag-move,
// drag-resize from the right edge, alt-click / right-click to delete.
// Ableton-style zoom: scrub the time ruler (↕ zoom time, ↔ pan) and the piano
// keyboard (↕ zoom pitch); native scrollbars pan. Snap defaults to 16th notes.

import { TICKS_PER_STEP, type NoteEvent } from './notes';
import { velToColor } from './velocity-color';
import { velocityToBarHeight, FAN_PX, yToVelocity, barHitTest, setVelocity, applyGroupDelta } from './velocity-lane-editing';
import { DEFAULT_VELOCITY } from './velocity-gain';
import { EDITOR_MIN_MIDI, EDITOR_MAX_MIDI } from './pianoroll-range';
import {
  clampZoom, scrubToZoom, zoomAroundAnchor, maxZoomX, maxZoomY,
  defaultViewState, type ViewState,
} from './pianoroll-zoom';
import {
  notesInRect, translateGroup, serializeClipboard, pasteTranslate, midiForKey,
  quantizeRecorded, clampOctaveBase, octaveBaseLabel, PIANO_KEY_LEGEND, snapNoteMidi, type ClipboardNote, type ScaleCtx,
} from './piano-roll-editing';
import { isTextEditTarget } from '../save/history-wiring';
import {
  createToolToggle, createHelpButton, createGridControl, createResolutionSelect,
} from './clip-editor-toolbar';
import { resolutionToSnap, DEFAULT_RESOLUTION, type ResolutionKey } from './drum-grid-editing';

type Tool = 'draw' | 'select';
// Module-level so the tool choice + clipboard persist across clip re-opens and clips.
let currentTool: Tool = 'draw';
let clipboard: ClipboardNote[] | null = null;

export interface PianoRollOpts {
  /** Host element; the editor frame is built inside it. */
  host: HTMLElement;
  getNotes: () => NoteEvent[];
  setNotes: (notes: NoteEvent[]) => void;
  patternTicks: number;
  minMidi?: number;
  maxMidi?: number;
  snapTicks?: number;
  /** Initial grid resolution (the notes editor's quantization). Defaults to 1/16. */
  gridResolution?: ResolutionKey;
  /** Fired when the user changes the resolution, so the caller can persist it. */
  onResolutionChange?: (r: ResolutionKey) => void;
  /** Grid geometry from the session meter; default to 4/4 (16 / 4). */
  stepsPerBar?: number;
  stepsPerBeat?: number;
  onChange?: () => void;
  getPlayheadTick?: () => number; // -1 when not playing
  /** Initial zoom/scroll for this clip (defaults to fit). */
  viewState?: ViewState;
  /** Called on every zoom/scroll so the caller can persist per-clip state. */
  onViewChange?: (v: ViewState) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  onGestureCancel?: () => void;
  /** Live-preview a pitch when typing/recording from the computer keyboard. */
  auditionNote?: (midi: number) => void;
  /** Scale highlight + lock context (musicality). Absent ⇒ no highlight, no snap. */
  scaleCtx?: ScaleCtx & { isRoot?: (midi: number) => boolean };
  /** When true (and scaleCtx present), placed notes snap to scale. */
  scaleLock?: boolean;
  /** Persist a scale-lock toggle (the caller writes musicality.lock). */
  onScaleLockChange?: (lock: boolean) => void;
}

export interface PianoRollHandle {
  redraw: () => void;
  /** Current octave base (MIDI of the on-screen keyboard's lowest key — the
   *  ◂ C4 ▸ stepper). The clip note-randomizer reads it so it places notes at
   *  the selected octave. Only piano-roll editors expose it. */
  getOctaveBase?: () => number;
  /** Restore the octave base (e.g. after a re-render reset it to the default). */
  setOctaveBase?: (midi: number) => void;
}

const BLACK_KEY_PCS = [1, 3, 6, 8, 10];

// Frame geometry (CSS px).
const KEYS_W = 42;
const RULER_H = 26;
const FRAME_H = 320; // ruler + note-grid height; the velocity lane is added BELOW, so the note grid keeps its size
const VEL_LANE_H = 64;         // ~20% of the note area; the velocity lane (added under the grid, growing total height)

export interface PianoRollFrame {
  frame: HTMLDivElement;
  wrap: HTMLDivElement; toolbar: HTMLDivElement;
  rulerWrap: HTMLDivElement; keysWrap: HTMLDivElement; gridVp: HTMLDivElement;
  rulerCanvas: HTMLCanvasElement; keysCanvas: HTMLCanvasElement; gridCanvas: HTMLCanvasElement;
  velWrap: HTMLDivElement; velCanvas: HTMLCanvasElement;
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
    gridTemplateRows: `${RULER_H}px 1fr ${VEL_LANE_H}px`,
    height: `${FRAME_H + VEL_LANE_H}px`,
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

  const velCorner = document.createElement('div');
  velCorner.className = 'pr-velcorner';
  Object.assign(velCorner.style, { background: '#181818', borderRight: '1px solid #2a2a2a', borderTop: '1px solid #2a2a2a' } as Partial<CSSStyleDeclaration>);

  const velWrap = mkWrap('pr-vel', 'ns-resize');
  velWrap.style.borderTop = '1px solid #2a2a2a';
  velWrap.style.background = '#0e0e0e';
  const velCanvas = mkCanvas(true);
  velWrap.appendChild(velCanvas);

  frame.append(corner, rulerWrap, keysWrap, gridVp, velCorner, velWrap);

  const toolbar = document.createElement('div');
  toolbar.className = 'pr-toolbar';
  Object.assign(toolbar.style, { display: 'flex', gap: '6px', alignItems: 'center', padding: '4px 2px' } as Partial<CSSStyleDeclaration>);

  const wrap = document.createElement('div');
  wrap.tabIndex = 0; // focusable, so the keyboard handler can target it
  wrap.style.outline = 'none';
  wrap.append(toolbar, frame);
  host.appendChild(wrap);

  return { frame, wrap, toolbar, rulerWrap, keysWrap, gridVp, rulerCanvas, keysCanvas, gridCanvas, velWrap, velCanvas };
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
  const minMidi = opts.minMidi ?? EDITOR_MIN_MIDI;
  const maxMidi = opts.maxMidi ?? EDITOR_MAX_MIDI;
  let resolution: ResolutionKey = opts.gridResolution ?? DEFAULT_RESOLUTION;
  let snap = opts.snapTicks ?? resolutionToSnap(resolution);
  const snapMidi = (m: number) => snapNoteMidi(m, opts.scaleCtx, opts.scaleLock ?? false);
  const barSteps = opts.stepsPerBar ?? 16;
  const beatSteps = opts.stepsPerBeat ?? 4;
  const noteCount = maxMidi - minMidi + 1;

  const f = buildEditorFrame(opts.host);

  let octaveBase = clampOctaveBase(60, minMidi, maxMidi); // C4 default, clamped
  const selection = new Set<NoteEvent>();

  const tools = createToolToggle(currentTool, (t) => { currentTool = t; });
  const drawBtn = tools.drawBtn, selBtn = tools.selBtn;

  // Octave stepper: ◂ [C4] ▸ (piano-roll specific — drives the computer-keyboard
  // note typing; mirrors the z/x shortcut). Shared grid-control wrapper.
  const octDownBtn = document.createElement('button');
  octDownBtn.textContent = '◂'; octDownBtn.title = 'Octave (z / x)';
  const octLabel = document.createElement('span');
  octLabel.style.cssText = 'font:11px ui-monospace,monospace;color:#9a9a9a';
  const octUpBtn = document.createElement('button');
  octUpBtn.textContent = '▸'; octUpBtn.title = 'Octave (z / x)';
  const octCtl = createGridControl(octDownBtn, octLabel, octUpBtn);

  // Grid resolution — shared with the drum-grid so notes quantize the same way.
  // Reactive: changing it re-snaps new edits + re-draws the grid lines.
  const { control: resCtl } = createResolutionSelect(resolution, (r) => {
    resolution = r; snap = resolutionToSnap(r);
    opts.onResolutionChange?.(r);
    redrawGridAndLane();
  });

  const help = createHelpButton(PIANO_KEY_LEGEND);

  const refreshToolbar = () => { octLabel.textContent = octaveBaseLabel(octaveBase); };
  const shiftOctave = (dir: 1 | -1) => {
    octaveBase = clampOctaveBase(octaveBase + dir * 12, minMidi, maxMidi);
    refreshToolbar();
  };
  octDownBtn.addEventListener('click', () => shiftOctave(-1));
  octUpBtn.addEventListener('click', () => shiftOctave(1));
  let lockOn = opts.scaleLock ?? false;
  const lockBtn = document.createElement('button');
  const refreshLock = () => {
    lockBtn.textContent = lockOn ? '🔒 Escala' : '🔓 Escala';
    lockBtn.title = lockOn ? 'Candado de escala ON (las notas caen en tono)' : 'Candado de escala OFF';
  };
  lockBtn.addEventListener('click', () => {
    lockOn = !lockOn;
    opts.scaleLock = lockOn;          // snapMidi reads opts.scaleLock live
    refreshLock();
    opts.onScaleLockChange?.(lockOn);
  });
  refreshLock();
  lockBtn.hidden = !opts.scaleCtx;     // only meaningful with a tonality

  f.toolbar.append(drawBtn, selBtn, octCtl, resCtl, help.btn, lockBtn);
  // Popover lives just below the toolbar (inside the wrap), positioned by SCSS.
  f.toolbar.after(help.popover);
  refreshToolbar();

  const gctx = ctx2d(f.gridCanvas);
  const rctx = ctx2d(f.rulerCanvas);
  const kctx = ctx2d(f.keysCanvas);
  const vctx = ctx2d(f.velCanvas);

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
      // Resaltado de escala (musicality): filas en tono con un tinte verde sutil,
      // la tónica algo más marcada. Las de fuera quedan como están (más oscuras).
      if (opts.scaleCtx?.inScale(midi)) {
        gctx.fillStyle = opts.scaleCtx.isRoot?.(midi) ? 'rgba(57,217,138,0.13)' : 'rgba(57,217,138,0.05)';
        gctx.fillRect(0, i * rowHeight, w, rowHeight);
      }
      if (midi % 12 === 0) {
        gctx.strokeStyle = '#2a2a2a';
        gctx.beginPath(); gctx.moveTo(0, i * rowHeight); gctx.lineTo(w, i * rowHeight); gctx.stroke();
      }
    }
    // Grid lines follow the chosen resolution (bar/beat emphasis preserved);
    // 'free' draws only bar/beat reference lines. Mirrors the drum-grid.
    const barTicks = barSteps * TICKS_PER_STEP;
    const beatTicks = beatSteps * TICKS_PER_STEP;
    const lineStep = resolution === 'free' ? beatTicks : snap;
    for (let t = 0; t <= opts.patternTicks; t += lineStep) {
      const x = t * pxPerTick;
      gctx.strokeStyle = (t % barTicks === 0) ? '#555' : (t % beatTicks === 0) ? '#2f2f2f' : '#1c1c1c';
      gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, h); gctx.stroke();
    }
    for (const n of opts.getNotes()) {
      if (n.midi < minMidi || n.midi > maxMidi) continue;
      const x = xForTick(n.start), x2 = xForTick(n.start + n.duration), y = yForMidi(n.midi);
      const sel = selection.has(n);
      gctx.fillStyle = sel ? '#7fd4ff' : velToColor(n.velocity);
      gctx.fillRect(x + 1, y + 1, Math.max(2, x2 - x - 2), rowHeight - 2);
      gctx.strokeStyle = sel ? '#ffffff' : (n.velocity >= 100 ? '#ffffff' : '#0a0a0a');
      gctx.lineWidth = (sel || n.velocity >= 100) ? 1.5 : 1;
      gctx.strokeRect(x + 0.5, y + 0.5, x2 - x - 1, rowHeight - 1);
      gctx.lineWidth = 1;
    }
    if (marquee) {
      const x = xForTick(Math.min(marquee.tick0, marquee.tick1));
      const w = Math.abs(xForTick(marquee.tick1) - xForTick(marquee.tick0));
      const yTop = yForMidi(Math.max(marquee.midi0, marquee.midi1));
      const yBot = yForMidi(Math.min(marquee.midi0, marquee.midi1)) + rowHeight;
      gctx.strokeStyle = '#7fd4ff'; gctx.setLineDash([4, 3]);
      gctx.strokeRect(x + 0.5, yTop + 0.5, Math.max(1, w), Math.max(1, yBot - yTop));
      gctx.setLineDash([]);
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
    {
      const cx = xForTick(cursorTick);
      gctx.strokeStyle = '#39d98a'; gctx.setLineDash([2, 2]);
      gctx.beginPath(); gctx.moveTo(cx, 0); gctx.lineTo(cx, gridH); gctx.stroke();
      gctx.setLineDash([]);
    }
  }

  function drawVelLane(): void {
    vctx.fillStyle = '#0e0e0e'; vctx.fillRect(0, 0, gridW, VEL_LANE_H);
    const accentY = VEL_LANE_H - velocityToBarHeight(100, VEL_LANE_H);
    vctx.strokeStyle = '#ff8c2e'; vctx.globalAlpha = 0.6; vctx.setLineDash([4, 3]);
    vctx.beginPath(); vctx.moveTo(0, accentY); vctx.lineTo(gridW, accentY); vctx.stroke();
    vctx.setLineDash([]); vctx.globalAlpha = 1;
    const seenTick = new Map<number, number>();
    for (const n of opts.getNotes()) {
      if (n.midi < minMidi || n.midi > maxMidi) continue;
      const fan = seenTick.get(n.start) ?? 0; seenTick.set(n.start, fan + 1);
      const x = xForTick(n.start) + fan * FAN_PX;
      const h = velocityToBarHeight(n.velocity, VEL_LANE_H);
      const sel = selection.has(n);
      vctx.fillStyle = sel ? '#7fd4ff' : velToColor(n.velocity);
      vctx.fillRect(x, VEL_LANE_H - h, 6, h);
    }
  }

  function drawRuler(): void {
    rctx.fillStyle = '#181818'; rctx.fillRect(0, 0, gridW, RULER_H);
    const steps = opts.patternTicks / TICKS_PER_STEP;
    for (let s = 0; s <= steps; s++) {
      const x = s * TICKS_PER_STEP * pxPerTick;
      if (s % barSteps === 0) {
        rctx.strokeStyle = '#6a6a6a';
        rctx.beginPath(); rctx.moveTo(x, 4); rctx.lineTo(x, RULER_H); rctx.stroke();
        rctx.fillStyle = '#c8c8c8'; rctx.font = '11px ui-monospace, monospace'; rctx.textBaseline = 'middle';
        rctx.fillText(String(s / barSteps + 1), x + 4, RULER_H / 2);
      } else if (s % beatSteps === 0) {
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
      if (opts.scaleCtx?.inScale(midi)) {
        kctx.fillStyle = opts.scaleCtx.isRoot?.(midi) ? '#39d98a' : 'rgba(57,217,138,0.35)';
        kctx.fillRect(KEYS_W - 5, i * rowHeight + 1, 4, rowHeight - 2);
      }
      if (pc === 0 && rowHeight >= 9) {
        kctx.fillStyle = '#9a9a9a'; kctx.font = '9px ui-monospace, monospace'; kctx.textBaseline = 'middle';
        kctx.fillText(`C${Math.floor(midi / 12) - 1}`, 4, i * rowHeight + rowHeight / 2);
      }
    }
  }

  function syncStrips(): void {
    f.rulerCanvas.style.transform = `translateX(${-f.gridVp.scrollLeft}px)`;
    f.keysCanvas.style.transform = `translateY(${-f.gridVp.scrollTop}px)`;
    f.velCanvas.style.transform = `translateX(${-f.gridVp.scrollLeft}px)`;
  }
  function persist(): void {
    opts.onViewChange?.({ zoomX, zoomY, scrollLeft: f.gridVp.scrollLeft, scrollTop: f.gridVp.scrollTop });
  }

  /** Full relayout: resize all canvases, redraw all four surfaces. */
  function layoutAll(): void {
    geom();
    setSize(f.gridCanvas, gridW, gridH);
    setSize(f.rulerCanvas, gridW, RULER_H);
    setSize(f.keysCanvas, KEYS_W, gridH);
    setSize(f.velCanvas, gridW, VEL_LANE_H);
    drawGrid(); drawRuler(); drawKeys(); drawVelLane();
  }

  /** Redraw both the note grid and the velocity lane together (for note edits). */
  function redrawGridAndLane(): void { drawGrid(); drawVelLane(); }

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
    setSize(f.gridCanvas, gridW, gridH); setSize(f.rulerCanvas, gridW, RULER_H); setSize(f.velCanvas, gridW, VEL_LANE_H);
    drawGrid(); drawRuler(); drawVelLane();
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
  let marquee: { tick0: number; midi0: number; tick1: number; midi1: number } | null = null;
  let groupDrag: { lastTick: number; lastMidi: number } | null = null;
  let lastMouse: { tick: number; midi: number } | null = null;
  // Insertion cursor (ticks): paste fallback (Task 5) + step input (Task 6). Declared
  // HERE — before the initial-mount layoutAll()/drawGrid() — because Task 6 makes
  // drawGrid read it; a later declaration would hit its TDZ on first render.
  let cursorTick = 0;
  const heldKeys = new Map<string, { midi: number; startTick: number }>();

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
    f.wrap.focus();

    if (currentTool === 'select' && !(e.altKey || e.button === 2)) {
      const hit = findNoteAt(tick, midi);
      if (hit) {
        if (e.shiftKey) { selection.has(hit) ? selection.delete(hit) : selection.add(hit); }
        else if (!selection.has(hit)) { selection.clear(); selection.add(hit); }
        groupDrag = { lastTick: Math.floor(tick / snap) * snap, lastMidi: midi };
        opts.onGestureStart?.(); gestureMutated = false;
      } else {
        if (!e.shiftKey) selection.clear();
        marquee = { tick0: tick, midi0: midi, tick1: tick, midi1: midi };
      }
      f.gridCanvas.setPointerCapture(e.pointerId);
      redrawGridAndLane(); e.preventDefault();
      return;
    }

    if (e.altKey || e.button === 2) {
      const hit = findNoteAt(tick, midi);
      if (hit) {
        opts.onGestureStart?.();
        opts.setNotes(opts.getNotes().filter((n) => n !== hit));
        opts.onChange?.();
        redrawGridAndLane();
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
      const newNote: NoteEvent = { start: snappedStart, duration: snap, midi: snapMidi(midi), velocity: DEFAULT_VELOCITY };
      opts.getNotes().push(newNote);
      interaction = { type: 'resize', note: newNote, offsetTick: 0 };
      gestureMutated = true;
      opts.onChange?.();
    }
    f.gridCanvas.setPointerCapture(e.pointerId);
    redrawGridAndLane();
    e.preventDefault();
  });

  f.gridCanvas.addEventListener('pointermove', (e) => {
    { const p = pointerPos(e); lastMouse = { tick: p.tick, midi: p.midi }; }
    if (marquee) {
      const p = pointerPos(e); marquee.tick1 = p.tick; marquee.midi1 = p.midi;
      redrawGridAndLane(); return;
    }
    if (groupDrag) {
      const p = pointerPos(e);
      const wantTick = Math.floor(p.tick / snap) * snap;
      const dTick = wantTick - groupDrag.lastTick;
      const dMidi = p.midi - groupDrag.lastMidi;
      if (dTick !== 0 || dMidi !== 0) {
        const sel = [...selection];
        const adj = translateGroup(sel, dTick, dMidi, { patternTicks: opts.patternTicks, minMidi, maxMidi });
        for (const n of sel) { n.start += adj.dTick; n.midi += adj.dMidi; }
        groupDrag.lastTick += adj.dTick; groupDrag.lastMidi += adj.dMidi;
        gestureMutated = true; redrawGridAndLane(); opts.onChange?.();
      }
      return;
    }
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
      // clamp → snap → re-clamp, so a snap near the range edge can't escape [minMidi,maxMidi]
      interaction.note.midi = Math.max(minMidi, Math.min(maxMidi, snapMidi(Math.max(minMidi, Math.min(maxMidi, midi)))));
    } else {
      const newDur = Math.max(snap, Math.ceil((tick - interaction.note.start) / snap) * snap);
      interaction.note.duration = Math.min(opts.patternTicks - interaction.note.start, newDur);
    }
    gestureMutated = true;
    redrawGridAndLane();
    opts.onChange?.();
  });

  const endDrag = (e: PointerEvent) => {
    if (marquee) {
      for (const n of notesInRect(opts.getNotes(), marquee)) selection.add(n);
      marquee = null;
      try { f.gridCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      redrawGridAndLane();
      return;
    }
    if (groupDrag) {
      groupDrag = null;
      try { f.gridCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (gestureMutated) opts.onGestureEnd?.(); else opts.onGestureCancel?.();
      return;
    }
    if (!interaction) return;
    interaction = null;
    try { f.gridCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (gestureMutated) opts.onGestureEnd?.();
    else opts.onGestureCancel?.();
  };
  f.gridCanvas.addEventListener('pointerup', endDrag);
  f.gridCanvas.addEventListener('pointercancel', endDrag);
  f.gridCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Keyboard editing (focus-scoped to the editor wrap) ────────────────────
  const bounds = () => ({ patternTicks: opts.patternTicks, minMidi, maxMidi });

  f.wrap.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return; // per spec §6: native text editing wins
    const cmd = e.metaKey || e.ctrlKey;

    // Contain Delete/Backspace to the editor so a stray one can NEVER bubble to the
    // inspector's document-level clip-delete (session-inspector wireKeyboardShortcuts).
    // The branches below act on notes/cursor when there's something to do; otherwise
    // this makes the key a no-op here instead of deleting the whole clip.
    if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();

    // Tool toggle
    if (!cmd && e.key === '1') { currentTool = 'draw'; tools.set('draw'); e.preventDefault(); return; }
    if (!cmd && e.key === '2') { currentTool = 'select'; tools.set('select'); e.preventDefault(); return; }

    // Select all
    if (cmd && e.key.toLowerCase() === 'a') {
      selection.clear(); for (const n of opts.getNotes()) selection.add(n);
      redrawGridAndLane(); e.preventDefault(); return;
    }
    // Copy
    if (cmd && e.key.toLowerCase() === 'c' && selection.size > 0) {
      clipboard = serializeClipboard([...selection]);
      e.preventDefault(); return;
    }
    // Cut
    if (cmd && e.key.toLowerCase() === 'x' && selection.size > 0) {
      clipboard = serializeClipboard([...selection]);
      opts.onGestureStart?.();
      opts.setNotes(opts.getNotes().filter((n) => !selection.has(n)));
      selection.clear();
      opts.onChange?.(); redrawGridAndLane(); opts.onGestureEnd?.();
      e.preventDefault(); return;
    }
    // Paste at the mouse (snapped); fall back to insertion cursor / 0.
    if (cmd && e.key.toLowerCase() === 'v' && clipboard && clipboard.length) {
      const anchorTick = Math.floor((lastMouse?.tick ?? cursorTick) / snap) * snap;
      const anchorMidi = lastMouse?.midi ?? octaveBase;
      const pasted = pasteTranslate(clipboard, anchorTick, anchorMidi, bounds());
      for (const n of pasted) n.midi = snapMidi(n.midi);
      opts.onGestureStart?.();
      const notes = opts.getNotes();
      for (const n of pasted) notes.push(n);
      selection.clear(); for (const n of pasted) selection.add(n);
      opts.onChange?.(); redrawGridAndLane(); opts.onGestureEnd?.();
      e.preventDefault(); return;
    }
    // Clear selection
    if (e.key === 'Escape') { selection.clear(); redrawGridAndLane(); e.preventDefault(); return; }

    // Octave shift (shares shiftOctave with the toolbar ◂/▸ stepper)
    if (!cmd && (e.key === 'z' || e.key === 'x')) {
      shiftOctave(e.key === 'x' ? 1 : -1);
      e.preventDefault(); return;
    }
    // Move insertion cursor when nothing is selected
    if (selection.size === 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      cursorTick = Math.max(0, Math.min(opts.patternTicks - snap, cursorTick + (e.key === 'ArrowRight' ? snap : -snap)));
      redrawGridAndLane(); e.preventDefault(); return;
    }

    if (!cmd) {
      const rawMidi = midiForKey(e.key, octaveBase);
      const midi = rawMidi === null ? null : snapMidi(rawMidi);
      if (midi !== null && midi >= minMidi && midi <= maxMidi) {
        e.preventDefault();
        if (e.repeat || heldKeys.has(e.key.toLowerCase())) return;
        opts.auditionNote?.(midi);
        const playing = (opts.getPlayheadTick?.() ?? -1) >= 0;
        if (playing) {
          // Real-time record: remember the start; the note is written + wrapped
          // in its own undo gesture on keyup (avoids nesting gestures when
          // several keys are held at once).
          const startTick = opts.getPlayheadTick?.() ?? 0;
          heldKeys.set(e.key.toLowerCase(), { midi, startTick });
        } else {
          // Step input: write at the cursor, advance after all keys release.
          heldKeys.set(e.key.toLowerCase(), { midi, startTick: cursorTick });
          opts.onGestureStart?.();
          opts.getNotes().push({ start: cursorTick, duration: snap, midi, velocity: DEFAULT_VELOCITY });
          opts.onChange?.(); redrawGridAndLane(); opts.onGestureEnd?.();
        }
        return;
      }
      // Step-input backspace: delete last inserted note + step back (no selection)
      if (e.key === 'Backspace' && selection.size === 0) {
        const notes = opts.getNotes();
        const atCursor = notes.filter((n) => n.start === Math.max(0, cursorTick - snap));
        if (atCursor.length) {
          opts.onGestureStart?.();
          opts.setNotes(notes.filter((n) => n.start !== Math.max(0, cursorTick - snap)));
          cursorTick = Math.max(0, cursorTick - snap);
          opts.onChange?.(); redrawGridAndLane(); opts.onGestureEnd?.();
        }
        e.preventDefault(); return;
      }
    }

    // Delete selection
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
      opts.onGestureStart?.();
      opts.setNotes(opts.getNotes().filter((n) => !selection.has(n)));
      selection.clear();
      opts.onChange?.(); redrawGridAndLane(); opts.onGestureEnd?.();
      e.preventDefault(); e.stopPropagation(); return;
    }

    // Arrow nudge of the selection
    if (selection.size > 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const dTick = e.key === 'ArrowRight' ? snap : e.key === 'ArrowLeft' ? -snap : 0;
      const dMidi = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      const sel = [...selection];
      const adj = translateGroup(sel, dTick, dMidi, bounds());
      if (adj.dTick || adj.dMidi) {
        opts.onGestureStart?.();
        for (const n of sel) { n.start += adj.dTick; n.midi += adj.dMidi; }
        opts.onChange?.(); redrawGridAndLane(); opts.onGestureEnd?.();
      }
      e.preventDefault(); return;
    }
  });

  f.wrap.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    const held = heldKeys.get(k);
    if (!held) return;
    heldKeys.delete(k);
    const playing = (opts.getPlayheadTick?.() ?? -1) >= 0;
    if (playing) {
      const endTick = opts.getPlayheadTick?.() ?? held.startTick;
      const q = quantizeRecorded(held.startTick, endTick < held.startTick ? held.startTick + snap : endTick, snap);
      opts.onGestureStart?.();
      opts.getNotes().push({ start: q.start, duration: q.duration, midi: held.midi, velocity: DEFAULT_VELOCITY });
      opts.onChange?.(); redrawGridAndLane(); opts.onGestureEnd?.();
    } else if (heldKeys.size === 0) {
      // All step-input keys released → advance the cursor one step (chord = one advance).
      cursorTick = Math.min(opts.patternTicks - snap, cursorTick + snap);
      redrawGridAndLane();
    }
  });

  // ── Velocity lane pointer editing ────────────────────────────────────────
  let velDrag: { note: NoteEvent | null } | null = null;

  const velPos = (e: PointerEvent) => {
    const rect = f.velCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  f.velCanvas.addEventListener('pointerdown', (e) => {
    f.wrap.focus();
    const { x, y } = velPos(e);
    const hit = barHitTest(opts.getNotes(), x, xForTick);
    if (!hit) return;
    opts.onGestureStart?.(); gestureMutated = false;
    velDrag = { note: hit };
    const v = yToVelocity(y, VEL_LANE_H);
    if (selection.has(hit) && selection.size > 1) applyGroupDelta([...selection], v - hit.velocity);
    else setVelocity(hit, v);
    gestureMutated = true;
    drawGrid(); drawVelLane();
    opts.onChange?.();
    f.velCanvas.setPointerCapture(e.pointerId); e.preventDefault();
  });

  f.velCanvas.addEventListener('pointermove', (e) => {
    if (!velDrag) return;
    const { x, y } = velPos(e);
    const v = yToVelocity(y, VEL_LANE_H);
    if (velDrag.note && selection.has(velDrag.note) && selection.size > 1) {
      applyGroupDelta([...selection], v - velDrag.note.velocity);
    } else {
      const hit = barHitTest(opts.getNotes(), x, xForTick) ?? velDrag.note;
      if (hit) setVelocity(hit, v);
    }
    gestureMutated = true;
    drawGrid(); drawVelLane();
    opts.onChange?.();
  });

  const velEnd = (e: PointerEvent) => {
    if (!velDrag) return;
    velDrag = null;
    try { f.velCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (gestureMutated) opts.onGestureEnd?.(); else opts.onGestureCancel?.();
  };
  f.velCanvas.addEventListener('pointerup', velEnd);
  f.velCanvas.addEventListener('pointercancel', velEnd);

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
      redrawGridAndLane();
    }
  }

  return {
    redraw,
    getOctaveBase: () => octaveBase,
    setOctaveBase: (m: number) => { octaveBase = clampOctaveBase(m, minMidi, maxMidi); refreshToolbar(); },
  };
}
