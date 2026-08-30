// src/performance/perf-gestures.ts
// The Arrange surface under the pointer: band selection (click / shift-click /
// marquee) and band dragging (free move + clamp; Shift = ripple; Alt = no
// snap; a vertical drag re-lanes the band). Copies the gesture ARCHITECTURE of
// session-clip-drag.ts: only pointerdown is delegated on the persistent root;
// the in-flight gesture rides window CAPTURE listeners and module-level state,
// so a mid-gesture re-render (lit swaps the very element being dragged) cannot
// strand it. Escape cancels. Resize handles and the × button stopPropagation
// their own pointerdown, so this layer never sees them.

const DRAG_THRESHOLD_PX = 4;

export interface PerfGestureDeps {
  pxPerBar(): number;
  barSec(): number;
  getSelection(): ReadonlySet<string>;
  setSelection(ids: ReadonlySet<string>): void;
  /** Move every band in `ids` by `deltaSec`. `targetLaneId` is set when the
   *  pointer was released over a DIFFERENT lane row (single-band re-lane). */
  moveBands(
    ids: ReadonlySet<string>, deltaSec: number, targetLaneId: string | null,
    mode: 'clamp' | 'ripple', snap: boolean,
  ): void;
  refresh(): void;
}

interface Gesture {
  kind: 'band' | 'marquee';
  deps: PerfGestureDeps;
  root: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  bandId: string;
  sourceLaneId: string;
  ghost: HTMLElement | null;
  marqueeEl: HTMLElement | null;
  onKey: (e: KeyboardEvent) => void;
}

let gesture: Gesture | null = null;

export function attachPerfGestures(root: HTMLElement, deps: PerfGestureDeps): () => void {
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || gesture) return;
    const target = e.target as HTMLElement;
    if (target.closest('.perf-clip-handle') || target.closest('.perf-clip-del')) return;
    const band = target.closest('.perf-clip') as HTMLElement | null;
    const area = target.closest('.perf-clip-band') as HTMLElement | null;
    if (!band && !area) return;
    const row = target.closest('.perf-row') as HTMLElement | null;
    gesture = {
      kind: band ? 'band' : 'marquee',
      deps, root,
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      active: false,
      bandId: band?.dataset.bandId ?? '',
      sourceLaneId: row?.dataset.laneId ?? '',
      ghost: null, marqueeEl: null,
      onKey: (k) => { if (k.key === 'Escape') teardown(); },
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    document.addEventListener('keydown', gesture.onKey);
    if (band) e.preventDefault();
  };
  root.addEventListener('pointerdown', onDown);
  return () => {
    root.removeEventListener('pointerdown', onDown);
    teardown();
  };
}

function onMove(e: PointerEvent): void {
  if (!gesture || gesture.pointerId !== e.pointerId) return;
  if (e.buttons === 0) { teardown(); return; } // the pointerup was lost
  const g = gesture;
  const dx = e.clientX - g.startX;
  const dy = e.clientY - g.startY;
  if (!g.active) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    g.active = true;
    if (g.kind === 'band') {
      const el = g.root.querySelector(`.perf-clip[data-band-id="${g.bandId}"]`) as HTMLElement | null;
      g.ghost = buildGhost(el);
      if (g.ghost) document.body.appendChild(g.ghost);
    } else {
      g.marqueeEl = document.createElement('div');
      g.marqueeEl.className = 'perf-marquee';
      document.body.appendChild(g.marqueeEl);
    }
  }
  if (g.kind === 'band' && g.ghost) {
    g.ghost.style.left = `${e.clientX + 6}px`;
    g.ghost.style.top = `${e.clientY + 6}px`;
  } else if (g.kind === 'marquee' && g.marqueeEl) {
    const r = normRect(g.startX, g.startY, e.clientX, e.clientY);
    Object.assign(g.marqueeEl.style, {
      left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    });
  }
}

function onUp(e: PointerEvent): void {
  if (!gesture || gesture.pointerId !== e.pointerId) return;
  const g = gesture;
  teardown(); // clean BEFORE callbacks — they re-render
  if (g.kind === 'band') {
    if (!g.active) {
      // A click: plain = this band alone; Shift = toggle it in the selection.
      const sel = new Set(g.deps.getSelection());
      if (e.shiftKey) { if (sel.has(g.bandId)) sel.delete(g.bandId); else sel.add(g.bandId); }
      else { sel.clear(); sel.add(g.bandId); }
      g.deps.setSelection(sel);
      g.deps.refresh();
      return;
    }
    const secPerPx = g.deps.barSec() / g.deps.pxPerBar();
    const deltaSec = (e.clientX - g.startX) * secPerPx;
    const rowUnder = rowLaneAt(e.clientX, e.clientY);
    const targetLaneId = rowUnder && rowUnder !== g.sourceLaneId ? rowUnder : null;
    // Dragging an unselected band selects it (alone) first — the DAW norm.
    let ids = g.deps.getSelection();
    if (!ids.has(g.bandId)) { ids = new Set([g.bandId]); g.deps.setSelection(ids); }
    g.deps.moveBands(ids, deltaSec, targetLaneId, e.shiftKey ? 'ripple' : 'clamp', !e.altKey);
    return;
  }
  // marquee
  if (!g.active) {
    g.deps.setSelection(new Set());
    g.deps.refresh();
    return;
  }
  const r = normRect(g.startX, g.startY, e.clientX, e.clientY);
  const hit = new Set<string>();
  g.root.querySelectorAll<HTMLElement>('.perf-clip[data-band-id]').forEach((el) => {
    const b = el.getBoundingClientRect();
    const overlaps = b.left < r.left + r.width && b.right > r.left
      && b.top < r.top + r.height && b.bottom > r.top;
    if (overlaps) hit.add(el.dataset.bandId!);
  });
  g.deps.setSelection(hit);
  g.deps.refresh();
}

function onCancel(e: PointerEvent): void {
  if (!gesture || gesture.pointerId !== e.pointerId) return;
  teardown();
}

function teardown(): void {
  if (!gesture) return;
  window.removeEventListener('pointermove', onMove, true);
  window.removeEventListener('pointerup', onUp, true);
  window.removeEventListener('pointercancel', onCancel, true);
  document.removeEventListener('keydown', gesture.onKey);
  gesture.ghost?.remove();
  gesture.marqueeEl?.remove();
  gesture = null;
}

function buildGhost(band: HTMLElement | null): HTMLElement | null {
  if (!band) return null;
  const ghost = band.cloneNode(true) as HTMLElement;
  ghost.className = 'perf-clip perf-clip-ghost';
  Object.assign(ghost.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '9999', opacity: '0.7',
    width: `${band.offsetWidth}px`, left: '-9999px', top: '-9999px',
  });
  return ghost;
}

function rowLaneAt(x: number, y: number): string | null {
  // Optional-called: jsdom does not implement elementFromPoint at all.
  const el = document.elementFromPoint?.(x, y);
  const row = el?.closest('.perf-row') as HTMLElement | null;
  return row?.dataset.laneId ?? null;
}

function normRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    left: Math.min(x0, x1), top: Math.min(y0, y1),
    width: Math.abs(x1 - x0), height: Math.abs(y1 - y0),
  };
}
