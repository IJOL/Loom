// Shared drag plumbing for the widget controls.
//
// Pointer capture is requested defensively: jsdom has no PointerEvent, so a
// test drives these controls with a MouseEvent carrying the same clientX/
// clientY the handlers actually read, and such an event has no pointerId.
// Calling setPointerCapture(undefined) there throws and takes the control down
// with it. Guarding costs one line and keeps the tests honest — they exercise
// the real handler rather than a test-only branch.

export function capturePointer(el: Element, ev: Event): void {
  const id = (ev as PointerEvent).pointerId;
  if (typeof id !== 'number') return;
  const capture = (el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture;
  if (typeof capture !== 'function') return;
  try {
    capture.call(el, id);
  } catch {
    // A browser that refuses capture still delivers the move events; losing
    // capture degrades a drag that leaves the element, it does not break it.
  }
}

/** True while a primary button is held. A MouseEvent from a test carries this
 *  the same way a PointerEvent does. */
export function isDragging(ev: Event): boolean {
  return ((ev as MouseEvent).buttons ?? 0) > 0;
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
