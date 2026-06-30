// Clip drag-and-drop for the session grid: pointer-drag a filled cell onto
// another slot to move it (Ctrl = copy). Extracted from session-ui.ts; owns its
// own module-level drag state. Pure DOM — the actual mutation runs via callbacks.

import { canDropClip } from './session-ops';
import type { ClipSlot } from './session-ops';
import type { SessionState } from './session-types';
import type { SessionUICallbacks } from './session-ui-types';

const DRAG_THRESHOLD_PX = 4;

interface DragState {
  source: ClipSlot;
  startX: number;
  startY: number;
  ghost: HTMLElement | null;
  hoverCell: HTMLElement | null;
  active: boolean;            // true once movement past threshold
  cancelled: boolean;
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
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      hoverCell: null,
      active: false,
      cancelled: false,
      pointerId: e.pointerId,
      onKey: () => {},
    };
  });

  cell.addEventListener('pointermove', (e) => {
    if (!activeDrag) return;
    if (activeDrag.pointerId !== e.pointerId) return;
    const dx = e.clientX - activeDrag.startX;
    const dy = e.clientY - activeDrag.startY;
    if (!activeDrag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      activeDrag.active = true;
      cell.setPointerCapture(e.pointerId);
      cell.classList.add('drop-source');
      activeDrag.ghost = buildGhost(cell);
      document.body.appendChild(activeDrag.ghost);
      document.body.classList.toggle('drag-copy', e.ctrlKey);
      activeDrag.onKey = (k) => {
        if (k.key === 'Escape') cancelDrag();
        else if (k.key === 'Control') {
          document.body.classList.toggle('drag-copy', k.type === 'keydown');
        }
      };
      document.addEventListener('keydown', activeDrag.onKey);
      document.addEventListener('keyup', activeDrag.onKey);
    }
    positionGhost(activeDrag.ghost!, e.clientX, e.clientY);
    document.body.classList.toggle('drag-copy', e.ctrlKey);
    updateHover(e.clientX, e.clientY, activeDrag.source, state);
  });

  const finish = (e: PointerEvent) => {
    if (!activeDrag) return;
    if (activeDrag.pointerId !== e.pointerId) return;
    if (!activeDrag.active) {
      // No drag happened — treat as a click (preserves the cell-body click semantics).
      cb.onClipClick(source.laneId, source.clipIdx);
      activeDrag = null;
      return;
    }
    const target = activeDrag.hoverCell;
    const valid = target?.classList.contains('drop-valid') ?? false;
    if (valid && target && !activeDrag.cancelled) {
      const to: ClipSlot = {
        laneId:  target.dataset.laneId!,
        clipIdx: Number(target.dataset.clipIdx),
      };
      cb.onMoveClip(activeDrag.source, to, e.ctrlKey);
    }
    teardownDrag();
  };
  cell.addEventListener('pointerup', finish);
  cell.addEventListener('pointercancel', finish);
}

function cancelDrag(): void {
  if (!activeDrag) return;
  activeDrag.cancelled = true;
  teardownDrag();
}

function teardownDrag(): void {
  if (!activeDrag) return;
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

function updateHover(x: number, y: number, source: ClipSlot, state: SessionState): void {
  const el = document.elementFromPoint(x, y);
  const cell = el?.closest('.session-cell') as HTMLElement | null;
  if (activeDrag!.hoverCell && activeDrag!.hoverCell !== cell) {
    activeDrag!.hoverCell.classList.remove('drop-valid', 'drop-invalid');
  }
  activeDrag!.hoverCell = cell;
  if (!cell) return;
  const to: ClipSlot = {
    laneId:  cell.dataset.laneId ?? '',
    clipIdx: Number(cell.dataset.clipIdx ?? -1),
  };
  if (!to.laneId || to.clipIdx < 0) return;
  const ok = canDropClip(state, source, to);
  cell.classList.toggle('drop-valid', ok);
  cell.classList.toggle('drop-invalid', !ok);
}
