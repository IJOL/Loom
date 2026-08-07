// A row of bars you paint by dragging: an analogue step sequencer for any
// automation destination. One value per step, each 0..1.

import { capturePointer, isDragging, clamp01 } from './pointer-drag';

export interface StepsOptions {
  values: number[];
  onChange(index: number, value: number): void;
  label?: string;
}

export interface StepsHandle {
  el: HTMLElement;
  set(values: number[]): void;
}

/** A bar of height 0 would be invisible and unclickable, so it keeps a sliver.
 *  The value reported is the sliver too — a step you cannot see and cannot grab
 *  again is worse than one that never quite reaches zero. */
const MIN_BAR = 0.02;

export function createStepsControl(opts: StepsOptions): StepsHandle {
  const el = document.createElement('div');
  el.className = 'steps-control';
  el.style.gridTemplateColumns = `repeat(${opts.values.length}, 1fr)`;
  el.tabIndex = 0;
  el.setAttribute('role', 'group');
  if (opts.label) el.setAttribute('aria-label', opts.label);

  const bars = opts.values.map((v, i) => {
    const b = document.createElement('div');
    // Every fourth step is accented, so the eye can count bars without a ruler.
    b.className = 'step-bar' + (i % 4 === 0 ? ' accent' : '');
    b.style.height = `${clamp01(v) * 100}%`;
    el.appendChild(b);
    return b;
  });

  const from = (ev: MouseEvent) => {
    const r = el.getBoundingClientRect();
    const i = Math.floor((ev.clientX - r.left) / r.width * bars.length);
    // Left of the first column this floors to -1. Writing that would silently
    // corrupt the last bar (negative index on an array read) or the first, so
    // the control does nothing instead.
    if (i < 0 || i >= bars.length) return;
    const v = clamp01(Math.max(MIN_BAR, 1 - (ev.clientY - r.top) / r.height));
    bars[i].style.height = `${v * 100}%`;
    opts.onChange(i, v);
  };

  el.addEventListener('pointerdown', (ev) => {
    capturePointer(el, ev);
    from(ev as MouseEvent);
  });
  el.addEventListener('pointermove', (ev) => {
    if (isDragging(ev)) from(ev as MouseEvent);
  });

  return {
    el,
    set(values) {
      values.forEach((v, i) => {
        if (bars[i]) bars[i].style.height = `${clamp01(v) * 100}%`;
      });
    },
  };
}
