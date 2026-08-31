// src/core/controls/curve-control.ts
// A drawable point/segment curve: drag points, double-click to add/remove,
// drag a segment's midpoint to bend it. Built once to be paid three times —
// modulator shapes now (via Loom.controls), mod-remap and automation editing
// later — which is why it is a host control and not any consumer's private
// canvas. Pure DOM+SVG: a plugin's compiled main.js can mount it but cannot
// import our bundled lit-html, and the element is NEVER rebuilt while a
// pointer might be holding it (the stepseq/WEAVE lesson).

export interface CurvePoint { x: number; y: number; c: number }   // x,y 0..1; c -1..+1
export interface CurveControlOpts {
  points: CurvePoint[];
  onChange(points: CurvePoint[]): void;
  label: string;
  /** Snap divisions; omit for free placement. */
  grid?: { x: number; y: number };
}
export interface CurveControlHandle { el: HTMLElement; set(points: CurvePoint[]): void }

const MAX_PTS = 16;
const MIN_GAP = 0.01;   // keeps points sorted and segments non-degenerate
const W = 200, H = 100; // viewBox units; the svg scales to its CSS box

/** The segment shaping function — the DSP's twin in plugins/curve/dsp.ts:
 *  the editor SAMPLES the same math it will sound like. Duplicated on purpose:
 *  the host cannot import plugin code, and one consumer pair does not yet earn
 *  an SDK primitive. */
const shape = (u: number, c: number): number =>
  c === 0 ? u : Math.pow(u, Math.pow(4, c));

const NS = 'http://www.w3.org/2000/svg';
const mk = <K extends keyof SVGElementTagNameMap>(tag: K, cls?: string): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(NS, tag);
  if (cls) el.setAttribute('class', cls);
  return el;
};

export function createCurveControl(opts: CurveControlOpts): CurveControlHandle {
  let pts: CurvePoint[] = opts.points.map((p) => ({ ...p }));
  const root = document.createElement('div');
  root.className = 'curve-control';
  root.setAttribute('aria-label', opts.label);
  const svg = mk('svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  root.appendChild(svg);

  const snap = (v: number, div?: number): number =>
    div && div > 0 ? Math.round(v * div) / div : v;

  /** Client coords → curve space (y up = value up). */
  const toCurve = (cx: number, cy: number): { x: number; y: number } => {
    const r = svg.getBoundingClientRect();
    const x = r.width > 0 ? (cx - r.left) / r.width : 0;
    const y = r.height > 0 ? 1 - (cy - r.top) / r.height : 0;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const emit = (): void => opts.onChange(pts.map((p) => ({ ...p })));

  // One drag at a time: either a point (index) or a segment's bend (index +
  // the c/y it started from). Listeners live on the svg, so a repaint that
  // replaces a circle mid-drag cannot orphan the gesture.
  let drag: { kind: 'point'; i: number } | { kind: 'bend'; i: number; c0: number; y0: number } | null = null;

  const paint = (): void => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (opts.grid) {
      for (let i = 1; i < opts.grid.x; i++) {
        const l = mk('line', 'curve-grid');
        const x = (W * i) / opts.grid.x;
        l.setAttribute('x1', String(x)); l.setAttribute('x2', String(x));
        l.setAttribute('y1', '0'); l.setAttribute('y2', String(H));
        svg.appendChild(l);
      }
      for (let i = 1; i < opts.grid.y; i++) {
        const l = mk('line', 'curve-grid');
        const y = (H * i) / opts.grid.y;
        l.setAttribute('x1', '0'); l.setAttribute('x2', String(W));
        l.setAttribute('y1', String(y)); l.setAttribute('y2', String(y));
        svg.appendChild(l);
      }
    }
    const px = (p: CurvePoint) => p.x * W;
    const py = (p: CurvePoint) => (1 - p.y) * H;
    let d = `M ${px(pts[0])} ${py(pts[0])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      for (let s = 1; s <= 16; s++) {
        const u = s / 16;
        const y = a.y + (b.y - a.y) * shape(u, Math.max(-1, Math.min(1, a.c)));
        d += ` L ${a.x * W + (b.x - a.x) * u * W} ${(1 - y) * H}`;
      }
    }
    const path = mk('path', 'curve-path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    // Bend handles first, so point circles paint (and hit) on top of them.
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const u = 0.5;
      const y = a.y + (b.y - a.y) * shape(u, Math.max(-1, Math.min(1, a.c)));
      const hit = mk('circle', 'curve-bend');
      hit.setAttribute('cx', String(a.x * W + (b.x - a.x) * u * W));
      hit.setAttribute('cy', String((1 - y) * H));
      hit.setAttribute('r', '8');
      hit.addEventListener('pointerdown', (e) => {
        drag = { kind: 'bend', i, c0: a.c, y0: (e as PointerEvent).clientY };
        try { svg.setPointerCapture((e as PointerEvent).pointerId); } catch { /* jsdom */ }
        e.preventDefault();
      });
      svg.appendChild(hit);
    }
    pts.forEach((p, i) => {
      const dot = mk('circle', 'curve-point');
      dot.setAttribute('cx', String(px(p)));
      dot.setAttribute('cy', String(py(p)));
      dot.setAttribute('r', '5');
      dot.addEventListener('pointerdown', (e) => {
        drag = { kind: 'point', i };
        try { svg.setPointerCapture((e as PointerEvent).pointerId); } catch { /* jsdom */ }
        e.preventDefault();
      });
      dot.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (pts.length <= 2) return;   // a curve needs both ends
        pts.splice(i, 1);
        paint();
        emit();
      });
      svg.appendChild(dot);
    });
  };

  svg.addEventListener('pointermove', (e) => {
    if (drag === null) return;
    if (drag.kind === 'point') {
      const { x, y } = toCurve(e.clientX, e.clientY);
      const i = drag.i;
      const p = pts[i];
      p.y = snap(y, opts.grid?.y);
      if (i === 0) p.x = 0;
      else if (i === pts.length - 1) p.x = 1;
      else {
        const lo = pts[i - 1].x + MIN_GAP, hi = pts[i + 1].x - MIN_GAP;
        p.x = Math.max(lo, Math.min(hi, snap(x, opts.grid?.x)));
      }
      paint();
      emit();
    } else {
      // Vertical drag bends the segment; 60px sweeps the whole -1..+1 span.
      const c = drag.c0 + (drag.y0 - e.clientY) / 60;
      pts[drag.i].c = Math.max(-1, Math.min(1, c));
      paint();
      emit();
    }
  });
  const endDrag = (): void => { drag = null; };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  svg.addEventListener('dblclick', (e) => {
    // A point's own dblclick stopped propagation; reaching here means empty
    // space (or the path/grid), which is the ADD gesture.
    if (pts.length >= MAX_PTS) return;
    const { x, y } = toCurve(e.clientX, e.clientY);
    const p = { x: snap(x, opts.grid?.x), y: snap(y, opts.grid?.y), c: 0 };
    p.x = Math.max(MIN_GAP, Math.min(1 - MIN_GAP, p.x));
    let at = pts.findIndex((q) => q.x > p.x);
    if (at < 0) at = pts.length - 1;
    pts.splice(at, 0, p);
    paint();
    emit();
  });

  paint();
  return {
    el: root,
    set(points: CurvePoint[]): void {
      pts = points.map((p) => ({ ...p }));
      paint();
    },
  };
}
