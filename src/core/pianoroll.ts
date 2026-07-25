// Piano-roll editor for a NoteEvent[] array. Drag-create, drag-move,
// drag-resize from the right edge, alt-click / right-click to delete.
// Ableton-style zoom: scrub the time ruler (↕ zoom time, ↔ pan) and the piano
// keyboard (↕ zoom pitch); native scrollbars pan. Snap defaults to 16th notes.

import { html } from 'lit-html';
import { renderElement } from './lit-fragment';
import { editorFrameTemplate } from './pianoroll-templates';
import { TICKS_PER_STEP, type NoteEvent } from './notes';
import { velToColor } from './velocity-color';
import { velocityToBarHeight, FAN_PX, yToVelocity, barHitTest, setVelocity, applyGroupDelta } from './velocity-lane-editing';
import { DEFAULT_VELOCITY } from './velocity-gain';
import { EDITOR_MIN_MIDI, EDITOR_MAX_MIDI } from './pianoroll-range';
import {
  clampZoom, scrubToZoom, zoomAroundAnchor, maxZoomY,
  defaultPitchView, type PitchView,
} from './pianoroll-zoom';
import type { ClipAxis } from './clip-axis';
import {
  notesInRect, translateGroup, serializeClipboard, pasteTranslate,
  clampOctaveBase, octaveBaseLabel, PIANO_KEY_LEGEND, snapNoteMidi, type ClipboardNote, type ScaleCtx,
} from './piano-roll-editing';
import { isTextEditTarget, type HistoryDeps } from '../save/history-wiring';
import {
  createToolToggle, createHelpButton, createGridControl, createResolutionSelect, createFollowToggle,
  createKbInputToggle,
} from './clip-editor-toolbar';
import type { SessionClip } from '../session/session';
import type { TimeSignature } from './meter';
import { mountClipLoopOverlay } from './clip-loop-overlay';
import { isFollowEnabled } from './clip-follow';
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
  /** Click (no drag) on the time ruler seeks to that tick. Drag still zoom/pans. */
  onSeek?: (tick: number) => void;
  /** The clip's SHARED horizontal time axis (clip-axis.ts). This editor is the
   *  PRIMARY: it publishes its viewport width as the fit basis and drives
   *  zoom/scroll. Every other view of the clip (waveform header, automation
   *  lanes) follows the same axis, which is what keeps them aligned. */
  axis: ClipAxis;
  /** Initial VERTICAL view for this clip (defaults to fit). Horizontal comes
   *  from `axis`. */
  pitchView?: PitchView;
  /** Called on every vertical zoom/scroll so the caller can persist it. */
  onPitchViewChange?: (v: PitchView) => void;
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
  /** When present, mount the performance-style loop overlay INSIDE the grid
   *  viewport (so it tracks zoom + scroll) and put its toggle/quantize toolbar
   *  in `loop.toolbarHost`. */
  loop?: {
    toolbarHost: HTMLElement;
    clip: SessionClip;
    meter: TimeSignature;
    historyDeps?: HistoryDeps;
    onChange?: () => void;
    /** Returns true when the editing scene's loop is currently linked. */
    isLinked?: () => boolean;
    /** Called when the user clicks the Link toggle in the loop toolbar. */
    onToggleLink?: (linked: boolean) => void;
    /** Called after each loop edit commit (toggle + brace drags). */
    onClipLoopEdited?: () => void;
  };
}

export interface PianoRollHandle {
  redraw: () => void;
  /** Current octave base (MIDI of the on-screen keyboard's lowest key — the
   *  ◂ C4 ▸ stepper). The clip note-randomizer reads it so it places notes at
   *  the selected octave. Only piano-roll editors expose it. */
  getOctaveBase?: () => number;
  /** Restore the octave base (e.g. after a re-render reset it to the default). */
  setOctaveBase?: (midi: number) => void;
  /** Release everything this editor holds outside its own DOM — today the
   *  ClipAxis subscription. MUST be called before the host is wiped, or a
   *  detached editor keeps relaying out on every axis change. */
  dispose?: () => void;
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
 *  can be pinned (repositioned via transform) as the grid scrolls.
 *
 *  Build-once DOM: one detached lit render (pianoroll-templates.ts), refs
 *  pulled out, then everything is driven imperatively (canvas sizing/drawing,
 *  transform pinning). Never rendered into `host` itself — callers wipe it
 *  with innerHTML, which would strand a persistent lit part. */
export function buildEditorFrame(host: HTMLElement): PianoRollFrame {
  host.innerHTML = '';

  const wrap = renderElement(editorFrameTemplate({
    keysW: KEYS_W, rulerH: RULER_H, frameH: FRAME_H, velLaneH: VEL_LANE_H,
  })) as HTMLDivElement;

  const frame = wrap.querySelector('.pr-frame') as HTMLDivElement;
  const toolbar = wrap.querySelector('.pr-toolbar') as HTMLDivElement;
  const rulerWrap = wrap.querySelector('.pr-ruler') as HTMLDivElement;
  const keysWrap = wrap.querySelector('.pr-keys') as HTMLDivElement;
  const gridVp = wrap.querySelector('.pr-grid-vp') as HTMLDivElement;
  // Scrollbar-gutter reservation (see pianoroll-templates.ts for the full
  // rationale). Set here instead of in the template's style attribute: jsdom
  // drops a whole style attribute holding a property it doesn't recognise.
  gridVp.style.setProperty('scrollbar-gutter', 'stable');
  const velWrap = wrap.querySelector('.pr-vel') as HTMLDivElement;
  const rulerCanvas = rulerWrap.firstElementChild as HTMLCanvasElement;
  const keysCanvas = keysWrap.firstElementChild as HTMLCanvasElement;
  const gridCanvas = gridVp.firstElementChild as HTMLCanvasElement;
  const velCanvas = velWrap.firstElementChild as HTMLCanvasElement;

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

  // Octave stepper: ◂ [C4] ▸ — shifts the reference octave used as the paste-anchor
  // fallback (Ctrl+V with no prior mouse position) and exposed via getOctaveBase for
  // the note-randomizer. Shared grid-control wrapper. Built once via a detached
  // lit render (plus the scale-lock button below): the throwaway wrapper <div>
  // never mounts — createGridControl re-parents the stepper pieces and the
  // toolbar adopts the lock button.
  let lockOn = opts.scaleLock ?? false;
  const octTools = renderElement(html`<div>
    <button title="Octave down" @click=${() => shiftOctave(-1)}>◂</button>
    <span style="font:11px ui-monospace,monospace;color:#9a9a9a"></span>
    <button title="Octave up" @click=${() => shiftOctave(1)}>▸</button>
    <button @click=${() => {
      lockOn = !lockOn;
      opts.scaleLock = lockOn;          // snapMidi reads opts.scaleLock live
      refreshLock();
      opts.onScaleLockChange?.(lockOn);
    }}></button>
  </div>`);
  const octDownBtn = octTools.children[0] as HTMLButtonElement;
  const octLabel = octTools.children[1] as HTMLSpanElement;
  const octUpBtn = octTools.children[2] as HTMLButtonElement;
  const lockBtn = octTools.children[3] as HTMLButtonElement;
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
  const refreshLock = () => {
    lockBtn.textContent = lockOn ? '🔒 Scale' : '🔓 Scale';
    lockBtn.title = lockOn ? 'Scale lock ON (notes snap to key)' : 'Scale lock OFF';
  };
  refreshLock();
  lockBtn.hidden = !opts.scaleCtx;     // only meaningful with a tonality

  const followBtn = createFollowToggle();
  // ⌨ Keys toggle (OFF by default): the piano-roll no longer inserts notes from
  // computer-keyboard typing (superseded by the live computer-keyboard module),
  // but the flag + toggle stay — they now gate that live module's enable state.
  const kbBtn = createKbInputToggle(() => redrawGridAndLane());
  f.toolbar.append(drawBtn, selBtn, followBtn, kbBtn, octCtl, resCtl, help.btn, lockBtn);
  // Popover lives just below the toolbar (inside the wrap), positioned by SCSS.
  f.toolbar.after(help.popover);
  refreshToolbar();

  const gctx = ctx2d(f.gridCanvas);
  const rctx = ctx2d(f.rulerCanvas);
  const kctx = ctx2d(f.keysCanvas);
  const vctx = ctx2d(f.velCanvas);

  // Horizontal state lives on the shared axis; only the vertical pair is local.
  const axis = opts.axis;
  axis.setTotalTicks(opts.patternTicks);
  axis.setPrimaryViewport(f.gridVp);          // followers align to this rect
  let { zoomY, scrollTop } = opts.pitchView ?? defaultPitchView();
  // Geometry derived from zoom + viewport (recomputed in geom()).
  let gridW = 0, gridH = 0, pxPerTick = 0, rowHeight = 0;

  let loopOverlay: { redraw: () => void } | null = null;
  const refreshLoop = () => loopOverlay?.redraw();

  const xForTick = (t: number) => t * pxPerTick;
  const yForMidi = (m: number) => (maxMidi - m) * rowHeight;
  const tickFromX = (x: number) => Math.max(0, Math.min(opts.patternTicks - 1, pxPerTick > 0 ? x / pxPerTick : 0));
  const midiFromY = (y: number) => maxMidi - Math.max(0, Math.min(noteCount - 1, Math.floor(rowHeight > 0 ? y / rowHeight : 0)));

  function geom(): void {
    const vw = f.gridVp.clientWidth || 1;
    const vh = f.gridVp.clientHeight || 1;
    // Publish this viewport as the clip's fit basis: every follower sizes itself
    // from the axis, so they all agree on what "the whole clip" is worth in px.
    axis.setBasisWidth(vw);
    zoomY = clampZoom(zoomY, maxZoomY(vh, noteCount));
    gridW = axis.contentWidth();
    gridH = Math.round(vh * zoomY);
    pxPerTick = axis.pxPerTick();
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
      // Scale highlight (musicality): in-key rows get a subtle green tint,
      // the root is slightly stronger. Out-of-key rows stay as-is (darker).
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
      // Follow the playhead horizontally — only when Follow mode is on.
      if (isFollowEnabled() && gridW > f.gridVp.clientWidth) {
        const target = Math.max(0, x - f.gridVp.clientWidth / 2);
        if (Math.abs(f.gridVp.scrollLeft - target) > 2) f.gridVp.scrollLeft = target;
      }
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
    opts.onPitchViewChange?.({ zoomY, scrollTop: f.gridVp.scrollTop });
  }

  /** Full relayout: resize all canvases, redraw all four surfaces. */
  function layoutAll(): void {
    geom();
    setSize(f.gridCanvas, gridW, gridH);
    setSize(f.rulerCanvas, gridW, RULER_H);
    setSize(f.keysCanvas, KEYS_W, gridH);
    setSize(f.velCanvas, gridW, VEL_LANE_H);
    drawGrid(); drawRuler(); drawKeys(); drawVelLane();
    refreshLoop();
  }

  /** Redraw both the note grid and the velocity lane together (for note edits). */
  function redrawGridAndLane(): void { drawGrid(); drawVelLane(); }

  // ── The shared axis moved ─────────────────────────────────────────────────
  // Either we moved it (ruler scrub, scroll) or something else did (a clip
  // length edit, another view of the same clip). One handler for all of them.
  //
  // Re-entrancy: layoutAll → geom → axis.setBasisWidth can emit again, so the
  // flag guards against recursion. And a pure SCROLL change must not pay for a
  // full canvas resize + redraw, hence the contentWidth check.
  let applyingAxis = false;
  let lastAppliedW = -1;
  function applyAxis(): void {
    if (applyingAxis) return;
    applyingAxis = true;
    try {
      if (axis.contentWidth() !== lastAppliedW) {
        layoutAll();
        lastAppliedW = axis.contentWidth();
      }
      if (Math.round(f.gridVp.scrollLeft) !== axis.scrollLeft) f.gridVp.scrollLeft = axis.scrollLeft;
      syncStrips();
      refreshLoop();
    } finally {
      applyingAxis = false;
    }
  }
  const offAxis = axis.subscribe(() => applyAxis());

  // ── Scroll: publish H to the axis, keep V local, re-pin strips ────────────
  f.gridVp.addEventListener('scroll', () => {
    scrollTop = f.gridVp.scrollTop;
    axis.setScrollLeft(f.gridVp.scrollLeft);   // followers scroll with us
    syncStrips(); persist(); refreshLoop();
  });

  // ── Ruler scrub: ↕ zoom-H (anchored), ↔ pan-H ─────────────────────────────
  let rulerDrag = false, rLastX = 0, rLastY = 0, rulerMoved = false, rDownX = 0;
  f.rulerWrap.addEventListener('pointerdown', (e) => {
    rulerDrag = true; rulerMoved = false; rDownX = e.clientX;
    rLastX = e.clientX; rLastY = e.clientY;
    f.rulerWrap.setPointerCapture(e.pointerId); e.preventDefault();
  });
  f.rulerWrap.addEventListener('pointermove', (e) => {
    if (!rulerDrag) return;
    if (Math.abs(e.clientX - rDownX) > 3) rulerMoved = true;
    const dy = e.clientY - rLastY, dx = e.clientX - rLastX;
    rLastX = e.clientX; rLastY = e.clientY;
    // Zoom (anchored) + pan, both through the axis. Its subscription below does
    // the relayout, so this is the only place the gesture is expressed.
    const anchorPx = e.clientX - f.rulerWrap.getBoundingClientRect().left;
    axis.scrub(dy, anchorPx);
    axis.setScrollLeft(axis.scrollLeft - dx);
    applyAxis();
  });
  const rulerEnd = (e: PointerEvent) => {
    if (e.type === 'pointerup' && rulerDrag && !rulerMoved && opts.onSeek) {
      const x = (e.clientX - f.rulerWrap.getBoundingClientRect().left) + f.gridVp.scrollLeft;
      opts.onSeek(tickFromX(x));
    }
    rulerDrag = false;
    try { f.rulerWrap.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
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
    syncStrips(); persist(); refreshLoop();
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
  // Insertion cursor (ticks): paste-anchor fallback when Ctrl+V has no prior mouse
  // position (see the paste handler below).
  let cursorTick = 0;

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
  lastAppliedW = axis.contentWidth();
  f.gridVp.scrollLeft = axis.scrollLeft;      // restore the clip's shared H scroll
  f.gridVp.scrollTop = scrollTop;
  syncStrips();

  if (opts.loop) {
    loopOverlay = mountClipLoopOverlay({
      toolbarHost: opts.loop.toolbarHost,
      scrollHost: f.gridVp,
      clip: opts.loop.clip,
      meter: opts.loop.meter,
      historyDeps: opts.loop.historyDeps,
      onChange: opts.loop.onChange,
      isLinked: opts.loop.isLinked,
      onToggleLink: opts.loop.onToggleLink,
      onClipLoopEdited: opts.loop.onClipLoopEdited,
      tickToX: (t) => xForTick(t),
      tickFromClientX: (cx) => {
        const x = cx - f.gridCanvas.getBoundingClientRect().left;
        return pxPerTick > 0 ? Math.max(0, Math.min(opts.patternTicks, x / pxPerTick)) : 0;
      },
      contentHeight: () => gridH,
    });
  }

  // redraw() runs every animation frame (driven by session-host's RAF loop) to
  // animate the playhead. It also cheaply detects a viewport resize and does a
  // full relayout when needed — so there is NO window 'resize' listener to leak
  // across clip re-renders.
  function redraw(): void {
    const vw = f.gridVp.clientWidth, vh = f.gridVp.clientHeight;
    if (vw !== lastVW || vh !== lastVH) {
      lastVW = vw; lastVH = vh;
      layoutAll();                              // geom() republishes the new basis
      lastAppliedW = axis.contentWidth();
      f.gridVp.scrollLeft = axis.scrollLeft; f.gridVp.scrollTop = scrollTop;
      syncStrips();
    } else {
      redrawGridAndLane();
    }
  }

  return {
    redraw,
    getOctaveBase: () => octaveBase,
    setOctaveBase: (m: number) => { octaveBase = clampOctaveBase(m, minMidi, maxMidi); refreshToolbar(); },
    dispose: () => {
      offAxis();
      // Hand the axis back only if we are still the registered primary (a newer
      // editor may already have claimed it).
      if (axis.primaryViewport === f.gridVp) axis.setPrimaryViewport(null);
    },
  };
}
