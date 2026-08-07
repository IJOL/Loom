// A cursor over an ordered list of loops.
//
// The dots are laid out as equal cells, so dot i is centred at (i + 0.5) / N of
// the box -- NOT at i / (N - 1). Drawing the cursor on the second scale puts it
// between dots while the readout claims otherwise, which is exactly the bug the
// approved mockup shipped with and only gave up when someone opened it in a
// browser. posToPct below is the one place that scale is written down, and
// pointerToValue is its exact inverse.

import { capturePointer, isDragging, clamp01 } from './pointer-drag';

export interface QueueOptions {
  length: number;
  /** 0..1 across the whole queue. */
  value: number;
  onChange(v: number): void;
  label?: string;
}

export interface QueueHandle {
  el: HTMLElement;
  set(v: number): void;
}

export function createQueueControl(opts: QueueOptions): QueueHandle {
  const n = Math.max(1, Math.floor(opts.length));

  const el = document.createElement('div');
  el.className = 'queue-control';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '1');
  if (opts.label) el.setAttribute('aria-label', opts.label);

  const line = document.createElement('div');
  line.className = 'queue-line';
  el.appendChild(line);

  const dots: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const cell = document.createElement('span');
    cell.className = 'queue-dot';
    cell.appendChild(document.createElement('i'));
    el.appendChild(cell);
    dots.push(cell);
  }

  const cursor = document.createElement('div');
  cursor.className = 'queue-cursor';
  el.appendChild(cursor);

  /** Position (0..n-1) → percentage of the box, on the dot-centre scale. */
  const posToPct = (pos: number) => (pos + 0.5) / n * 100;

  const paint = (v: number) => {
    const value = clamp01(v);
    // A queue of one has no span to travel: the cursor sits on its only dot.
    const pos = n === 1 ? 0 : value * (n - 1);
    cursor.style.left = `${posToPct(pos)}%`;
    const i = Math.floor(pos);
    dots.forEach((d, k) => {
      d.className = 'queue-dot' + (k <= i ? ' past' : k === i + 1 ? ' next' : '');
    });
    el.setAttribute('aria-valuenow', value.toFixed(3));
  };
  paint(opts.value);

  const from = (ev: MouseEvent) => {
    if (n === 1) return;
    const r = el.getBoundingClientRect();
    const pct = (ev.clientX - r.left) / r.width;
    const pos = pct * n - 0.5;                 // exact inverse of posToPct
    const v = clamp01(pos / (n - 1));
    paint(v);
    opts.onChange(v);
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
