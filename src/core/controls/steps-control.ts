// A row of bars you paint by dragging: an analogue step sequencer for any
// automation destination. One value per step, each 0..1.
//
// Two OPT-IN behaviours were added for the arp's pattern editor, and they are
// off by default so every existing caller is untouched:
//
//   `levels`  — the bar lands on whole rungs instead of anywhere, for a row
//               that means "which one of N" rather than "how much".
//   `restAt0` — 0 becomes a REST, drawn as an empty slot. Off, the row keeps
//               its sliver floor (below), which is right for a value and wrong
//               for a pattern that has to be able to say "nothing here".

import { capturePointer, isDragging, clamp01 } from './pointer-drag';

export interface StepsOptions {
  values: number[];
  onChange(index: number, value: number): void;
  label?: string;
  /** Whole rungs rather than a continuum: `levels: 8` gives 0, 1/7 … 1. */
  levels?: number;
  /** Let a bar reach 0, and treat 0 as a rest rather than as a quiet value. */
  restAt0?: boolean;
}

export interface StepsHandle {
  el: HTMLElement;
  set(values: number[]): void;
}

/** A bar of height 0 would be invisible and unclickable, so it keeps a sliver.
 *  The value reported is the sliver too — a step you cannot see and cannot grab
 *  again is worse than one that never quite reaches zero.
 *
 *  `restAt0` opts out: there the empty slot IS the meaning, it is drawn so you
 *  can see it, and the whole column stays grabbable. */
const MIN_BAR = 0.02;

export function createStepsControl(opts: StepsOptions): StepsHandle {
  const el = document.createElement('div');
  el.className = 'steps-control' + (opts.restAt0 ? ' has-rests' : '');
  el.style.gridTemplateColumns = `repeat(${opts.values.length}, 1fr)`;
  el.tabIndex = 0;
  el.setAttribute('role', 'group');
  if (opts.label) el.setAttribute('aria-label', opts.label);

  /** Snap to a rung when the row has them. */
  const quantise = (v: number): number => {
    const n = opts.levels && opts.levels > 1 ? Math.round(opts.levels) : 0;
    if (!n) return v;
    return Math.round(v * (n - 1)) / (n - 1);
  };

  const paint = (bar: HTMLElement, v: number) => {
    const rest = !!opts.restAt0 && v <= 0;
    bar.classList.toggle('rest', rest);
    bar.style.height = `${clamp01(v) * 100}%`;
  };

  const bars = opts.values.map((v, i) => {
    const b = document.createElement('div');
    // Every fourth step is accented, so the eye can count bars without a ruler.
    b.className = 'step-bar' + (i % 4 === 0 ? ' accent' : '');
    paint(b, v);
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
    const raw = 1 - (ev.clientY - r.top) / r.height;
    const floored = opts.restAt0 ? Math.max(0, raw) : Math.max(MIN_BAR, raw);
    const v = quantise(clamp01(floored));
    paint(bars[i], v);
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
        if (bars[i]) paint(bars[i], v);
      });
    },
  };
}
