// Piano-roll editor for a NoteEvent[] array. Drag-create, drag-move,
// drag-resize from the right edge, alt-click / right-click to delete.
// Snap defaults to 16th notes (TICKS_PER_STEP).

import { TICKS_PER_STEP, type NoteEvent } from './notes';

export interface PianoRollOpts {
  canvas: HTMLCanvasElement;
  getNotes: () => NoteEvent[];
  setNotes: (notes: NoteEvent[]) => void;
  patternTicks: number;
  minMidi?: number;
  maxMidi?: number;
  snapTicks?: number;
  onChange?: () => void;
  getPlayheadTick?: () => number; // -1 when not playing
  /** Optional scrolling wrapper. When the canvas is wider than this
   *  element's clientWidth, the playhead is kept centered by scrolling
   *  the wrapper underneath it (DAW-style "playhead follow"). */
  scrollContainer?: HTMLElement;
  /** Called at the start of a user gesture that may mutate notes (pointerdown
   *  or single-shot delete). Pair with onGestureEnd for undo bracketing. */
  onGestureStart?: () => void;
  /** Called at the end of the gesture (pointerup / pointercancel, or
   *  immediately after a single-shot mutation) to commit the undo entry. */
  onGestureEnd?: () => void;
}

export interface PianoRollHandle {
  redraw: () => void;
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const BLACK_KEY_PCS = [1, 3, 6, 8, 10];

export function createPianoRoll(opts: PianoRollOpts): PianoRollHandle {
  const minMidi = opts.minMidi ?? 36;   // C2
  const maxMidi = opts.maxMidi ?? 96;   // C7
  const snap = opts.snapTicks ?? TICKS_PER_STEP;
  const noteCount = maxMidi - minMidi + 1;
  const ctxOrNull = opts.canvas.getContext('2d');
  if (!ctxOrNull) throw new Error('canvas 2d context unavailable');
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  // Keyboard column on the left for note labels
  const KEYS_W = 28;

  const xForTick = (t: number) => KEYS_W + (t / opts.patternTicks) * (opts.canvas.width - KEYS_W);
  const yForMidi = (m: number) => ((maxMidi - m) / noteCount) * opts.canvas.height;
  const rowHeight = () => opts.canvas.height / noteCount;

  const tickFromX = (x: number) => {
    const innerX = Math.max(0, x - KEYS_W);
    const t = (innerX / (opts.canvas.width - KEYS_W)) * opts.patternTicks;
    return Math.max(0, Math.min(opts.patternTicks - 1, t));
  };
  const midiFromY = (y: number) => {
    const row = Math.floor((y / opts.canvas.height) * noteCount);
    return maxMidi - Math.max(0, Math.min(noteCount - 1, row));
  };

  function draw() {
    const w = opts.canvas.width;
    const h = opts.canvas.height;
    const rh = rowHeight();
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Key column background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, KEYS_W, h);

    // Row striping: black keys darker
    for (let i = 0; i < noteCount; i++) {
      const midi = maxMidi - i;
      const isBlack = BLACK_KEY_PCS.includes(midi % 12);
      if (isBlack) {
        ctx.fillStyle = '#161616';
        ctx.fillRect(KEYS_W, i * rh, w - KEYS_W, rh);
        ctx.fillStyle = '#222';
        ctx.fillRect(0, i * rh, KEYS_W, rh);
      }
      // C labels
      if (midi % 12 === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '9px ui-monospace, monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${NOTE_NAMES[0]}${Math.floor(midi / 12) - 1}`, 4, i * rh + rh / 2);
        ctx.strokeStyle = '#2a2a2a';
        ctx.beginPath(); ctx.moveTo(KEYS_W, i * rh); ctx.lineTo(w, i * rh); ctx.stroke();
      }
    }

    // Vertical grid (steps + bars)
    const steps = opts.patternTicks / TICKS_PER_STEP;
    for (let s = 0; s <= steps; s++) {
      const x = xForTick(s * TICKS_PER_STEP);
      if (s % 16 === 0) ctx.strokeStyle = '#555';
      else if (s % 4 === 0) ctx.strokeStyle = '#2f2f2f';
      else ctx.strokeStyle = '#1c1c1c';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // Notes
    for (const n of opts.getNotes()) {
      if (n.midi < minMidi || n.midi > maxMidi) continue;
      const x = xForTick(n.start);
      const x2 = xForTick(n.start + n.duration);
      const y = yForMidi(n.midi);
      const accent = n.velocity >= 100;
      ctx.fillStyle = accent ? '#ffaa44' : '#3498db';
      ctx.fillRect(x + 1, y + 1, Math.max(2, x2 - x - 2), rh - 2);
      ctx.strokeStyle = '#0a0a0a';
      ctx.strokeRect(x + 0.5, y + 0.5, x2 - x - 1, rh - 1);
    }

    // Playhead
    const ph = opts.getPlayheadTick?.() ?? -1;
    if (ph >= 0) {
      const x = xForTick(ph);
      ctx.strokeStyle = '#f7d000';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();

      // Follow the playhead: keep it centered in the visible viewport when
      // the canvas is wider than the scroll container.
      const sc = opts.scrollContainer;
      if (sc && opts.canvas.width > sc.clientWidth) {
        const rect = opts.canvas.getBoundingClientRect();
        const scale = rect.width / opts.canvas.width; // CSS-px per canvas-px
        const target = Math.max(0, x * scale - sc.clientWidth / 2);
        // Skip tiny corrections to avoid scroll-jitter from sub-pixel drift.
        if (Math.abs(sc.scrollLeft - target) > 2) sc.scrollLeft = target;
      }
    }
  }

  // ── Interactions ───────────────────────────────────────────────────────
  type Interaction = { type: 'move' | 'resize'; note: NoteEvent; offsetTick: number };
  let interaction: Interaction | null = null;

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
    const rect = opts.canvas.getBoundingClientRect();
    const scaleX = opts.canvas.width / rect.width;
    const scaleY = opts.canvas.height / rect.height;
    return {
      tick: tickFromX((e.clientX - rect.left) * scaleX),
      midi: midiFromY((e.clientY - rect.top) * scaleY),
      rawX: (e.clientX - rect.left) * scaleX,
    };
  };

  opts.canvas.addEventListener('pointerdown', (e) => {
    const { tick, midi, rawX } = pointerPos(e);
    if (rawX < KEYS_W) return; // ignore clicks on the keyboard column

    if (e.altKey || e.button === 2) {
      // Single-shot delete: bracket the mutation so it becomes one undo entry.
      const hit = findNoteAt(tick, midi);
      if (hit) {
        opts.onGestureStart?.();
        opts.setNotes(opts.getNotes().filter((n) => n !== hit));
        opts.onChange?.();
        draw();
        opts.onGestureEnd?.();
      }
      e.preventDefault();
      return;
    }

    // All drag gestures (move, resize, create-by-drag): snapshot once here
    // at the top of pointerdown before any branching. commitGesture fires in
    // endDrag (pointerup / pointercancel).
    opts.onGestureStart?.();

    const hit = findNoteAt(tick, midi);
    if (hit) {
      if (isResizeEdge(hit, tick)) {
        interaction = { type: 'resize', note: hit, offsetTick: 0 };
      } else {
        interaction = { type: 'move', note: hit, offsetTick: tick - hit.start };
      }
    } else {
      const snappedStart = Math.floor(tick / snap) * snap;
      const newNote: NoteEvent = { start: snappedStart, duration: snap, midi, velocity: 80 };
      opts.getNotes().push(newNote);
      interaction = { type: 'resize', note: newNote, offsetTick: 0 };
      opts.onChange?.();
    }
    opts.canvas.setPointerCapture(e.pointerId);
    draw();
    e.preventDefault();
  });

  opts.canvas.addEventListener('pointermove', (e) => {
    const { tick, midi, rawX } = pointerPos(e);
    if (!interaction) {
      if (rawX < KEYS_W) { opts.canvas.style.cursor = 'default'; return; }
      const hit = findNoteAt(tick, midi);
      opts.canvas.style.cursor = hit
        ? (isResizeEdge(hit, tick) ? 'ew-resize' : 'move')
        : 'crosshair';
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
    draw();
    opts.onChange?.();
  });

  const endDrag = (e: PointerEvent) => {
    if (!interaction) return;
    interaction = null;
    try { opts.canvas.releasePointerCapture(e.pointerId); } catch {}
    opts.onGestureEnd?.();
  };
  opts.canvas.addEventListener('pointerup', endDrag);
  opts.canvas.addEventListener('pointercancel', endDrag);
  opts.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  draw();
  return { redraw: draw };
}
