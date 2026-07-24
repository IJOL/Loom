// Clip drag-and-drop for the session grid: pointer-drag a filled cell onto
// another slot to move it (Ctrl = copy). Extracted from session-ui.ts; owns its
// own module-level drag state. Pure DOM — the actual mutation runs via callbacks.
//
// Gesture listeners (move/up/cancel) are installed on `window` in the CAPTURE
// phase for the duration of a gesture — never on the cell:
//  - the grid is rebuilt wholesale (host.innerHTML = '') on many state changes,
//    so a cell-bound pointerup could vanish mid-gesture and strand the module
//    state; the next plain hover over any cell then resurrected it as a ghost
//    glued to a button-less cursor ("the clip sticks to the mouse");
//  - the ▶/✕ cell children stopPropagation() their pointerup, which a bubble
//    listener on the cell never saw — capture-phase runs before them.
// Pointer capture is deliberately NOT used: it dies with the re-rendered cell.

import { canDropClip } from './session-ops';
import type { ClipSlot } from './session-ops';
import type { SessionState } from './session-types';
import type { SessionUICallbacks } from './session-ui-types';

const DRAG_THRESHOLD_PX = 4;

interface DragState {
  source: ClipSlot;
  cell: HTMLElement;
  cb: SessionUICallbacks;
  state: SessionState;
  startX: number;
  startY: number;
  ghost: HTMLElement | null;
  hoverCell: HTMLElement | null;
  active: boolean;            // true once movement past threshold
  pointerId: number;
  onKey: (e: KeyboardEvent) => void;
}

let activeDrag: DragState | null = null;

export function wireClipDrag(cell: HTMLElement, source: ClipSlot, cb: SessionUICallbacks, state: SessionState): void {
  cell.classList.add('session-cell-draggable');

  cell.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (activeDrag) return;
    activeDrag = {
      source,
      cell,
      cb,
      state,
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      hoverCell: null,
      active: false,
      pointerId: e.pointerId,
      onKey: () => {},
    };
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
  });
}

function onPointerMove(e: PointerEvent): void {
  if (!activeDrag || activeDrag.pointerId !== e.pointerId) return;
  // No button held means the pointerup was lost (released outside the window,
  // or never delivered) — a hover move must never start or continue a drag.
  if (e.buttons === 0) { teardownDrag(); return; }
  const drag = activeDrag;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.active) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.active = true;
    drag.cell.classList.add('drop-source');
    drag.ghost = buildGhost(drag.cell);
    document.body.appendChild(drag.ghost);
    document.body.classList.toggle('drag-copy', e.ctrlKey);
    drag.onKey = (k) => {
      if (k.key === 'Escape') teardownDrag();
      else if (k.key === 'Control') {
        document.body.classList.toggle('drag-copy', k.type === 'keydown');
      }
    };
    document.addEventListener('keydown', drag.onKey);
    document.addEventListener('keyup', drag.onKey);
  }
  positionGhost(drag.ghost!, e.clientX, e.clientY);
  document.body.classList.toggle('drag-copy', e.ctrlKey);
  updateHover(e.clientX, e.clientY, drag);
}

function onPointerUp(e: PointerEvent): void {
  if (!activeDrag || activeDrag.pointerId !== e.pointerId) return;
  const { source, cb, active, hoverCell } = activeDrag;
  const valid = active && (hoverCell?.classList.contains('drop-valid') ?? false);
  // Clean the module state BEFORE running callbacks: they re-render the grid.
  teardownDrag();
  if (!active) {
    // No drag happened — treat as a click (preserves the cell-body click semantics).
    cb.onClipClick(source.laneId, source.clipIdx);
  } else if (valid && hoverCell) {
    const to: ClipSlot = {
      laneId:  hoverCell.dataset.laneId!,
      clipIdx: Number(hoverCell.dataset.clipIdx),
    };
    cb.onMoveClip(source, to, e.ctrlKey);
  }
}

function onPointerCancel(e: PointerEvent): void {
  if (!activeDrag || activeDrag.pointerId !== e.pointerId) return;
  teardownDrag();
}

function teardownDrag(): void {
  if (!activeDrag) return;
  window.removeEventListener('pointermove', onPointerMove, true);
  window.removeEventListener('pointerup', onPointerUp, true);
  window.removeEventListener('pointercancel', onPointerCancel, true);
  document.removeEventListener('keydown', activeDrag.onKey);
  document.removeEventListener('keyup', activeDrag.onKey);
  if (activeDrag.ghost) activeDrag.ghost.remove();
  document.querySelectorAll('.session-cell.drop-valid, .session-cell.drop-invalid')
    .forEach((el) => el.classList.remove('drop-valid', 'drop-invalid'));
  document.querySelectorAll('.session-cell.drop-source')
    .forEach((el) => el.classList.remove('drop-source'));
  document.body.classList.remove('drag-copy');
  activeDrag = null;
}

function buildGhost(cell: HTMLElement): HTMLElement {
  const g = cell.cloneNode(true) as HTMLElement;
  g.className = 'session-ghost';
  g.style.position = 'fixed';
  g.style.pointerEvents = 'none';
  g.style.width  = `${cell.offsetWidth}px`;
  g.style.height = `${cell.offsetHeight}px`;
  g.style.zIndex = '9999';
  return g;
}

function positionGhost(g: HTMLElement, x: number, y: number): void {
  g.style.left = `${x - g.offsetWidth / 2}px`;
  g.style.top  = `${y - g.offsetHeight / 2}px`;
}

function updateHover(x: number, y: number, drag: DragState): void {
  const el = document.elementFromPoint(x, y);
  const cell = el?.closest('.session-cell') as HTMLElement | null;
  if (drag.hoverCell && drag.hoverCell !== cell) {
    drag.hoverCell.classList.remove('drop-valid', 'drop-invalid');
  }
  drag.hoverCell = cell;
  if (!cell) return;
  const to: ClipSlot = {
    laneId:  cell.dataset.laneId ?? '',
    clipIdx: Number(cell.dataset.clipIdx ?? -1),
  };
  if (!to.laneId || to.clipIdx < 0) return;
  const ok = canDropClip(drag.state, drag.source, to);
  cell.classList.toggle('drop-valid', ok);
  cell.classList.toggle('drop-invalid', !ok);
}
