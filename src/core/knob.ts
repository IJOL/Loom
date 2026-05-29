// Rotary knob component.
//   Drag vertically to change value (Shift = fine).
//   Mouse wheel also adjusts (Shift = fine).
//   Double-click resets to defaultValue (if provided).

export interface KnobOpts {
  min: number;
  max: number;
  value: number;
  step?: number;
  defaultValue?: number;
  label?: string;
  color?: string;
  size?: number;          // SVG viewBox size in px; default 40
  format?: (v: number) => string;
  onChange: (v: number) => void;
  id?: string;            // automation registry id (optional)
  /** Fired on pointerdown (drag start). Use to snapshot pre-drag state. */
  onGestureStart?: () => void;
  /** Fired on pointerup, pointercancel, or end of wheel/dblclick burst. */
  onGestureEnd?: () => void;
}

export interface KnobMeta {
  id?: string;
  label?: string;
  min: number;
  max: number;
}

export interface KnobHandle {
  el: HTMLElement;
  setValue: (v: number) => void;
  meta: KnobMeta;
  // Fires on every value change. `fromUser` is true only for interactive changes
  // (drag/wheel/dblclick); false for programmatic setValue (automation, presets).
  // Used by the REC button to record only what the user touches.
  onValueChanged?: (v: number, fromUser: boolean) => void;
  /** Sets the additive modulation offset in normalized -1..+1 (0 = no mod).
   *  Renders as a thin amber ring overlay; does NOT change the base value. */
  setModulationOffset: (offsetNorm: number) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createKnob(opts: KnobOpts): KnobHandle {
  const size = opts.size ?? 40;
  const cx = size / 2;
  const cy = size / 2;
  const trackR    = size * 0.42;
  const bodyR     = size * 0.32;
  const pointerLen = bodyR - 2;

  const wrap = document.createElement('div');
  wrap.className = 'knob';

  if (opts.label) {
    const lab = document.createElement('div');
    lab.className = 'knob-label';
    lab.textContent = opts.label;
    wrap.appendChild(lab);
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('knob-svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));

  const track = document.createElementNS(SVG_NS, 'path');
  track.setAttribute('class', 'knob-track');
  track.setAttribute('d', arcPath(cx, cy, trackR, -135, 135));
  svg.appendChild(track);

  const valArc = document.createElementNS(SVG_NS, 'path');
  valArc.setAttribute('class', 'knob-value');
  if (opts.color) valArc.style.stroke = opts.color;
  svg.appendChild(valArc);

  const modArc = document.createElementNS(SVG_NS, 'path');
  modArc.setAttribute('class', 'knob-modulation');
  modArc.style.stroke = '#ffa726';
  modArc.style.opacity = '0';
  svg.appendChild(modArc);

  const body = document.createElementNS(SVG_NS, 'circle');
  body.setAttribute('cx', String(cx));
  body.setAttribute('cy', String(cy));
  body.setAttribute('r', String(bodyR));
  body.setAttribute('class', 'knob-body');
  svg.appendChild(body);

  const ptr = document.createElementNS(SVG_NS, 'line');
  ptr.setAttribute('x1', String(cx));
  ptr.setAttribute('y1', String(cy));
  ptr.setAttribute('x2', String(cx));
  ptr.setAttribute('y2', String(cy - pointerLen));
  ptr.setAttribute('class', 'knob-pointer');
  if (opts.color) ptr.style.stroke = opts.color;
  svg.appendChild(ptr);

  wrap.appendChild(svg);

  const valDisp = document.createElement('div');
  valDisp.className = 'knob-value-text';
  wrap.appendChild(valDisp);

  let value = opts.value;
  let lastModOffset = 0;
  const handle: KnobHandle = {
    el: wrap,
    setValue: (v) => setValue(v, true, false),
    meta: { id: opts.id, label: opts.label, min: opts.min, max: opts.max },
    setModulationOffset: (offset: number) => {
      lastModOffset = offset;
      updateModArc(value, offset);
    },
  };

  function render() {
    const range = opts.max - opts.min;
    const norm = range === 0 ? 0 : clamp((value - opts.min) / range, 0, 1);
    const angle = -135 + norm * 270;
    valArc.setAttribute('d', arcPath(cx, cy, trackR, -135, angle));
    ptr.setAttribute('transform', `rotate(${angle} ${cx} ${cy})`);
    valDisp.textContent = opts.format ? opts.format(value) : value.toFixed(2);
    wrap.setAttribute('data-value-norm', String(norm));
  }

  function updateModArc(v: number, offset: number) {
    if (Math.abs(offset) < 1e-4) {
      modArc.style.opacity = '0';
      return;
    }
    const range = opts.max - opts.min;
    const modValue = Math.max(opts.min, Math.min(opts.max, v + offset * range));
    const fromAng = -135 + 270 * (v - opts.min) / range;
    const toAng   = -135 + 270 * (modValue - opts.min) / range;
    modArc.setAttribute('d', arcPath(cx, cy, trackR + 2, Math.min(fromAng, toAng), Math.max(fromAng, toAng)));
    modArc.style.opacity = '0.85';
  }

  function setValue(v: number, fire = true, fromUser = false) {
    const clamped = clamp(v, opts.min, opts.max);
    const stepped = opts.step ? Math.round(clamped / opts.step) * opts.step : clamped;
    value = stepped;
    render();
    updateModArc(value, lastModOffset);
    if (fire) opts.onChange(value);
    if (handle.onValueChanged) handle.onValueChanged(value, fromUser);
  }

  render();

  // --- Interaction --------------------------------------------------------
  let dragging = false;
  let startY = 0;
  let startVal = 0;

  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    opts.onGestureStart?.();
    startY = e.clientY;
    startVal = value;
    svg.setPointerCapture(e.pointerId);
    wrap.classList.add('dragging');
    e.preventDefault();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const deltaY = startY - e.clientY;
    const sens = e.shiftKey ? 0.0008 : 0.005;
    setValue(startVal + deltaY * sens * (opts.max - opts.min), true, true);
  });

  const release = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    opts.onGestureEnd?.();
    wrap.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  svg.addEventListener('dblclick', () => {
    if (opts.defaultValue === undefined) return;
    opts.onGestureStart?.();
    setValue(opts.defaultValue, true, true);
    opts.onGestureEnd?.();
  });

  let wheelGestureTimer: ReturnType<typeof setTimeout> | null = null;
  let wheelGestureActive = false;

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!wheelGestureActive) {
      wheelGestureActive = true;
      opts.onGestureStart?.();
    }
    if (wheelGestureTimer) clearTimeout(wheelGestureTimer);
    const sens = e.shiftKey ? 0.0008 : 0.005;
    setValue(value + -e.deltaY * sens * (opts.max - opts.min), true, true);
    wheelGestureTimer = setTimeout(() => {
      wheelGestureActive = false;
      opts.onGestureEnd?.();
    }, 250);
  }, { passive: false });

  return handle;
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  if (endDeg <= startDeg + 0.01) {
    // Avoid drawing a zero-length arc; just emit a moveto so the path is valid.
    const p = polar(cx, cy, r, startDeg);
    return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  const start = polar(cx, cy, r, startDeg);
  const end   = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
