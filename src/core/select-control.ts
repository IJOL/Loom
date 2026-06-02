// src/core/select-control.ts
// Discrete-value automatable controls. The automation system feeds 0..1
// normalized values; we quantise to an option index. The inverse picks the
// mid-bucket normalized value so the registered current value roundtrips
// through automation cleanly.
//
// Rendering: with ≤ 4 options we paint a horizontal radio strip (graphical
// when option values match known waveform shapes, plain text otherwise);
// with > 4 options we fall back to the native <select>. The returned `el`
// is typed as HTMLElement either way — callers use `.el` for layout only.

import type { KnobHandle, KnobMeta } from './knob';

export interface SelectControlOpts {
  id: string;                  // automation registry id
  label?: string;
  options: Array<{ value: string; label: string }>;
  initialValue: string;
  onChange: (value: string, fromUser: boolean) => void;
  /** Force the native <select> rendering even with ≤4 options (used for
   *  long-labelled option sets like the FM algorithm). */
  forceSelect?: boolean;
}

export function quantiseSelectValue(norm: number, optionCount: number): number {
  return Math.max(0, Math.min(optionCount - 1, Math.floor(norm * optionCount)));
}

export function normaliseSelectIndex(idx: number, optionCount: number): number {
  return (idx + 0.5) / optionCount;
}

// Built-in glyph paths drawn on a 28×16 viewBox. When an option `value`
// matches one of these keys (waveform names), the radio button paints the
// glyph instead of the text label.
const WAVEFORM_GLYPHS: Record<string, string> = {
  sine:     'M 2 8 Q 5 1 8 8 T 14 8 T 20 8 T 26 8',
  triangle: 'M 2 8 L 7 1 L 14 15 L 21 1 L 26 8',
  square:   'M 2 14 L 2 2 L 9 2 L 9 14 L 16 14 L 16 2 L 23 2 L 23 14 L 26 14',
  sawtooth: 'M 2 14 L 8 2 L 8 14 L 15 2 L 15 14 L 22 2 L 22 14',
  saw:      'M 2 14 L 8 2 L 8 14 L 15 2 L 15 14 L 22 2 L 22 14',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeWaveformGlyph(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 28 16');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '14');
  svg.classList.add('radio-glyph');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.5');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}

function createRadioStrip(opts: SelectControlOpts): { el: HTMLElement; handle: KnobHandle } {
  const wrap = document.createElement('div');
  wrap.className = 'radio-strip';

  const buttons: HTMLButtonElement[] = [];
  const refresh = (active: string) => {
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', opts.options[i].value === active);
    }
  };

  for (const o of opts.options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'radio-btn';
    b.title = o.label;
    const glyph = WAVEFORM_GLYPHS[o.value];
    if (glyph) {
      b.appendChild(makeWaveformGlyph(glyph));
    } else {
      b.textContent = o.label;
    }
    b.addEventListener('click', () => {
      const next = o.value;
      refresh(next);
      const idx = opts.options.findIndex((x) => x.value === next);
      const v = normaliseSelectIndex(Math.max(0, idx), opts.options.length);
      opts.onChange(next, true);
      const norm = opts.options.length <= 1 ? 0 : Math.max(0, idx) / (opts.options.length - 1);
      handle.el.setAttribute('data-value-norm', String(norm));
      handle.onValueChanged?.(v, true);
    });
    buttons.push(b);
    wrap.appendChild(b);
  }

  let current = opts.initialValue;
  refresh(current);

  const meta: KnobMeta = { id: opts.id, label: opts.label, min: 0, max: 1 };
  const handle: KnobHandle = {
    el: wrap,
    meta,
    setValue: (v: number) => {
      const idx = quantiseSelectValue(v, opts.options.length);
      const next = opts.options[idx].value;
      if (current !== next) {
        current = next;
        refresh(next);
        opts.onChange(next, false);
        handle.onValueChanged?.(v, false);
      }
      const norm = opts.options.length <= 1 ? 0 : idx / (opts.options.length - 1);
      handle.el.setAttribute('data-value-norm', String(norm));
    },
    setModulationOffset: () => { /* discrete controls don't show a ring */ },
  };

  // Set initial data-value-norm
  const initialIdx = opts.options.findIndex((o) => o.value === opts.initialValue);
  const initialNorm = opts.options.length <= 1 ? 0 : Math.max(0, initialIdx) / (opts.options.length - 1);
  wrap.setAttribute('data-value-norm', String(initialNorm));

  return { el: wrap, handle };
}

function createNativeSelect(opts: SelectControlOpts): { el: HTMLElement; handle: KnobHandle } {
  const sel = document.createElement('select');
  sel.className = 'select-control';
  for (const o of opts.options) {
    const optEl = document.createElement('option');
    optEl.value = o.value;
    optEl.textContent = o.label;
    sel.appendChild(optEl);
  }
  sel.value = opts.initialValue;

  const meta: KnobMeta = { id: opts.id, label: opts.label, min: 0, max: 1 };
  const handle: KnobHandle = {
    el: sel,
    meta,
    setValue: (v: number) => {
      const idx = quantiseSelectValue(v, opts.options.length);
      const next = opts.options[idx].value;
      if (sel.value !== next) {
        sel.value = next;
        opts.onChange(next, false);
        handle.onValueChanged?.(v, false);
      }
      const norm = opts.options.length <= 1 ? 0 : idx / (opts.options.length - 1);
      handle.el.setAttribute('data-value-norm', String(norm));
    },
    setModulationOffset: () => { /* discrete controls don't show a ring */ },
  };

  // Set initial data-value-norm
  const initialIdx = opts.options.findIndex((o) => o.value === opts.initialValue);
  const initialNorm = opts.options.length <= 1 ? 0 : Math.max(0, initialIdx) / (opts.options.length - 1);
  sel.setAttribute('data-value-norm', String(initialNorm));

  sel.addEventListener('change', () => {
    const idx = opts.options.findIndex((o) => o.value === sel.value);
    const v = normaliseSelectIndex(Math.max(0, idx), opts.options.length);
    opts.onChange(sel.value, true);
    const norm = opts.options.length <= 1 ? 0 : Math.max(0, idx) / (opts.options.length - 1);
    handle.el.setAttribute('data-value-norm', String(norm));
    handle.onValueChanged?.(v, true);
  });

  return { el: sel, handle };
}

export function createSelectControl(opts: SelectControlOpts): { el: HTMLElement; handle: KnobHandle } {
  const useStrip = !opts.forceSelect && opts.options.length <= 4;
  return useStrip ? createRadioStrip(opts) : createNativeSelect(opts);
}
