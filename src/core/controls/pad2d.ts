// A two-axis pad: drag a dot inside a box, read back two fractions.
//
// WEAVE's cloud topology needs it, and any plugin that declares a `pad2d` param
// gets it for free — that is the point of the control living in the host's
// catalogue rather than inside one plugin.

import { capturePointer, isDragging, clamp01 } from './pointer-drag';

export interface Pad2dOptions {
  x: number;
  y: number;
  onChange(x: number, y: number): void;
  label?: string;
}

export interface Pad2dHandle {
  el: HTMLElement;
  set(x: number, y: number): void;
}

export function createPad2d(opts: Pad2dOptions): Pad2dHandle {
  const el = document.createElement('div');
  el.className = 'pad2d';
  el.tabIndex = 0;
  el.setAttribute('role', 'application');
  if (opts.label) el.setAttribute('aria-label', opts.label);

  const dot = document.createElement('i');
  dot.className = 'pad2d-dot';
  el.appendChild(dot);

  const paint = (x: number, y: number) => {
    dot.style.left = `${clamp01(x) * 100}%`;
    dot.style.top = `${clamp01(y) * 100}%`;
  };
  paint(opts.x, opts.y);

  const from = (ev: MouseEvent) => {
    const r = el.getBoundingClientRect();
    // Saturating at the edges is deliberate: a drag that leaves the box must
    // not report a position outside 0..1, or the cloud would weight a loop it
    // should never reach.
    const x = clamp01((ev.clientX - r.left) / r.width);
    const y = clamp01((ev.clientY - r.top) / r.height);
    paint(x, y);
    opts.onChange(x, y);
  };

  el.addEventListener('pointerdown', (ev) => {
    capturePointer(el, ev);
    from(ev as MouseEvent);
  });
  el.addEventListener('pointermove', (ev) => {
    if (isDragging(ev)) from(ev as MouseEvent);
  });

  return { el, set: paint };
}
