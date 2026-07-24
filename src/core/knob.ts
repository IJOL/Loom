// Rotary knob component.
//   Drag vertically to change value (Shift = fine).
//   Mouse wheel also adjusts (Shift = fine).
//   Double-click resets to defaultValue (if provided).
//
// The DOM scaffolding is a ONE-TIME lit-html render into a detached fragment;
// after that every update (drag frame, wheel, automation setValue) writes the
// kept element refs imperatively. The hot path must NOT go through a template
// re-render: a diff per drag frame is waste, and replacing the <svg> mid-drag
// would drop its pointer capture.

import { html, render as litRender, nothing } from 'lit-html';

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

export function createKnob(opts: KnobOpts): KnobHandle {
  const size = opts.size ?? 40;
  const cx = size / 2;
  const cy = size / 2;
  const trackR    = size * 0.42;
  const bodyR     = size * 0.32;
  const pointerLen = bodyR - 2;

  let value = opts.value;
  let lastModOffset = 0;

  // --- Interaction (bound in the template below) --------------------------
  let dragging = false;
  let startY = 0;
  let startVal = 0;

  const onPointerDown = (e: PointerEvent) => {
    // Only the primary button drags. Without this a right-press captures the
    // pointer and subsequent moves change the value — which the knob context
    // menu would trigger on every use.
    if (e.button !== 0) return;
    dragging = true;
    opts.onGestureStart?.();
    startY = e.clientY;
    startVal = value;
    svg.setPointerCapture(e.pointerId);
    wrap.classList.add('dragging');
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const deltaY = startY - e.clientY;
    const sens = e.shiftKey ? 0.0008 : 0.005;
    setValue(startVal + deltaY * sens * (opts.max - opts.min), true, true);
  };

  const release = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    opts.onGestureEnd?.();
    wrap.classList.remove('dragging');
  };

  const onDblClick = () => {
    if (opts.defaultValue === undefined) return;
    opts.onGestureStart?.();
    setValue(opts.defaultValue, true, true);
    opts.onGestureEnd?.();
  };

  let wheelGestureTimer: ReturnType<typeof setTimeout> | null = null;
  let wheelGestureActive = false;

  const onWheel = (e: WheelEvent) => {
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
  };

  // --- One-time DOM build --------------------------------------------------
  // The value arc gets no initial `d` and the value text starts empty; the
  // first render() paints both. `nothing` on style keeps the attribute off
  // entirely when no custom color is set (matches the pre-lit DOM).
  const frag = document.createDocumentFragment();
  litRender(html`
    <div class="knob">
      ${opts.label ? html`<div class="knob-label">${opts.label}</div>` : nothing}
      <svg
        class="knob-svg"
        viewBox=${`0 0 ${size} ${size}`}
        width=${size}
        height=${size}
        @pointerdown=${onPointerDown}
        @pointermove=${onPointerMove}
        @pointerup=${release}
        @pointercancel=${release}
        @dblclick=${onDblClick}
        @wheel=${{ handleEvent: onWheel, passive: false }}
      >
        <path class="knob-track" d=${arcPath(cx, cy, trackR, -135, 135)} />
        <path class="knob-value" style=${opts.color ? `stroke: ${opts.color}` : nothing} />
        <path class="knob-modulation" style="stroke: #ffa726; opacity: 0" />
        <circle class="knob-body" cx=${cx} cy=${cy} r=${bodyR} />
        <line
          class="knob-pointer"
          x1=${cx} y1=${cy} x2=${cx} y2=${cy - pointerLen}
          style=${opts.color ? `stroke: ${opts.color}` : nothing}
        />
      </svg>
      <div class="knob-value-text"></div>
    </div>
  `, frag);

  const wrap    = frag.firstElementChild as HTMLElement;
  const svg     = wrap.querySelector('svg.knob-svg') as SVGSVGElement;
  const valArc  = wrap.querySelector('.knob-value') as SVGPathElement;
  const modArc  = wrap.querySelector('.knob-modulation') as SVGPathElement;
  const ptr     = wrap.querySelector('.knob-pointer') as SVGLineElement;
  const valDisp = wrap.querySelector('.knob-value-text') as HTMLDivElement;

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
